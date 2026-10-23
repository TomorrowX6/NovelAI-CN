// NovelAI Tag Editor：社区标签译名的编辑器（Cloudflare Worker + D1 + GitHub App），仿照 EhTagTranslation 的 ehtt.vercel.app。
// 用 GitHub 登录后修改标签的名称和检索词，Worker 用 GitHub App 以登录用户为作者把修改提交到仓库的 data/zh-community.tsv，
// 立即生效；脚本和扩展从 GitHub 拉这个文件。历史就是 git 历史，D1 另记一份编辑日志给编辑页看、并限制频率。
//   GET  /  /list/:类别  /edit/:标签     编辑器页面（同一个单页应用）
//   GET  /zh-tags.tsv                    词典（wrangler.toml 的 [assets] 把 dist/ 一起部署）
//   GET  /auth/login  /auth/callback     GitHub 登录；POST /auth/logout 退出
//   GET  /api/me                         当前登录的用户
//   GET  /api/community                  社区数据的当前版本（从 GitHub 读，缓存 30 秒）
//   PUT  /api/tags/:标签                 修改 { label, aliases, note, base }，需要登录
//   GET  /api/history?tag=               这个标签的编辑日志
//   GET  /api/tags                       从 Danbooru 拉来的新标签（缓存 1 小时）
//   POST /api/admin/tags                 存入从 Danbooru 拉来的标签（凭 ADMIN_TOKEN，见 scripts/sync-tags.mjs）
import {
  MAX_TAGS_PER_POST,
  normalizeTag,
  parseDanbooruTags,
  parseCommunity,
  serializeCommunity,
  validateEdit,
  applyEdit,
  commitMessage,
} from './rules.js';
import { editorPage, pageCsp } from './pages.js';

const TAGS_PER_QUERY = 1000;
const SESSION_DAYS = 30;
const GH_API = 'https://api.github.com';
const UA = 'NovelAI-CN Tag Editor (+https://github.com/TomorrowX6/NovelAI-CN)';
const CORS = { 'Access-Control-Allow-Origin': '*' };

