// NovelAI Tag Editor：社区标签译名的编辑器（Cloudflare Worker + D1 + GitHub App），仿照 EhTagTranslation 的 ehtt.vercel.app。
// 用 GitHub 登录后修改标签的名称和检索词。修改先存进 D1 等待审核，审核员（REVIEWERS）通过后，Worker 用 GitHub App
// 以提交修改的人为作者把它提交到仓库的 data/zh-community.tsv；审核员自己的修改直接提交。脚本和扩展从 GitHub 拉这个文件。
// 历史就是 git 历史，D1 另记一份编辑日志给编辑页看。
//   GET  /  /list/:类别  /edit/:标签  /review   编辑器页面（同一个单页应用）
//   GET  /zh-tags.tsv                    词典（wrangler.toml 的 [assets] 把 dist/ 一起部署）
//   GET  /auth/login  /auth/callback     GitHub 登录；POST /auth/logout 退出
//   GET  /api/me                         当前登录的用户
//   GET  /api/community                  社区数据的当前版本（从 GitHub 读，缓存 30 秒）
//   PUT  /api/tags/:标签                 修改 { label, aliases, note, base }，需要登录；不是审核员时存为待审核
//   GET  /api/submissions?status=&tag=&user=&user_id=   提交的修改（默认待审核的）
//   POST /api/submissions/:id/approve    通过，提交到 GitHub；POST /api/submissions/:id/reject 驳回 { reason }，只有审核员能用
//   POST /api/submissions/:id/withdraw   提交的人撤回自己待审核的修改
//   GET  /api/history?tag=               这个标签的编辑日志（已提交到 GitHub 的修改）
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
  cleanNote,
} from './rules.js';
import { editorPage, pageCsp } from './pages.js';

const TAGS_PER_QUERY = 1000;
const SESSION_DAYS = 30;
const GH_API = 'https://api.github.com';
const UA = 'NovelAI-CN Tag Editor (+https://github.com/TomorrowX6/NovelAI-CN)';
const CORS = { 'Access-Control-Allow-Origin': '*' };

const loginSet = (s) =>
  new Set(
    String(s || '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );

const conf = (env) => ({
  repo: env.GH_REPO || 'TomorrowX6/NovelAI-CN',
  branch: env.GH_BRANCH || 'main',
  path: env.DATA_PATH || 'data/zh-community.tsv',
  minAccountDays: +(env.MIN_ACCOUNT_DAYS ?? 30),
  editsPerHour: +(env.EDITS_PER_HOUR ?? 30),
  blocked: loginSet(env.BLOCKED_USERS),
  // GitHub 用户名或数字 id；用户名可能被改掉后让别人注册走，填 id 更稳妥
  reviewers: loginSet(env.REVIEWERS),
});

const isReviewer = (env, user) => {
  const r = conf(env).reviewers;
  return r.has(String(user.login).toLowerCase()) || r.has(String(user.id));
};

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
    // 审核员每次按当前的 REVIEWERS 判断，不存在 Cookie 里
    return { id: user.id, login: user.login, avatar: user.avatar, reviewer: isReviewer(env, user) };
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

async function readCommunity(env, ref = conf(env).branch) {
  const c = conf(env);
  const token = await installationToken(env);
  const r = await gh(`/repos/${c.repo}/contents/${c.path}?ref=${encodeURIComponent(ref)}`, { token });
  if (r.status === 404) return { sha: null, data: parseCommunity('') };
  if (!r.ok) throw new Error(`读取 ${c.path} 失败：HTTP ${r.status}`);
  const d = await r.json();
  let text;
  if (d.encoding === 'base64' && d.content) {
    text = new TextDecoder().decode(b64ToBytes(d.content.replace(/\s/g, '')));
  } else {
    // 超过 1 MB 的文件不内联内容，另取原文
    const raw = await gh(`/repos/${c.repo}/contents/${c.path}?ref=${encodeURIComponent(ref)}`, { token, accept: 'application/vnd.github.raw' });
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

// ---- 编辑和审核 ----
const sameEntry = (a, b) => (a?.label || '') === (b?.label || '') && (a?.aliases || []).join('/') === (b?.aliases || []).join('/');
const BUSY = '同时有其他修改在提交，请稍后再试';

// 修改要从编辑器页面发来：Cookie 是 SameSite=Lax，再核对来源和 JSON 格式，别的网站发不来
function crossSite(request) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: '来源不对' }, 403);
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'application/json') return json({ error: '请求格式不对' }, 415);
  return null;
}

