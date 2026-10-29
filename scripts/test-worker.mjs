// 社区标签编辑器（worker/）的测试：用 Node 自带的 SQLite 模拟 D1、用假的 GitHub（OAuth、App 令牌、仓库文件）代替网络，
// 直接调用 Worker 的 fetch。也检查编辑器写出的数据能原样通过扩展端（src/community.js）的检查。
// node scripts/test-worker.mjs   （需要 Node.js 22.13 或更高版本）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/src/index.js';
import {
  normalizeTag,
  cleanZh,
  parseAliases,
  isSafeNewTag,
  parseDanbooruTags,
  danbooruTagsUrl,
  dictionaryLookup,
  parseCommunity,
  serializeCommunity,
  validateEdit,
  applyEdit,
  commitMessage,
  COMMUNITY_HEADER,
} from '../worker/src/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function check(ok, msg) {
  if (!ok) {
    failed++;
    console.log(`✗ ${msg}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---- 规则 ----
for (const [input, expect] of [
  ['Cat_Ears', 'cat ears'],
  ['  long   hair ', 'long hair'],
  ['^_^', '^_^'],
  ['o_o', 'o_o'],
  ['hatsune_miku_(cosplay)', 'hatsune miku (cosplay)'],
  ['猫耳', null],
  ['', null],
  ['a'.repeat(101), null],
  [42, null],
]) {
  check(normalizeTag(input) === expect, `normalizeTag(${JSON.stringify(input)}) = ${JSON.stringify(normalizeTag(input))}，期望 ${JSON.stringify(expect)}`);
}
for (const [input, expect] of [
  ['猫耳', '猫耳'],
  ['  猫  耳 ', '猫 耳'],
  ['neko', null],
  ['<b>猫耳</b>', null],
  ['猫耳 https://example.com', null],
  ['猫耳 www.example.com', null],
  ['javascript:猫', null],
  ['猫\u0000耳', null],
  ['猫'.repeat(61), null],
  ['한국어', null],
  [String.fromCharCode(0x8c48), String.fromCharCode(0x8c48)],
  [String.fromCharCode(0xf900), String.fromCharCode(0xf900)],
]) {
  check(cleanZh(input, 60) === expect, `cleanZh(${JSON.stringify(input)}) = ${JSON.stringify(cleanZh(input, 60))}`);
}
check(eq(parseAliases('猫娘/兽耳娘、猫娘，喵'), ['猫娘', '兽耳娘', '喵']), 'parseAliases 分隔和去重');
check(parseAliases('猫/neko') === null, 'parseAliases 有一个不合格就整体不合格');
check(parseAliases('一/二/三/四/五/六/七/八/九') === null, 'parseAliases 最多 8 个');
for (const [tag, ok] of [
  ['mary sue (black souls)', true],
  ["kitasan black (crane's ambition) (umamusume)", true],
  ['a, b', false],
  ['a|b', false],
  ['{a}', false],
  ['[a]', false],
  ['a::b', false],
  ['#a', false],
  ['<a>', false],
]) {
  check(isSafeNewTag(tag) === ok, `isSafeNewTag(${JSON.stringify(tag)}) 应为 ${ok}`);
}
check(
  eq(
    parseDanbooruTags([
      { name: 'Mary_Sue_(Black_Souls)', category: 4, post_count: 160, created_at: '2026-10-20T13:09:01Z' },
      { name: 'some_artist', category: 1, post_count: 500, created_at: '2026-10-20T00:00:00Z' },
      { name: 'rare_tag', category: 0, post_count: 49, created_at: '2026-10-20T00:00:00Z' },
      { name: 'bad,tag', category: 0, post_count: 100, created_at: '2026-10-20T00:00:00Z' },
      null,
    ]),
    [{ tag: 'mary sue (black souls)', category: 4, count: 160, created_at: Date.parse('2026-10-20T13:09:01Z') }],
  ),
  'parseDanbooruTags 只要通用、作品、角色、元标签，图片数够多、名字安全的',
);
{
  const q = new URL(danbooruTagsUrl(12345)).searchParams;
  check(q.get('search[category]') === '0,3,4,5' && q.get('search[post_count]') === '>=50' && q.get('page') === 'b12345' && q.get('only').split(',').includes('id'), 'Danbooru 请求参数');
  check(!new URL(danbooruTagsUrl(0)).searchParams.has('page'), 'Danbooru 第一页不带 page');
}
{
  // 词典每行：标签 \t 次数 \t 译名 \t 检索词 \t 旧标签名 \t 类别
  const inDict = dictionaryLookup(['long hair\t100\t长发\t\t\t0', '^_^\t10\t笑眼\t\t\t0', 'h&k g11\t500\tG11\t\t\t0', 'china dress\t9\t旗袍\t\tqipao\t0', ''].join('\n'));
  check(inDict('long_hair') && inDict('Long_Hair') && inDict('^_^') && inDict('h&k_g11') && inDict('qipao'), 'dictionaryLookup 按扩展的查法找到词典里的标签和旧名');
  check(!inDict('cum_puddle') && !inDict('long'), 'dictionaryLookup 词典里没有的标签');
}

// 数据文件：一个标签一行，按标签排序，空的列从行尾去掉
{
  const text = [...COMMUNITY_HEADER, 'smile\t笑\t微笑/笑容', 'cat ears\t\t喵耳', 'mary sue (black souls)\t玛丽苏\t\t160'].join('\n') + '\n';
  const data = parseCommunity(text);
  check(eq(plain(data.entries.get('cat ears')), { tag: 'cat ears', label: '', aliases: ['喵耳'], count: 0 }), 'parseCommunity 读出译名为空的条目');
  check(data.entries.get('mary sue (black souls)').count === 160, 'parseCommunity 读出图片数');
  check(
    serializeCommunity(data) === [...COMMUNITY_HEADER, 'cat ears\t\t喵耳', 'mary sue (black souls)\t玛丽苏\t\t160', 'smile\t笑\t微笑/笑容'].join('\n') + '\n',
    `serializeCommunity 按标签排序：${JSON.stringify(serializeCommunity(data))}`,
  );
  check(eq(parseCommunity('').header, COMMUNITY_HEADER), '空文件用默认说明');
  check(eq(parseCommunity('# 旧的说明\nsmile\t笑\n').header, COMMUNITY_HEADER), '文件里的旧说明换成当前的说明');
  check(serializeCommunity(parseCommunity(serializeCommunity(data))) === serializeCommunity(data), '读写往返不变');

  check(!!validateEdit(null).error && !!validateEdit({ label: 'neko' }).error && !!validateEdit({ aliases: '猫/neko' }).error, 'validateEdit 拒绝不合格的内容');
  check(eq(validateEdit({ label: ' 猫耳 ', aliases: '喵耳/兽耳', note: 'a\nb' }).value, { label: '猫耳', aliases: ['喵耳', '兽耳'], note: 'a b' }), 'validateEdit 规范化');

  const d = parseCommunity(text);
  check(applyEdit(d, 'cat ears', { label: '', aliases: ['喵耳'] }).action === 'none', 'applyEdit 内容没变');
  check(applyEdit(d, 'cat ears', { label: '猫耳', aliases: ['喵耳'] }).action === 'update', 'applyEdit 修改');
  check(applyEdit(d, 'blush', { label: '脸红', aliases: [] }).action === 'add', 'applyEdit 新增');
  check(applyEdit(d, 'mary sue (black souls)', { label: '玛丽苏（黑魂）', aliases: [] }).after.count === 160, 'applyEdit 保留图片数');
  const del = applyEdit(d, 'smile', { label: '', aliases: [] });
  check(del.action === 'delete' && !d.entries.has('smile'), 'applyEdit 都清空就删除');
  check(applyEdit(d, 'nothing', { label: '', aliases: [] }).action === 'none', 'applyEdit 删除不存在的条目');
  check(
    commitMessage('add', 'blush', { label: '脸红', aliases: ['害羞'] }, '常见') === '新增 blush\n\n名称：脸红\n检索词：害羞\n说明：常见',
    `commitMessage：${JSON.stringify(commitMessage('add', 'blush', { label: '脸红', aliases: ['害羞'] }, '常见'))}`,
  );
  check(commitMessage('delete', 'smile', null, '') === '删除 smile', '删除的提交说明');
  check(
    commitMessage('update', 'smile', { label: '笑', aliases: [] }, '', { id: 7, login: 'Rev' }) === '修改 smile\n\n名称：笑\n\nReviewed-by: Rev <7+Rev@users.noreply.github.com>',
    '审核员通过的提交说明注明审核员',
  );
}

// ---- 假的 D1 和 GitHub ----
// D1 的 prepare().bind().first()/all()/run() 用 node:sqlite 实现；queries 记下执行了几条查询，免费版 D1 每次调用最多 50 条
let queries = 0;
function d1(db) {
  return {
    prepare(sql) {
      const stmt = (args) => ({
        bind: (...a) => stmt(a),
        first: async () => (queries++, db.prepare(sql).get(...args) ?? null),
        all: async () => (queries++, { success: true, results: db.prepare(sql).all(...args) }),
        run: async () => {
          queries++;
          const r = db.prepare(sql).run(...args);
          return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
        },
      });
      return stmt([]);
    },
  };
}

const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(path.join(ROOT, 'worker', 'schema.sql'), 'utf8'));
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  DB: d1(db),
  GH_REPO: 'owner/repo',
  GH_BRANCH: 'main',
  DATA_PATH: 'data/zh-community.tsv',
  GH_APP_ID: '12345',
  GH_APP_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  GH_CLIENT_ID: 'client-id',
  GH_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: 'session-secret',
  ADMIN_TOKEN: 'admin-token',
  MIN_ACCOUNT_DAYS: '30',
  EDITS_PER_HOUR: '8',
  BLOCKED_USERS: 'spammer',
  // Alice 的 id：她的修改直接提交，其他人的修改要她审核
  REVIEWERS: '1001',
};
const ctx = { waitUntil() {} };
const BASE = 'https://editor.example';

// 仓库里的 data/zh-community.tsv
const gh = { file: null, sha: null, puts: [], log: [], users: {}, conflictOnce: null, installationLookups: 0 };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const verifyJwt = (jwt) => {
  const [h, p, s] = jwt.split('.');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'));
  return ok && JSON.parse(Buffer.from(p, 'base64url')).iss === env.GH_APP_ID;
};
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = init.method || 'GET';
  const auth = (init.headers?.Authorization || '').replace(/^Bearer /, '');
  const body = init.body ? JSON.parse(init.body) : null;
  const res = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  gh.log.push(`${method} ${url.pathname}`);
  if (url.href === 'https://github.com/login/oauth/access_token') {
    const ok = body.client_id === env.GH_CLIENT_ID && body.client_secret === env.GH_CLIENT_SECRET && gh.users[body.code];
    return res(ok ? { access_token: `user-token-${body.code}` } : { error: 'bad_verification_code' });
  }
  if (url.origin !== 'https://api.github.com') throw new Error(`没有模拟的请求：${url}`);
  if (url.pathname === '/user') {
    const u = gh.users[auth.replace('user-token-', '')];
    return u ? res(u) : res({ message: 'Bad credentials' }, 401);
  }
  if (url.pathname === '/repos/owner/repo/installation') {
    gh.installationLookups++;
    return verifyJwt(auth) ? res({ id: 777 }) : res({}, 401);
  }
  if (url.pathname === '/app/installations/777/access_tokens' && method === 'POST') {
    return verifyJwt(auth) ? res({ token: 'inst-token', expires_at: new Date(Date.now() + 36e5).toISOString() }) : res({}, 401);
  }
  if (url.pathname === '/repos/owner/repo/contents/data/zh-community.tsv') {
    if (auth !== 'inst-token') return res({}, 401);
    if (method === 'GET') {
      if (gh.file === null) return res({ message: 'Not Found' }, 404);
      return res({ sha: gh.sha, encoding: 'base64', content: b64(gh.file).replace(/(.{60})/g, '$1\n') });
    }
    if (method === 'PUT') {
      if (gh.conflictOnce) {
        // 读和写之间别人提交了一次
        gh.conflictOnce();
        gh.conflictOnce = null;
      }
      if ((body.sha || null) !== gh.sha) return res({ message: 'sha does not match' }, 409);
      gh.puts.push(body);
      gh.file = Buffer.from(body.content, 'base64').toString('utf8');
      gh.sha = crypto.createHash('sha1').update(gh.file).digest('hex');
      return res({ commit: { sha: `c${gh.puts.length}`, html_url: `https://github.com/owner/repo/commit/c${gh.puts.length}` } }, gh.puts.length === 1 ? 201 : 200);
    }
  }
  throw new Error(`没有模拟的请求：${method} ${url}`);
};