const conf = (env) => ({
  repo: env.GH_REPO || 'TomorrowX6/NovelAI-CN',
  branch: env.GH_BRANCH || 'main',
  path: env.DATA_PATH || 'data/zh-community.tsv',
  minAccountDays: +(env.MIN_ACCOUNT_DAYS ?? 30),
  editsPerHour: +(env.EDITS_PER_HOUR ?? 30),
  blocked: new Set(
    String(env.BLOCKED_USERS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ),
});

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

// ---- base64 / 签名 ----
const enc = new TextEncoder();
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const b64url = (bytes) => bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlToBytes = (s) => b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

async function sha256(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 比较两个口令的哈希，耗时与内容无关
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

const hmacKey = (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

// ---- 登录状态：签名的 Cookie，只存 GitHub 用户的 id、名字和头像，不存 GitHub 的令牌 ----
const SESSION_COOKIE = 'nzh_session';
const OAUTH_COOKIE = 'nzh_oauth';

function cookies(request) {
  const out = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const cookie = (name, value, maxAge, path = '/') => `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

async function signSession(env, user) {
  const payload = b64url(enc.encode(JSON.stringify({ ...user, exp: Date.now() + SESSION_DAYS * 864e5 })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

async function sessionUser(request, env) {
  const raw = cookies(request)[SESSION_COOKIE];
  if (!raw || !env.SESSION_SECRET) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), b64urlToBytes(sig), enc.encode(payload));
    if (!ok) return null;
    const user = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    if (!(user.exp > Date.now()) || conf(env).blocked.has(String(user.login).toLowerCase())) return null;
    return { id: user.id, login: user.login, avatar: user.avatar };
  } catch {
    return null;
  }
}

// 只接受站内的跳转地址；浏览器把 /\ 当成 //，反斜杠也不行
const safeReturn = (p) => (typeof p === 'string' && /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/.test(p) ? p : '/');

async function login(request, env, url) {
  if (!env.GH_CLIENT_ID) return json({ error: '还没有配置 GitHub 登录' }, 503);
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const back = safeReturn(url.searchParams.get('return'));
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', env.GH_CLIENT_ID);
  u.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  u.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: { Location: u.href, 'Set-Cookie': cookie(OAUTH_COOKIE, `${state}|${encodeURIComponent(back)}`, 600, '/auth') },
  });
}

async function callback(request, env, url) {
  const [state, back = '%2F'] = (cookies(request)[OAUTH_COOKIE] || '').split('|');
  const returnTo = safeReturn(decodeURIComponent(back));
  const fail = (msg) =>
    new Response(null, {
      status: 302,
      headers: { Location: `${returnTo}${returnTo.includes('?') ? '&' : '?'}login_error=${encodeURIComponent(msg)}`, 'Set-Cookie': cookie(OAUTH_COOKIE, '', 0, '/auth') },
    });
  if (!state || url.searchParams.get('state') !== state) return fail('登录已过期，请重新登录');
  const code = url.searchParams.get('code');
  if (!code) return fail('没有完成 GitHub 授权');
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ client_id: env.GH_CLIENT_ID, client_secret: env.GH_CLIENT_SECRET, code, redirect_uri: `${url.origin}/auth/callback` }),
  });
  const token = (await tokenRes.json().catch(() => ({}))).access_token;
  if (!token) return fail('GitHub 授权失败，请重试');
  const userRes = await gh('/user', { token });
  if (!userRes.ok) return fail('读取 GitHub 用户信息失败');
  const u = await userRes.json();
  const c = conf(env);
  if (c.blocked.has(String(u.login).toLowerCase())) return fail('这个账号不能编辑');
  if (Date.now() - Date.parse(u.created_at) < c.minAccountDays * 864e5) return fail(`注册满 ${c.minAccountDays} 天的 GitHub 账号才能编辑`);
  const session = await signSession(env, { id: u.id, login: u.login, avatar: u.avatar_url });
  const headers = new Headers({ Location: returnTo });
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, session, SESSION_DAYS * 86400));
  headers.append('Set-Cookie', cookie(OAUTH_COOKIE, '', 0, '/auth'));
  return new Response(null, { status: 302, headers });
}

// ---- GitHub API：GitHub App 的安装令牌负责读写仓库 ----
function gh(path, { token, method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  return fetch(GH_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'User-Agent': UA,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

let appKey = null; // [私钥 PEM, CryptoKey]
async function appJwt(env) {
  if (!appKey || appKey[0] !== env.GH_APP_KEY) {
    const der = b64ToBytes(String(env.GH_APP_KEY).replace(/-----[^-]+-----|\s/g, ''));
    appKey = [env.GH_APP_KEY, await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])];
  }
  const now = Math.floor(Date.now() / 1000);
  const part = (o) => b64url(enc.encode(JSON.stringify(o)));
  const data = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: String(env.GH_APP_ID) })}`;
  return `${data}.${b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', appKey[1], enc.encode(data))))}`;
}

let installation = null; // { app, token, exp }
async function installationToken(env) {
  if (installation && installation.app === env.GH_APP_ID && installation.exp > Date.now() + 60000) return installation.token;
  const jwt = await appJwt(env);
  let id = env.GH_INSTALLATION_ID;
  if (!id) {
    const r = await gh(`/repos/${conf(env).repo}/installation`, { token: jwt });
    if (!r.ok) throw new Error(`GitHub App 没有安装到 ${conf(env).repo}：HTTP ${r.status}`);
    id = (await r.json()).id;
  }
  const r = await gh(`/app/installations/${id}/access_tokens`, { token: jwt, method: 'POST' });
  if (!r.ok) throw new Error(`拿不到 GitHub App 的令牌：HTTP ${r.status}`);
  const d = await r.json();
  installation = { app: env.GH_APP_ID, token: d.token, exp: Date.parse(d.expires_at) };
  return d.token;
}

async function readCommunity(env) {
  const c = conf(env);
  const token = await installationToken(env);
  const r = await gh(`/repos/${c.repo}/contents/${c.path}?ref=${encodeURIComponent(c.branch)}`, { token });
  if (r.status === 404) return { sha: null, data: parseCommunity('') };
  if (!r.ok) throw new Error(`读取 ${c.path} 失败：HTTP ${r.status}`);
  const d = await r.json();
  let text;
  if (d.encoding === 'base64' && d.content) {
    text = new TextDecoder().decode(b64ToBytes(d.content.replace(/\s/g, '')));
  } else {
    // 超过 1 MB 的文件不内联内容，另取原文
    const raw = await gh(`/repos/${c.repo}/contents/${c.path}?ref=${encodeURIComponent(c.branch)}`, { token, accept: 'application/vnd.github.raw' });
    if (!raw.ok) throw new Error(`读取 ${c.path} 失败：HTTP ${raw.status}`);
    text = await raw.text();
  }
  return { sha: d.sha, data: parseCommunity(text) };
}

// ---- 缓存 ----
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

// ---- 编辑 ----
const sameEntry = (a, b) => (a?.label || '') === (b?.label || '') && (a?.aliases || []).join('/') === (b?.aliases || []).join('/');

async function editTag(request, env, ctx, rawTag) {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: '请先用 GitHub 登录' }, 401);
  // Cookie 是 SameSite=Lax，再核对来源，别的网站发不来修改
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: '来源不对' }, 403);
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'application/json') return json({ error: '请求格式不对' }, 415);
  const tag = normalizeTag(decodeURIComponent(rawTag));
  if (!tag) return json({ error: '英文标签格式不对：只能用英文字母、数字和符号，最多 100 个字符' }, 400);
  const body = await request.json().catch(() => null);
  const v = validateEdit(body);
  if (v.error) return json({ error: v.error }, 400);

  const c = conf(env);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM edits WHERE user_id = ? AND created_at > ?').bind(user.id, Date.now() - 36e5).first();
  if (recent && recent.n >= c.editsPerHour) return json({ error: `每小时最多修改 ${c.editsPerHour} 次，请稍后再试` }, 429);
  // 平台拉来的 Danbooru 标签记下图片数，词典里没有时扩展据此新增
  const known = await env.DB.prepare('SELECT count FROM tags WHERE tag = ?').bind(tag).first();

  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await readCommunity(env);
    const current = data.entries.get(tag) || null;
    // 编辑页打开以后别人改过这个标签，不覆盖
    if (body.base !== undefined && !sameEntry(body.base, current)) {
      return json({ error: '这个标签刚被别人修改过，请重新加载后再改', entry: current }, 409);
    }
    const r = applyEdit(data, tag, v.value, known ? known.count : 0);
    if (r.action === 'none') return json({ action: 'none', entry: r.after });
    const res = await gh(`/repos/${c.repo}/contents/${c.path}`, {
      token: await installationToken(env),
      method: 'PUT',
      body: {
        message: commitMessage(r.action, tag, r.after, v.value.note),
        content: bytesToB64(enc.encode(serializeCommunity(data))),
        branch: c.branch,
        ...(sha ? { sha } : {}),
        author: { name: user.login, email: `${user.id}+${user.login}@users.noreply.github.com` },
      },
    });
    // 文件在读和写之间被别的提交改了，重读再来
    if (res.status === 409 || res.status === 422) continue;
    if (!res.ok) throw new Error(`提交到 GitHub 失败：HTTP ${res.status}`);
    const commit = (await res.json()).commit || {};
    await env.DB.prepare(
      'INSERT INTO edits (tag, user_id, login, avatar, action, label, aliases, note, sha, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(tag, user.id, user.login, user.avatar || '', r.action, r.after?.label || '', (r.after?.aliases || []).join('/'), v.value.note, commit.sha || '', Date.now())
      .run();
    purge(request, ctx, '/api/community');
    return json({ action: r.action, entry: r.after, commit: { sha: commit.sha, url: commit.html_url } });
  }
  return json({ error: '同时有其他修改在提交，请稍后再试' }, 409);
}

