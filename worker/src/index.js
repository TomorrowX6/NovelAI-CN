// NovelAI中文化助手 · 社区标签译名平台（Cloudflare Worker + D1）
//   GET  /                         提交页：搜标签、看当前译名、提交新译名或检索词；「未翻译」列出还没有中文的标签
//   GET  /admin                    审核页（凭 ADMIN_TOKEN）
//   GET  /api/overrides            已采纳的修订，扩展每隔几小时拉一次（允许跨域，缓存 5 分钟）
//   GET  /api/tags                 从 Danbooru 拉来的新标签（缓存 1 小时）
//   GET  /api/pending              有待审核提交的标签
//   GET  /api/export.csv           已采纳的修订，导出成 data/ 下的 CSV 格式，发版时并进词典
//   POST /api/suggestions          提交（可选 Turnstile 人机验证，每个 IP 每小时限 RATE_LIMIT 条）
//   GET  /api/admin/suggestions    列出提交（?status=pending|approved|rejected|reverted）
//   POST /api/admin/suggestions/:id  { action: approve|reject|revert, label?, aliases? }
//   POST /api/admin/tags           存入从 Danbooru 拉来的标签 { tags: [Danbooru /tags.json 的结果] }
// Danbooru 拒绝来自 Cloudflare Workers 的请求，所以拉取在外面做：GitHub Actions 每天跑 scripts/sync-tags.mjs，
// 审核页的「拉取新标签」在管理员的浏览器里请求 Danbooru，拉到后都交给 /api/admin/tags
import { validateSuggestion, aggregate, toCsv, cleanZh, parseAliases, parseDanbooruTags, LIMITS } from './rules.js';
import { submitPage, adminPage, pageCsp } from './pages.js';

const RATE_LIMIT = 20;
const STATUSES = ['pending', 'approved', 'rejected', 'reverted'];
const CORS = { 'Access-Control-Allow-Origin': '*' };
const MAX_TAGS_PER_POST = 5000;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 比较两个口令的哈希，耗时与内容无关
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function isAdmin(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return !!env.ADMIN_TOKEN && !!token && sameSecret(token, env.ADMIN_TOKEN);
}

function page(render, env) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  return new Response(render(env, nonce), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': pageCsp(env, nonce),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    },
  });
}

// 边缘缓存（workers.dev 上没有效果，自定义域名上才有）
const edgeCache = () => (typeof caches !== 'undefined' ? caches.default : null);
const cacheKey = (request, p) => new Request(new URL(p, request.url).toString());

async function cached(request, ctx, p, maxAge, build) {
  const cache = edgeCache();
  const key = cacheKey(request, p);
  const hit = cache && (await cache.match(key));
  if (hit) return hit;
  const res = json(await build(), 200, { ...CORS, 'Cache-Control': `public, max-age=${maxAge}` });
  if (cache) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

function purge(request, ctx, p) {
  const cache = edgeCache();
  if (cache) ctx.waitUntil(cache.delete(cacheKey(request, p)));
}

async function approvedEntries(env) {
  const { results } = await env.DB.prepare(
    "SELECT s.tag, s.label, s.aliases, t.count FROM suggestions s LEFT JOIN tags t ON t.tag = s.tag WHERE s.status = 'approved' ORDER BY s.reviewed_at, s.id",
  ).all();
  return aggregate(results);
}

async function newTags(env) {
  const { results } = await env.DB.prepare('SELECT tag, category, count, created_at FROM tags ORDER BY count DESC LIMIT 20000').all();
  return results;
}

async function pendingTags(env) {
  const { results } = await env.DB.prepare("SELECT tag, COUNT(*) AS n FROM suggestions WHERE status = 'pending' GROUP BY tag LIMIT 5000").all();
  return results;
}

// 存入 Danbooru 标签（已有的更新图片数）。D1 每次调用最多 50 条查询（免费版），batch 里的语句也可能逐条计数，
// 所以整批标签作为一个 JSON 参数交给 json_each，每 TAGS_PER_QUERY 个标签只占一条查询
const TAGS_PER_QUERY = 1000;
async function storeTags(env, list) {
  const rows = parseDanbooruTags(list);
  const upsert = env.DB.prepare(
    'INSERT INTO tags (tag, category, count, created_at, synced_at) ' +
      "SELECT json_extract(value, '$.tag'), json_extract(value, '$.category'), json_extract(value, '$.count'), json_extract(value, '$.created_at'), ? " +
      // INSERT … SELECT 后面接 ON CONFLICT 时，SQLite 要求 SELECT 带 WHERE
      'FROM json_each(?) WHERE true ' +
      'ON CONFLICT(tag) DO UPDATE SET category = excluded.category, count = excluded.count, synced_at = excluded.synced_at',
  );
  const now = Date.now();
  for (let i = 0; i < rows.length; i += TAGS_PER_QUERY) {
    await upsert.bind(now, JSON.stringify(rows.slice(i, i + TAGS_PER_QUERY))).run();
  }
  return { received: list.length, stored: rows.length };
}

async function verifyTurnstile(token, ip, env) {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== 'string' || !token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  return !!(await res.json()).success;
}

async function submit(request, env) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'application/json') return json({ error: '请求格式不对' }, 415);
  const body = await request.json().catch(() => null);
  const v = validateSuggestion(body);
  if (v.error) return json({ error: v.error }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(body.turnstile, ip, env))) return json({ error: '人机验证没有通过，请重试' }, 400);
  const ipHash = await sha256(`${env.IP_SALT || ''}:${ip}`);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM suggestions WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, Date.now() - 60 * 60 * 1000)
    .first();
  if (recent && recent.n >= RATE_LIMIT) return json({ error: '提交得太频繁了，请一小时后再试' }, 429);
  const { tag, label, aliases, note } = v.value;
  const r = await env.DB.prepare('INSERT INTO suggestions (tag, label, aliases, note, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(tag, label, JSON.stringify(aliases), note, ipHash, Date.now())
    .run();
  return json({ id: r.meta.last_row_id }, 201);
}