async function call(method, p, { body, cookie, origin, type = 'application/json', headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = type;
  if (cookie) h.Cookie = cookie;
  if (origin) h.Origin = origin;
  const res = await worker.fetch(
    new Request(BASE + p, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), redirect: 'manual' }),
    env,
    ctx,
  );
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, data };
}
const setCookies = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]);

// ---- 页面 ----
for (const p of ['/', '/list/character?search=cat', '/edit/cat%20ears', '/edit/*new']) {
  const res = await call('GET', p);
  const csp = res.headers.get('Content-Security-Policy') || '';
  const nonce = (csp.match(/'nonce-([^']+)'/) || [])[1];
  check(res.status === 200 && nonce && res.data.includes(`<script nonce="${nonce}">`), `${p} 返回编辑器页面，脚本带 CSP 的 nonce`);
  if (p !== '/') continue;
  check(!/script-src[^;]*'unsafe-inline'/.test(csp) && /connect-src 'self';/.test(csp), `页面 CSP：${csp}`);
  check(!/\son[a-z]+="/.test(res.data), '页面没有内联事件处理');
  const scripts = [...res.data.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  check(scripts.length === 1, `页面应有一段脚本，实际 ${scripts.length}`);
  for (const s of scripts) {
    try {
      new vm.Script(s);
    } catch (e) {
      check(false, `页面脚本语法错误：${e.message}`);
    }
  }
  check(res.data.includes('"user":null'), '没登录时页面配置里没有用户');
}
check((await call('GET', '/nope')).status === 404, '未知路径返回 404');
check(eq((await call('GET', '/api/me')).data, { user: null }), '没登录时 /api/me 为空');

// 实际页面脚本：编辑已有标签时显示当前名称和检索词，重置后仍以当前值作为未修改状态。
{
  const page = await call('GET', '/');
  const client = page.data.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) {
      const handlers = new Map();
      nodes.set(id, {
        value: '', textContent: '', hidden: false, disabled: false,
        addEventListener(type, handler) { handlers.set(type, handler); },
        click() { handlers.get('click')?.(); },
        closest() { return { classList: { toggle() {} }, querySelector: () => ({ textContent: '' }) }; },
      });
    }
    return nodes.get(id);
  };
  node('cfg').textContent = JSON.stringify({ user: { id: 1001, login: 'Alice' }, repo: 'owner/repo', branch: 'main', path: 'data/zh-community.tsv', icons: {} });
  const browser = vm.createContext({
    document: { getElementById: node, addEventListener() {}, querySelectorAll: () => [] },
    window: { addEventListener() {} }, location: { pathname: '/edit/looking%20at%20viewer', search: '' }, URLSearchParams,
  });
  vm.runInContext(client.slice(0, client.indexOf('const startParams =')), browser);
  // 预览是独立的展示功能；这里运行真实的表单初始化、校验、重置事件处理。
  vm.runInContext("renderPreview = () => {}; addRow({ tag: 'looking at viewer', label: '看向观众', extra: ['看着观众', '看镜头'], category: 0 }); renderEdit('looking at viewer');", browser);
  const formState = () => plain(vm.runInContext("({ label: $('f-name').value, aliases: $('f-aliases').value, disabled: $('submit').disabled, base: edit.base })", browser));
  check(eq(formState(), { label: '看向观众', aliases: '看着观众/看镜头', disabled: true, base: null }), `内置词典自动填充，初始状态没有修改：${JSON.stringify(formState())}`);
  node('f-name').value = '注视观众';
  vm.runInContext('validate()', browser);
  check(!node('submit').disabled, '修改自动填充的名称后可以提交');
  vm.runInContext("renderEdit('looking at viewer')", browser);
  check(node('f-name').value === '注视观众', '同一编辑页重复渲染不会覆盖正在修改的内容');
  node('reset').click();
  check(eq(formState(), { label: '看向观众', aliases: '看着观众/看镜头', disabled: true, base: null }), '重置恢复当前名称、检索词和未修改状态');

  vm.runInContext("setCommunity([{ tag: 'looking at viewer', label: '看着你', aliases: ['看向我'] }]); edit.original = null; renderEdit('looking at viewer');", browser);
  check(eq(formState(), { label: '看着你', aliases: '看向我/看着观众/看镜头', disabled: true, base: { label: '看着你', aliases: ['看向我'] } }), '社区名称优先，填入当前检索词，冲突检测仍使用原始社区数据');
  vm.runInContext("setCommunity([{ tag: 'looking at viewer', label: '', aliases: ['看向我'] }]); edit.original = null; renderEdit('looking at viewer');", browser);
  check(node('f-name').value === '看向观众' && node('f-aliases').value === '看向我/看着观众/看镜头', '仅有检索词的社区修订沿用内置名称');
  vm.runInContext("renderEdit('unknown tag')", browser);
  check(node('f-name').value === '' && node('f-aliases').value === '' && node('submit').disabled, '没有已有译名的新标签保持空白和未修改状态');
}