async function history(url, env) {
  const tag = normalizeTag(url.searchParams.get('tag') || '');
  if (!tag) return json({ error: '标签格式不对' }, 400);
  const { results } = await env.DB.prepare(
    'SELECT login, user_id, avatar, action, label, aliases, note, sha, created_at FROM edits WHERE tag = ? ORDER BY created_at DESC, id DESC LIMIT 50',
  )
    .bind(tag)
    .all();
  return json({ items: results }, 200, { 'Cache-Control': 'no-store' });
}

// ---- Danbooru 新标签 ----
// D1 每次调用最多 50 条查询（免费版），整批标签作为一个 JSON 参数交给 json_each，每 TAGS_PER_QUERY 个只占一条查询
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

async function isAdmin(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return !!env.ADMIN_TOKEN && !!token && sameSecret(token, env.ADMIN_TOKEN);
}

function page(env, user) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return new Response(editorPage(env, nonce, user), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': pageCsp(nonce),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin',
      'X-Frame-Options': 'DENY',
    },
  });
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  if (method === 'GET' && (pathname === '/' || /^\/(list|edit)(\/|$)/.test(pathname))) return page(env, await sessionUser(request, env));
  if (method === 'GET' && pathname === '/auth/login') return login(request, env, url);
  if (method === 'GET' && pathname === '/auth/callback') return callback(request, env, url);
  if (method === 'POST' && pathname === '/auth/logout') return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) } });
  if (method === 'GET' && pathname === '/api/me') return json({ user: await sessionUser(request, env) }, 200, { 'Cache-Control': 'no-store' });
  if (method === 'GET' && pathname === '/api/community') {
    return cached(request, ctx, '/api/community', 30, async () => {
      const { sha, data } = await readCommunity(env);
      return { sha, entries: [...data.entries.values()] };
    });
  }
  const m = pathname.match(/^\/api\/tags\/(.+)$/);
  if (method === 'PUT' && m) return editTag(request, env, ctx, m[1]);
  if (method === 'GET' && pathname === '/api/history') return history(url, env);
  if (method === 'GET' && pathname === '/api/tags') {
    return cached(request, ctx, '/api/tags', 3600, async () => {
      const { results } = await env.DB.prepare('SELECT tag, category, count, created_at FROM tags ORDER BY count DESC LIMIT 20000').all();
      return { updated: Date.now(), tags: results };
    });
  }
  if (method === 'POST' && pathname === '/api/admin/tags') {
    if (!(await isAdmin(request, env))) return json({ error: '口令不对' }, 401);
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.tags) || body.tags.length > MAX_TAGS_PER_POST) return json({ error: `tags 必须是数组，最多 ${MAX_TAGS_PER_POST} 个` }, 400);
    const r = await storeTags(env, body.tags);
    purge(request, ctx, '/api/tags');
    return json(r);
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