// Preparing work may expire. Publishing work is durable and cannot be rejected or
// reclaimed by a clock: an old non-force ref update may still be in flight.
const CLAIM_MS = 120000;
const operationRow = (env, id) => env.DB.prepare('SELECT * FROM publication_operations WHERE id = ?').bind(id).first();
const operationGuard = "id = ? AND owner = ? AND phase IN ('preparing', 'publishing') AND candidate IS ?";

async function git(env, path, method = 'GET', body) {
  const res = await gh(`/repos/${conf(env).repo}${path}`, { token: await installationToken(env), method, body });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status}`);
  return res.json();
}
const refPath = (env) => `/git/refs/heads/${conf(env).branch.split('/').map(encodeURIComponent).join('/')}`;
const branchHead = async (env) => (await git(env, refPath(env).replace('/git/refs/', '/git/ref/'))).object.sha;

async function startOperation(env, details, submissionId = null) {
  const requestKey = submissionId ? `submission:${submissionId}` : await sha256(JSON.stringify([conf(env).repo, conf(env).branch, conf(env).path, details]));
  const id = crypto.randomUUID();
  const owner = crypto.randomUUID();
  const now = Date.now();
  const insert = env.DB.prepare(
    "INSERT OR IGNORE INTO publication_operations (id, request_key, submission_id, phase, owner, updated_at, details) " +
    "SELECT ?, ?, ?, 'preparing', ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM submissions WHERE id = ? AND status = 'pending')",
  ).bind(id, requestKey, submissionId, owner, now, JSON.stringify(details), submissionId, submissionId);
  if (submissionId) {
    await env.DB.batch([insert, env.DB.prepare(
      "UPDATE submissions SET status = 'approving', reviewer = ?, reason = '', reviewed_at = ? WHERE id = ? AND status = 'pending' " +
      "AND EXISTS (SELECT 1 FROM publication_operations WHERE id = ? AND owner = ? AND phase = 'preparing')",
    ).bind(details.reviewer.login, now, submissionId, id, owner)]);
  } else await insert.run();
  let op = await env.DB.prepare("SELECT * FROM publication_operations WHERE request_key = ? AND phase IN ('preparing', 'publishing')").bind(requestKey).first();
  if (!op) return null;
  if (op.phase === 'publishing') return op;
  if (op.owner === owner) return op;
  // Only preparation is reclaimable. Every later write and ref publication checks ownership.
  op = await env.DB.prepare(
    "UPDATE publication_operations SET owner = ?, updated_at = ? WHERE id = ? AND phase = 'preparing' AND updated_at < ? RETURNING *",
  ).bind(owner, now, op.id, now - CLAIM_MS).first();
  return op;
}

async function abortOperation(env, op) {
  await env.DB.batch([
    env.DB.prepare("UPDATE submissions SET status = 'pending', reviewer = '', reviewed_at = NULL WHERE id = ? AND status = 'approving' " +
      `AND EXISTS (SELECT 1 FROM publication_operations WHERE ${operationGuard})`).bind(op.submission_id, op.id, op.owner, op.candidate),
    env.DB.prepare(`UPDATE publication_operations SET phase = 'aborted', updated_at = ? WHERE ${operationGuard}`).bind(Date.now(), op.id, op.owner, op.candidate),
  ]);
}

async function finishOperation(request, env, ctx, op, result) {
  const d = JSON.parse(op.details);
  const args = [op.id, op.owner, op.candidate];
  const guard = `${operationGuard} AND (submission_id IS NULL OR EXISTS (SELECT 1 FROM submissions WHERE id = submission_id AND status = 'approving'))`;
  const statements = [];
  if (result.action !== 'none') statements.push(env.DB.prepare(
    'INSERT INTO edits (tag, user_id, login, avatar, action, label, aliases, note, sha, created_at) ' +
    `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM publication_operations WHERE ${guard}`,
  ).bind(d.tag, d.author.id, d.author.login, d.author.avatar || '', result.action, result.entry?.label || '', (result.entry?.aliases || []).join('/'), d.value.note, result.commit?.sha || '', Date.now(), ...args));
  statements.push(
    env.DB.prepare("UPDATE submissions SET status = 'approved', sha = ?, reviewed_at = ? WHERE id = ? AND status = 'approving' " +
      `AND EXISTS (SELECT 1 FROM publication_operations WHERE ${operationGuard})`).bind(result.commit?.sha || '', Date.now(), op.submission_id, ...args),
    env.DB.prepare(`UPDATE publication_operations SET phase = 'done', outcome = ?, updated_at = ? WHERE ${operationGuard}`).bind(JSON.stringify(result), Date.now(), ...args),
  );
  await env.DB.batch(statements);
  const done = await operationRow(env, op.id);
  if (done.phase !== 'done') return { busy: true };
  purge(request, ctx, '/api/community');
  return JSON.parse(done.outcome);
}

async function prepareCandidate(env, op) {
  const d = JSON.parse(op.details);
  const head = await branchHead(env);
  const [{ data }, parent, known] = await Promise.all([
    readCommunity(env, head), git(env, `/git/commits/${head}`), env.DB.prepare('SELECT count FROM tags WHERE tag = ?').bind(d.tag).first(),
  ]);
  const current = data.entries.get(d.tag) || null;
  if (d.base !== undefined && !sameEntry(d.base, current)) return { conflict: current };
  const r = applyEdit(data, d.tag, d.value, known?.count || 0);
  if (r.action === 'none') return { action: 'none', entry: r.after };
  const author = { name: d.author.login, email: `${d.author.id}+${d.author.login}@users.noreply.github.com`, date: new Date(op.updated_at).toISOString() };
  const candidate = JSON.stringify({
    parent: head, baseTree: parent.tree.sha, content: serializeCommunity(data), author,
    message: `${commitMessage(r.action, d.tag, r.after, d.value.note, d.reviewer)}\n\nNovelAI-Operation: ${op.id}`,
    action: r.action, entry: r.after,
  });
  const row = await env.DB.prepare(`UPDATE publication_operations SET phase = 'publishing', candidate = ?, updated_at = ? WHERE ${operationGuard} RETURNING *`)
    .bind(candidate, Date.now(), op.id, op.owner, op.candidate).first();
  return row ? { op: row } : { busy: true };
}

async function publish(request, env, ctx, details, submissionId = null) {
  let op = await startOperation(env, details, submissionId);
  if (!op) return { busy: true };
  // A bounded request can continue on the next retry; persisted candidates survive every await.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!op.candidate) {
      let prepared;
      try { prepared = await prepareCandidate(env, op); }
      catch (error) { await abortOperation(env, op); throw error; }
      if ('conflict' in prepared) { await abortOperation(env, op); return prepared; }
      if (prepared.action === 'none') return finishOperation(request, env, ctx, op, prepared);
      if (prepared.busy) return prepared;
      op = prepared.op;
    }
    let candidate = JSON.parse(op.candidate);
    if (!candidate.sha) {
      // Explicit author AND committer timestamps make object creation deterministic on retry.
      const tree = await git(env, '/git/trees', 'POST', { base_tree: candidate.baseTree, tree: [{ path: conf(env).path, mode: '100644', type: 'blob', content: candidate.content }] });
      const commit = await git(env, '/git/commits', 'POST', { message: candidate.message, tree: tree.sha, parents: [candidate.parent], author: candidate.author, committer: candidate.author });
      candidate.sha = commit.sha;
      const row = await env.DB.prepare(`UPDATE publication_operations SET candidate = ? WHERE ${operationGuard} RETURNING *`)
        .bind(JSON.stringify(candidate), op.id, op.owner, op.candidate).first();
      if (!row) return { busy: true };
      op = row;
    }
    const head = await branchHead(env);
    const comparison = await git(env, `/compare/${candidate.sha}...${head}`);
    if (comparison.status === 'ahead' || comparison.status === 'identical') {
      return finishOperation(request, env, ctx, op, { action: candidate.action, entry: candidate.entry, commit: { sha: candidate.sha, url: `https://github.com/${conf(env).repo}/commit/${candidate.sha}` } });
    }
    if (comparison.status === 'diverged') {
      // The current branch is on a sibling lineage. A non-force PATCH of the old
      // immutable candidate can no longer succeed, even if an old request resumes.
      const row = await env.DB.prepare(`UPDATE publication_operations SET candidate = NULL WHERE ${operationGuard} RETURNING *`).bind(op.id, op.owner, op.candidate).first();
      if (!row) return { busy: true };
      op = row;
      continue;
    }
    if (head !== candidate.parent) return { busy: true }; // e.g. an external branch rewind
    const owned = await env.DB.prepare(`SELECT 1 FROM publication_operations WHERE ${operationGuard} AND phase = 'publishing'`).bind(op.id, op.owner, op.candidate).first();
    if (!owned) return { busy: true };
    const res = await gh(`/repos/${conf(env).repo}${refPath(env)}`, { token: await installationToken(env), method: 'PATCH', body: { sha: candidate.sha, force: false } });
    if (res.status === 409 || res.status === 422) continue;
    if (!res.ok) throw new Error(`GitHub ref publication failed: HTTP ${res.status}`);
    return finishOperation(request, env, ctx, op, { action: candidate.action, entry: candidate.entry, commit: { sha: candidate.sha, url: `https://github.com/${conf(env).repo}/commit/${candidate.sha}` } });
  }
  return { busy: true };
}