async function listSuggestions(url, env) {
  const status = url.searchParams.get('status') || 'pending';
  if (!STATUSES.includes(status)) return json({ error: '状态不对' }, 400);
  const order = status === 'pending' ? 'created_at' : 'reviewed_at DESC';
  const { results } = await env.DB.prepare(
    `SELECT id, tag, label, aliases, note, status, created_at, reviewed_at FROM suggestions WHERE status = ? ORDER BY ${order} LIMIT 200`,
  )
    .bind(status)
    .all();
  return json({ items: results.map((r) => ({ ...r, aliases: JSON.parse(r.aliases || '[]') })) });
}

async function review(request, env, ctx, id) {
  const body = await request.json().catch(() => null);
  const action = body && body.action;
  const row = await env.DB.prepare('SELECT * FROM suggestions WHERE id = ?').bind(id).first();
  if (!row) return json({ error: '找不到这条提交' }, 404);
  const now = Date.now();
  if (action === 'approve') {
    if (row.status !== 'pending') return json({ error: '只能采纳待审核的提交' }, 409);
    // 审核时可以顺手改提交的内容
    let { label, aliases } = row;
    if (typeof body.label === 'string') {
      label = body.label.trim() ? cleanZh(body.label, LIMITS.label) : '';
      if (label === null) return json({ error: '译名必须含汉字，最多 60 个字，不能有 < > 或网址' }, 400);
    }
    if (body.aliases !== undefined) {
      const list = parseAliases(body.aliases);
      if (!list) return json({ error: '检索词不合格' }, 400);
      aliases = JSON.stringify(list);
    }
    if (!label && aliases === '[]') return json({ error: '译名和检索词不能都为空' }, 400);
    await env.DB.prepare("UPDATE suggestions SET status = 'approved', label = ?, aliases = ?, reviewed_at = ? WHERE id = ?").bind(label, aliases, now, id).run();
  } else if (action === 'reject') {
    if (row.status !== 'pending') return json({ error: '只能驳回待审核的提交' }, 409);
    await env.DB.prepare("UPDATE suggestions SET status = 'rejected', reviewed_at = ? WHERE id = ?").bind(now, id).run();
  } else if (action === 'revert') {
    if (row.status !== 'approved') return json({ error: '只能撤销已采纳的提交' }, 409);
    await env.DB.prepare("UPDATE suggestions SET status = 'reverted', reviewed_at = ? WHERE id = ?").bind(now, id).run();
  } else {
    return json({ error: '操作不对' }, 400);
  }
  // 采纳或撤销后让扩展尽快拿到新数据
  if (action !== 'reject') purge(request, ctx, '/api/overrides');
  return json({ ok: true });
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  if (method === 'GET' && pathname === '/') return page(submitPage, env);
  if (method === 'GET' && pathname === '/admin') return page(adminPage, env);
  if (pathname === '/api/overrides') {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET' } });
    if (method === 'GET') return cached(request, ctx, '/api/overrides', 300, async () => ({ updated: Date.now(), entries: await approvedEntries(env) }));
  }
  if (method === 'GET' && pathname === '/api/tags') {
    return cached(request, ctx, '/api/tags', 3600, async () => ({ updated: Date.now(), tags: await newTags(env) }));
  }
  if (method === 'GET' && pathname === '/api/pending') return json({ tags: await pendingTags(env) }, 200, { 'Cache-Control': 'no-store' });
  if (method === 'GET' && pathname === '/api/export.csv') {
    return new Response(toCsv(await approvedEntries(env)), { headers: { 'Content-Type': 'text/csv; charset=utf-8', ...CORS } });
  }
  if (method === 'POST' && pathname === '/api/suggestions') return submit(request, env);
  if (pathname.startsWith('/api/admin/')) {
    if (!(await isAdmin(request, env))) return json({ error: '口令不对' }, 401);
    if (method === 'GET' && pathname === '/api/admin/suggestions') return listSuggestions(url, env);
    if (method === 'POST' && pathname === '/api/admin/tags') {
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.tags) || body.tags.length > MAX_TAGS_PER_POST) return json({ error: `tags 必须是数组，最多 ${MAX_TAGS_PER_POST} 个` }, 400);
      const r = await storeTags(env, body.tags);
      purge(request, ctx, '/api/tags');
      return json(r);
    }
    const m = pathname.match(/^\/api\/admin\/suggestions\/(\d+)$/);
    if (method === 'POST' && m) return review(request, env, ctx, +m[1]);
  }
  return json({ error: '找不到' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: '服务器出错了' }, 500);
    }
  },
};