// ---- 登录 ----
gh.users.goodcode = { id: 1001, login: 'Alice', avatar_url: 'https://avatars.githubusercontent.com/u/1001?v=4', created_at: '2020-01-01T00:00:00Z' };
gh.users.newbie = { id: 1002, login: 'newbie', avatar_url: '', created_at: new Date().toISOString() };
gh.users.spam = { id: 1003, login: 'Spammer', avatar_url: '', created_at: '2019-01-01T00:00:00Z' };

async function login(code, returnTo = '/edit/cat%20ears') {
  const start = await call('GET', `/auth/login?return=${encodeURIComponent(returnTo)}`);
  const loc = new URL(start.headers.get('Location'));
  const oauth = setCookies(start)[0];
  const cb = await call('GET', `/auth/callback?code=${code}&state=${loc.searchParams.get('state')}`, { cookie: oauth });
  return { start, loc, cb, session: setCookies(cb).find((c) => c.startsWith('nzh_session=') && c.length > 'nzh_session='.length) };
}
{
  const { start, loc, cb, session } = await login('goodcode');
  check(start.status === 302 && loc.origin + loc.pathname === 'https://github.com/login/oauth/authorize', '登录跳到 GitHub 授权');
  check(loc.searchParams.get('client_id') === 'client-id' && loc.searchParams.get('redirect_uri') === `${BASE}/auth/callback`, '授权地址带 client_id 和回调地址');
  check(/HttpOnly/.test(start.headers.get('Set-Cookie')) && /SameSite=Lax/.test(start.headers.get('Set-Cookie')), '登录状态 Cookie 是 HttpOnly、SameSite=Lax');
  check(cb.status === 302 && cb.headers.get('Location') === '/edit/cat%20ears' && !!session, `回调后带着登录状态回到原页面：${cb.headers.get('Location')}`);
  const me = await call('GET', '/api/me', { cookie: session });
  check(eq(me.data.user, { id: 1001, login: 'Alice', avatar: 'https://avatars.githubusercontent.com/u/1001?v=4', reviewer: true }), `登录后 /api/me：${JSON.stringify(me.data)}`);
  check((await call('GET', '/', { cookie: session })).data.includes('"login":"Alice"'), '登录后页面配置里有用户');
  check((await call('GET', '/review', { cookie: session })).data.includes('"reviewer":true'), '审核页的页面配置里标明审核员');
  const [payload, sig] = session.slice('nzh_session='.length).split('.');
  const forged = Buffer.from(JSON.stringify({ id: 1, login: 'admin', exp: Date.now() + 1e9 })).toString('base64url');
  check((await call('GET', '/api/me', { cookie: `nzh_session=${forged}.${sig}` })).data.user === null, '伪造的登录状态无效');
  // 换掉签名的第一个字符；原本就是 x 时换成 y，否则签名没变
  check((await call('GET', '/api/me', { cookie: `nzh_session=${payload}.${sig[0] === 'x' ? 'y' : 'x'}${sig.slice(1)}` })).data.user === null, '签名不对的登录状态无效');
  const out = await call('POST', '/auth/logout', { cookie: session });
  check(out.status === 204 && /nzh_session=;/.test(out.headers.get('Set-Cookie')) && /Max-Age=0/.test(out.headers.get('Set-Cookie')), '退出时清掉登录状态');
}
for (const [ret, expect] of [
  ['//evil.example/x', '/'],
  ['/\\evil.example', '/'],
  ['https://evil.example', '/'],
  ['/list/character?search=cat', '/list/character?search=cat'],
]) {
  const { cb } = await login('goodcode', ret);
  check(cb.headers.get('Location') === expect, `登录后只跳回站内：${ret} → ${cb.headers.get('Location')}`);
}
{
  const start = await call('GET', '/auth/login');
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const noCookie = await call('GET', `/auth/callback?code=goodcode&state=${state}`);
  check(noCookie.status === 302 && /login_error=/.test(noCookie.headers.get('Location')) && !setCookies(noCookie).some((c) => c.startsWith('nzh_session=') && c.length > 12), '没有 state Cookie 的回调不登录');
  const wrong = await call('GET', `/auth/callback?code=goodcode&state=other`, { cookie: setCookies(start)[0] });
  check(/login_error=/.test(wrong.headers.get('Location')), 'state 对不上的回调不登录');
  const badCode = await login('nosuchcode');
  check(!badCode.session && /login_error=/.test(badCode.cb.headers.get('Location')), 'GitHub 授权失败时不登录');
  const young = await login('newbie');
  check(!young.session && decodeURIComponent(young.cb.headers.get('Location')).includes('注册满 30 天'), '注册不满 30 天的账号不能登录编辑');
  const blocked = await login('spam');
  check(!blocked.session && /login_error=/.test(blocked.cb.headers.get('Location')), '禁止编辑的账号不能登录');
}