// Keep preparing work pending; irreversible publication has its own public status.
const submissionItem = (s) => ({
  id: s.id,
  tag: s.tag,
  action: s.action,
  label: s.label,
  aliases: s.aliases ? s.aliases.split('/') : [],
  note: s.note,
  base: JSON.parse(s.base),
  login: s.login,
  user_id: s.user_id,
  avatar: s.avatar,
  status: s.status === 'approving' ? (s.publication_phase === 'publishing' ? 'publishing' : 'pending') : s.status,
  reviewer: s.reviewer,
  reason: s.reason,
  sha: s.sha,
  created_at: s.created_at,
  reviewed_at: s.reviewed_at,
});

async function editTag(request, env, ctx, rawTag) {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: '请先用 GitHub 登录' }, 401);
  const bad = crossSite(request);
  if (bad) return bad;
  const tag = normalizeTag(decodeURIComponent(rawTag));
  if (!tag) return json({ error: '英文标签格式不对：只能用英文字母、数字和符号，最多 100 个字符' }, 400);
  const body = await request.json().catch(() => null);
  const v = validateEdit(body);
  if (v.error) return json({ error: v.error }, 400);
  // 编辑页打开以后别人改过这个标签，不覆盖
  const conflict = (entry) => json({ error: '这个标签刚被别人修改过，请重新加载后再改', entry }, 409);

  if (user.reviewer) {
    const r = await publish(request, env, ctx, { tag, value: v.value, base: body.base, author: user });
    if (r.busy) return json({ error: BUSY }, 409);
    if ('conflict' in r) return conflict(r.conflict);
    return json(r);
  }

  // 其他人的修改先存起来，审核员通过后才提交到 GitHub
  const c = conf(env);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM submissions WHERE user_id = ? AND created_at > ?').bind(user.id, Date.now() - 36e5).first();
  if (recent && recent.n >= c.editsPerHour) return json({ error: `每小时最多提交 ${c.editsPerHour} 次，请稍后再试` }, 429);
  const { data } = await readCommunity(env);
  const current = data.entries.get(tag) || null;
  if (body.base !== undefined && !sameEntry(body.base, current)) return conflict(current);
  const r = applyEdit(data, tag, v.value);
  // 同一个人对同一个标签只留最新的一份待审核修改；改回现在的内容就是撤回
  const now = Date.now();
  const statements = [env.DB.prepare("UPDATE submissions SET status = 'withdrawn', reviewed_at = ? WHERE tag = ? AND user_id = ? AND status = 'pending'").bind(now, tag, user.id)];
  if (r.action !== 'none') statements.push(env.DB.prepare(
    'INSERT INTO submissions (tag, user_id, login, avatar, action, label, aliases, note, base, created_at) ' +
    "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM submissions WHERE tag = ? AND user_id = ? AND status = 'approving') RETURNING *",
  ).bind(tag, user.id, user.login, user.avatar || '', r.action, v.value.label, v.value.aliases.join('/'), v.value.note,
    JSON.stringify(current && { label: current.label, aliases: current.aliases }), now, tag, user.id));
  else statements.push(env.DB.prepare("SELECT 1 FROM submissions WHERE tag = ? AND user_id = ? AND status = 'approving'").bind(tag, user.id));
  const result = await env.DB.batch(statements);
  if (r.action === 'none') {
    if (result[1].results.length) return json({ error: BUSY }, 409);
    return json({ action: 'none', entry: r.after, withdrawn: result[0].meta.changes > 0 });
  }
  const row = result[1].results[0];
  if (!row) return json({ error: BUSY }, 409);
  return json({ action: 'pending', submission: submissionItem(row) }, 202);
}

const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'];
const DONE = { approving: '正在提交到仓库，请稍后刷新', approved: '已经通过了', rejected: '已经驳回了', withdrawn: '已经撤回了' };
const SUBMISSIONS_LIMIT = 200;

async function listSubmissions(url, env) {
  const p = url.searchParams;
  const status = p.get('status') || 'pending';
  const where = [];
  const args = [];
  if (status === 'pending') {
    where.push("status IN ('pending', 'approving')");
  } else if (status !== 'all') {
    if (!STATUSES.includes(status)) return json({ error: '状态不对' }, 400);
    where.push('status = ?');
    args.push(status);
  }
  if (p.get('tag')) {
    const tag = normalizeTag(p.get('tag'));
    if (!tag) return json({ error: '标签格式不对' }, 400);
    where.push('tag = ?');
    args.push(tag);
  }
  if (p.get('user')) {
    where.push('login = ? COLLATE NOCASE');
    args.push(p.get('user'));
  }
  // 「我的提交」按 GitHub 用户 id 找，改过用户名也找得到以前的修改
  const uid = p.get('user_id');
  if (uid) {
    if (!/^\d{1,15}$/.test(uid)) return json({ error: '用户 id 不对' }, 400);
    where.push('user_id = ?');
    args.push(+uid);
  }
  const { results } = await env.DB.prepare(
    `SELECT submissions.*, (SELECT phase FROM publication_operations WHERE submission_id = submissions.id AND phase IN ('preparing', 'publishing') LIMIT 1) AS publication_phase FROM submissions${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ${SUBMISSIONS_LIMIT}`,
  )
    .bind(...args)
    .all();
  return json({ items: results.map(submissionItem) }, 200, { 'Cache-Control': 'no-store' });
}