// ---- 编辑 ----
const { session } = await login('goodcode');
const put = (tag, body, opts = {}) => call('PUT', `/api/tags/${encodeURIComponent(tag)}`, { body, cookie: session, origin: BASE, ...opts });

check((await put('cat ears', { label: '猫耳' }, { cookie: undefined })).status === 401, '没登录不能修改');
check((await put('cat ears', { label: '猫耳' }, { origin: 'https://evil.example' })).status === 403, '别的网站发来的修改被拒绝');
check((await put('cat ears', '{}', { type: 'text/plain' })).status === 415, '非 JSON 的修改被拒绝');
check((await put('cat ears', { label: '<img src=x>猫' })).status === 400, '含 < > 的名称被拒绝');
check((await put('猫耳', { label: '猫耳' })).status === 400, '标签不是英文时被拒绝');
check(gh.puts.length === 0, '被拒绝的修改不会提交');

{
  const r = await put('Cat_Ears', { label: '猫耳', aliases: '喵耳/兽耳', note: '更常用', base: null });
  check(r.status === 200 && r.data.action === 'add' && r.data.commit.sha === 'c1', `新增：${JSON.stringify(r.data)}`);
  const p = gh.puts[0];
  check(p.message === '新增 cat ears\n\n名称：猫耳\n检索词：喵耳/兽耳\n说明：更常用', `提交说明：${JSON.stringify(p.message)}`);
  check(eq(p.author, { name: 'Alice', email: '1001+Alice@users.noreply.github.com' }) && p.branch === 'main' && !('sha' in p), '以登录用户为作者提交，文件不存在时新建');
  check(gh.file === [...COMMUNITY_HEADER, 'cat ears\t猫耳\t喵耳/兽耳'].join('\n') + '\n', `文件内容：${JSON.stringify(gh.file)}`);
  check(gh.installationLookups === 1, '没配置安装 id 时自动查找');
}
{
  const r = await call('GET', '/api/community');
  check(r.status === 200 && r.data.sha === gh.sha && eq(r.data.entries, [{ tag: 'cat ears', label: '猫耳', aliases: ['喵耳', '兽耳'], count: 0 }]), `/api/community：${JSON.stringify(r.data)}`);
}
check((await put('cat ears', { label: '猫耳', aliases: '喵耳/兽耳', base: { label: '猫耳', aliases: ['喵耳', '兽耳'] } })).data.action === 'none', '内容没变时不提交');
check(gh.puts.length === 1, '内容没变时没有新提交');
{
  const stale = await put('cat ears', { label: '猫耳朵', base: null });
  check(stale.status === 409 && stale.data.entry?.label === '猫耳', '别人改过以后，按旧内容提交的修改被拒绝');
  const r = await put('cat ears', { label: '猫耳朵', aliases: '喵耳', base: { label: '猫耳', aliases: ['喵耳', '兽耳'] } });
  check(r.data.action === 'update' && gh.puts[1].message.startsWith('修改 cat ears\n') && gh.puts[1].sha, `修改：${JSON.stringify(r.data)}`);
}
// 读和写之间别人提交了：重读以后再提交，两边的修改都在
{
  gh.conflictOnce = () => {
    gh.file += 'smile\t微笑\n';
    gh.sha = 'other';
  };
  const r = await put('blush', { label: '脸红' });
  check(r.status === 200 && r.data.action === 'add', `冲突后重试：${JSON.stringify(r.data)}`);
  check(gh.file.includes('blush\t脸红') && gh.file.includes('smile\t微笑'), '重试后两边的修改都在');
}
// 平台拉来的 Danbooru 新标签带图片数
{
  const danbooru = [{ name: 'mary_sue_(black_souls)', category: 4, post_count: 160, created_at: '2026-10-20T13:09:01Z' }];
  check((await call('POST', '/api/admin/tags', { body: { tags: danbooru } })).status === 401, '没有口令不能存标签');
  check((await call('POST', '/api/admin/tags', { body: { tags: danbooru }, headers: { Authorization: 'Bearer admin-token' } })).data.stored === 1, '存 Danbooru 新标签');
  await put('mary_sue_(black_souls)', { label: '玛丽苏（黑魂）' });
  check(gh.file.includes('mary sue (black souls)\t玛丽苏（黑魂）\t\t160'), 'Danbooru 新标签记下图片数');
}
{
  const r = await put('smile', { label: '', aliases: [], base: { label: '微笑', aliases: [] } });
  check(r.data.action === 'delete' && !gh.file.includes('smile') && gh.puts.at(-1).message === '删除 smile', '名称和检索词都清空就删除');
}
{
  const h = await call('GET', '/api/history?tag=cat_ears');
  check(
    eq(
      h.data.items.map((i) => [i.login, i.action, i.label, i.aliases, i.sha]),
      [
        ['Alice', 'update', '猫耳朵', '喵耳', 'c2'],
        ['Alice', 'add', '猫耳', '喵耳/兽耳', 'c1'],
      ],
    ),
    `编辑日志：${JSON.stringify(h.data)}`,
  );
  check((await call('GET', '/api/history?tag=')).status === 400, '编辑日志要指定标签');
}
// ---- 审核 ----
gh.users.bobcode = { id: 1004, login: 'Bob', avatar_url: 'https://avatars.githubusercontent.com/u/1004?v=4', created_at: '2021-01-01T00:00:00Z' };
gh.users.carolcode = { id: 1005, login: 'Carol', avatar_url: '', created_at: '2021-01-01T00:00:00Z' };
const bob = (await login('bobcode')).session;
const carol = (await login('carolcode')).session;
const bobPut = (tag, body) => put(tag, body, { cookie: bob });
const post = (p, body, cookie = session, opts = {}) => call('POST', p, { body, cookie, origin: BASE, ...opts });
const submissions = async (q = '') => (await call('GET', `/api/submissions${q}`)).data.items;
{
  check((await call('GET', '/api/me', { cookie: bob })).data.user.reviewer === false, '不在 REVIEWERS 里的不是审核员');
  env.REVIEWERS = 'bob';
  check((await call('GET', '/api/me', { cookie: bob })).data.user.reviewer === true, 'REVIEWERS 也可以填用户名，不分大小写');
  env.REVIEWERS = '1001';

  const puts = gh.puts.length;
  const file = gh.file;
  const r = await bobPut('cat ears', { label: '猫耳', aliases: '喵耳', note: '改回来', base: { label: '猫耳朵', aliases: ['喵耳'] } });
  check(r.status === 202 && r.data.action === 'pending' && r.data.submission.status === 'pending' && r.data.submission.action === 'update', `不是审核员的修改存为待审核：${JSON.stringify(r.data)}`);
  check(gh.puts.length === puts && gh.file === file, '待审核的修改不提交到 GitHub');
  check(eq(r.data.submission.base, { label: '猫耳朵', aliases: ['喵耳'] }) && r.data.submission.note === '改回来', '记下提交时的社区修订和修改说明');
  check((await bobPut('cat ears', { label: '猫', base: null })).status === 409, '按旧内容提交的修改直接被拒绝');
  const list = await submissions();
  check(list.length === 1 && list[0].tag === 'cat ears' && list[0].login === 'Bob' && eq(list[0].aliases, ['喵耳']), `待审核列表：${JSON.stringify(list)}`);
  check((await submissions('?tag=Cat_Ears')).length === 1 && (await submissions('?status=all&user=bob')).length === 1, '按标签、提交者筛选');
  check((await call('GET', '/api/submissions?status=nope')).status === 400, '状态不对时返回 400');
  check((await call('GET', '/api/history?tag=cat_ears')).data.items.length === 2, '待审核的修改不进编辑日志');

  // 同一个人再改同一个标签：只留最新的一份
  const again = await bobPut('cat ears', { label: '猫咪耳朵', aliases: '喵耳', base: { label: '猫耳朵', aliases: ['喵耳'] } });
  const pending = await submissions();
  check(again.status === 202 && pending.length === 1 && pending[0].label === '猫咪耳朵', '同一个人对同一个标签只留最新的一份待审核修改');
  check((await submissions('?status=withdrawn'))[0]?.id === r.data.submission.id, '旧的那份标为已撤回');

  const id = again.data.submission.id;
  check((await post(`/api/submissions/${id}/approve`, {}, bob)).status === 403, '不是审核员不能审核');
  check((await post(`/api/submissions/${id}/approve`, {}, null)).status === 401, '没登录不能审核');
  check((await post(`/api/submissions/${id}/approve`, {}, session, { origin: 'https://evil.example' })).status === 403, '别的网站发来的审核被拒绝');
  check((await post(`/api/submissions/${id}/approve`, '{}', session, { type: 'text/plain' })).status === 415, '非 JSON 的审核被拒绝');
  check((await post('/api/submissions/9999/approve', {})).status === 404, '找不到的修改返回 404');
  check(gh.puts.length === puts, '被拒绝的审核不会提交');

  // 通过：以提交的人为作者提交，注明审核员
  const ok = await post(`/api/submissions/${id}/approve`, {});
  const last = gh.puts.at(-1);
  check(ok.status === 200 && ok.data.action === 'update' && ok.data.item.status === 'approved' && ok.data.item.reviewer === 'Alice' && ok.data.item.sha === ok.data.commit.sha, `通过：${JSON.stringify(ok.data)}`);
  check(eq(last.author, { name: 'Bob', email: '1004+Bob@users.noreply.github.com' }), '通过后以提交的人为作者提交');
  check(last.message === '修改 cat ears\n\n名称：猫咪耳朵\n检索词：喵耳\n\nReviewed-by: Alice <1001+Alice@users.noreply.github.com>', `提交说明注明审核员：${JSON.stringify(last.message)}`);
  check(gh.file.includes('cat ears\t猫咪耳朵\t喵耳') && !(await submissions()).length, '通过后文件里是新内容，待审核列表清空');
  const h = (await call('GET', '/api/history?tag=cat_ears')).data.items[0];
  check(h.login === 'Bob' && h.label === '猫咪耳朵' && h.sha === ok.data.commit.sha, '编辑日志记下提交的人');
  check((await post(`/api/submissions/${id}/approve`, {})).status === 409 && (await post(`/api/submissions/${id}/reject`, {})).status === 409, '处理过的修改不能再审核');
}
// 两个人改同一个标签：通过一份以后，另一份是按旧内容改的，不能通过，只能驳回
{
  const base = { label: '脸红', aliases: [] };
  const a = await bobPut('blush', { label: '脸红了', base });
  const b = await put('blush', { label: '害羞脸红', base }, { cookie: carol });
  check(a.status === 202 && b.status === 202 && (await submissions('?tag=blush')).length === 2, '不同的人可以同时提交同一个标签的修改');
  check((await post(`/api/submissions/${a.data.submission.id}/approve`, {})).status === 200, '通过第一份');
  const stale = await post(`/api/submissions/${b.data.submission.id}/approve`, {});
  check(stale.status === 409 && stale.data.entry?.label === '脸红了' && gh.file.includes('blush\t脸红了'), `按旧内容改的修改不能通过：${JSON.stringify(stale.data)}`);
  const rej = await post(`/api/submissions/${b.data.submission.id}/reject`, { reason: '已经有人改过了\n请重新修改' });
  check(rej.status === 200 && rej.data.item.status === 'rejected' && rej.data.item.reason === '已经有人改过了 请重新修改' && rej.data.item.reviewer === 'Alice', `驳回：${JSON.stringify(rej.data)}`);
  check((await submissions('?user=Carol&status=rejected')).length === 1, '提交的人能看到被驳回的修改和原因');
}
// 改回现在的内容就撤回；Danbooru 新标签通过后也带图片数
{
  check((await bobPut('mary sue (black souls)', { label: '玛丽苏' })).status === 202, '提交新标签的修改');
  const w = await bobPut('mary sue (black souls)', { label: '玛丽苏（黑魂）' });
  check(w.data.action === 'none' && w.data.withdrawn === true && !(await submissions('?tag=mary_sue_(black_souls)')).length, `改回现在的内容就撤回待审核的修改：${JSON.stringify(w.data)}`);
  await call('POST', '/api/admin/tags', { body: { tags: [{ name: 'new_hero_(game)', category: 4, post_count: 99, created_at: '2026-10-01T00:00:00Z' }] }, headers: { Authorization: 'Bearer admin-token' } });
  const n = await bobPut('new hero (game)', { label: '新英雄' });
  check(n.data.submission.action === 'add', '新增的修改');
  check((await post(`/api/submissions/${n.data.submission.id}/approve`, {})).data.action === 'add' && gh.file.includes('new hero (game)\t新英雄\t\t99'), '通过的 Danbooru 新标签记下图片数');
}

// 每小时最多提交 EDITS_PER_HOUR 次（审核员不限）
{
  let last;
  for (let i = 0; i < 8; i++) last = await bobPut(`tag ${i}`, { label: `标签${i}` });
  check(last.status === 429, `超过每小时的次数后被限制：${last.status}`);
}

// ---- Danbooru 新标签 ----
{
  const many = Array.from({ length: 3000 }, (_, i) => ({ name: `bulk_${i}`, category: 0, post_count: 60, created_at: '2026-02-01T00:00:00Z' }));
  queries = 0;
  const bulk = await call('POST', '/api/admin/tags', { body: { tags: many }, headers: { Authorization: 'Bearer admin-token' } });
  check(bulk.data.stored === 3000 && queries <= 5, `存 3000 个标签用了 ${queries} 条查询`);
  const tags = await call('GET', '/api/tags');
  check(tags.data.tags.length === 3002 && tags.data.tags[0].tag === 'mary sue (black souls)' && tags.headers.get('Access-Control-Allow-Origin') === '*', `/api/tags：${tags.data.tags.length}`);
  check((await call('POST', '/api/admin/tags', { body: { tags: 'x' }, headers: { Authorization: 'Bearer admin-token' } })).status === 400, 'tags 不是数组时返回 400');
}

// ---- 扩展端读同一份数据 ----
const core = fs.readFileSync(path.join(ROOT, 'src', 'core.js'), 'utf8');
const community = fs.readFileSync(path.join(ROOT, 'src', 'community.js'), 'utf8');
const ext = vm.createContext({});
vm.runInContext(`const NZH_COMMUNITY_DATA = '';\n${core}\n${community}\nthis.parseCommunityTsv = parseCommunityTsv;\nthis.sanitizeCommunity = sanitizeCommunity;`, ext);
{
  const got = plain(ext.sanitizeCommunity(ext.parseCommunityTsv(gh.file)));
  const want = [...parseCommunity(gh.file).entries.values()].map((e) => (e.count ? e : { tag: e.tag, label: e.label, aliases: e.aliases }));
  check(eq(got, want), `编辑器写出的数据原样通过扩展端检查：${JSON.stringify(got)}`);
  const bad = plain(
    ext.sanitizeCommunity(
      ext.parseCommunityTsv('# 说明\ncat ears\t<script>\t喵/http://x/abc\nx\t한국어\nsmile\tneko\na, nsfw\t甲\t\t100\nd\t丁\t\t100\n'),
    ),
  );
  check(
    eq(bad, [
      { tag: 'cat ears', label: '', aliases: ['喵'] },
      { tag: 'a, nsfw', label: '甲', aliases: [] },
      { tag: 'd', label: '丁', aliases: [], count: 100 },
    ]),
    `扩展端丢掉不合格的内容，不安全的标签名不带图片数：${JSON.stringify(bad)}`,
  );
}

console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