// 这条修改已经不是待审核的了（或者找不到）
async function notOpen(env, id) {
  const s = await env.DB.prepare("SELECT submissions.*, (SELECT phase FROM publication_operations WHERE submission_id = submissions.id AND phase = 'publishing' LIMIT 1) AS publication_phase FROM submissions WHERE id = ?").bind(id).first();
  if (!s) return json({ error: '找不到这条修改' }, 404);
  return json({ error: `这条修改${DONE[s.status]}`, item: submissionItem(s) }, 409);
}

async function review(request, env, ctx, id, verdict) {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: '请先用 GitHub 登录' }, 401);
  if (!user.reviewer) return json({ error: '只有审核员能审核' }, 403);
  const bad = crossSite(request);
  if (bad) return bad;
  const body = await request.json().catch(() => null);
  if (verdict === 'reject') {
    // Expired preparation can be revoked; publishing (including unknown remote
    // outcomes) never expires. Abort first and gate the status write by its token.
    const token = crypto.randomUUID();
    const now = Date.now();
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE publication_operations SET phase = 'aborted', owner = ?, updated_at = ? WHERE submission_id = ? AND phase = 'preparing' AND updated_at < ?").bind(token, now, id, now - CLAIM_MS),
      env.DB.prepare("UPDATE submissions SET status = 'rejected', reviewer = ?, reason = ?, reviewed_at = ? WHERE id = ? AND (status = 'pending' OR (status = 'approving' AND EXISTS (SELECT 1 FROM publication_operations WHERE submission_id = ? AND owner = ? AND phase = 'aborted'))) RETURNING *")
        .bind(user.login, cleanNote(body?.reason), now, id, id, token),
    ]);
    const row = results[1].results[0];
    return row ? json({ item: submissionItem(row) }) : notOpen(env, id);
  }
  const s = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?').bind(id).first();
  if (!s || !['pending', 'approving'].includes(s.status)) return notOpen(env, id);
  const r = await publish(request, env, ctx, {
    tag: s.tag,
    value: { label: s.label, aliases: s.aliases ? s.aliases.split('/') : [], note: s.note },
    base: JSON.parse(s.base),
    author: { id: s.user_id, login: s.login, avatar: s.avatar },
    reviewer: user,
  }, id);
  if (r.busy) return json({ error: BUSY }, 409);
  if ('conflict' in r) return json({ error: '\u63d0\u4ea4\u4ee5\u540e\u8fd9\u4e2a\u6807\u7b7e\u53c8\u88ab\u6539\u8fc7\u4e86', entry: r.conflict }, 409);
  const row = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?').bind(id).first();
  return json({ ...r, item: submissionItem(row) });
}

// 提交的人撤回自己待审核的修改
async function withdraw(request, env, id) {
  const user = await sessionUser(request, env);
  if (!user) return json({ error: '请先用 GitHub 登录' }, 401);
  const bad = crossSite(request);
  if (bad) return bad;
  const row = await env.DB.prepare("UPDATE submissions SET status = 'withdrawn', reviewed_at = ? WHERE id = ? AND user_id = ? AND status = 'pending' RETURNING *")
    .bind(Date.now(), id, user.id)
    .first();
  if (row) return json({ item: submissionItem(row) });
  const s = await env.DB.prepare('SELECT user_id FROM submissions WHERE id = ?').bind(id).first();
  if (s && s.user_id !== user.id) return json({ error: '只能撤回自己的修改' }, 403);
  return notOpen(env, id);
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
  if (method === 'GET' && (pathname === '/' || /^\/(list|edit|review)(\/|$)/.test(pathname))) return page(env, await sessionUser(request, env));
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
  if (method === 'GET' && pathname === '/api/submissions') return listSubmissions(url, env);
  const s = pathname.match(/^\/api\/submissions\/(\d+)\/(approve|reject|withdraw)$/);
  if (method === 'POST' && s) return s[2] === 'withdraw' ? withdraw(request, env, +s[1]) : review(request, env, ctx, +s[1], s[2]);
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
