// 社区标签译名平台（worker/）的测试：用 Node 自带的 SQLite 模拟 D1，直接调用 Worker 的 fetch。
// 也检查平台给出的数据能原样通过扩展端（src/community.js）的检查。
// node scripts/test-worker.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/src/index.js';
import { normalizeTag, cleanZh, parseAliases, validateSuggestion, aggregate, toCsv, isSafeNewTag, parseDanbooruTags, danbooruTagsUrl } from '../worker/src/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function check(ok, msg) {
  if (!ok) {
    failed++;
    console.log(`✗ ${msg}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
  ['한국어', null],
  ['豈', '豈'],
  ['豈', '豈'],
  ['猫'.repeat(61), null],
]) {
  check(cleanZh(input, 60) === expect, `cleanZh(${JSON.stringify(input)}) = ${JSON.stringify(cleanZh(input, 60))}`);
}
check(eq(parseAliases('猫娘/兽耳娘、猫娘，喵'), ['猫娘', '兽耳娘', '喵']), 'parseAliases 分隔和去重');
check(eq(parseAliases(['猫娘', ' ']), ['猫娘']), 'parseAliases 跳过空白');
check(parseAliases('猫/neko') === null, 'parseAliases 有一个不合格就整体不合格');
check(parseAliases('一/二/三/四/五/六/七/八/九') === null, 'parseAliases 最多 8 个');
check(eq(parseAliases(undefined), []), 'parseAliases 缺省为空');
check(!!validateSuggestion({ tag: 'cat ears' }).error, '译名和检索词都为空时报错');
check(!!validateSuggestion(null).error, '提交内容不是对象时报错');
check(!!validateSuggestion({ tag: 'cat ears', label: 'neko' }).error, '译名不含汉字时报错');
{
  const v = validateSuggestion({ tag: 'Cat_Ears', label: ' 猫耳 ', aliases: '喵耳', note: 'a\nb' });
  check(eq(v.value, { tag: 'cat ears', label: '猫耳', aliases: ['喵耳'], note: 'a b' }), `validateSuggestion 规范化：${JSON.stringify(v)}`);
}
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
  ['猫', false],
]) {
  check(isSafeNewTag(tag) === ok, `isSafeNewTag(${JSON.stringify(tag)}) 应为 ${ok}`);
}
{
  const parsed = parseDanbooruTags([
    { name: 'Mary_Sue_(Black_Souls)', category: 4, post_count: 160, created_at: '2026-10-20T13:09:01.611-04:00' },
    { name: 'some_artist', category: 1, post_count: 500, created_at: '2026-10-20T00:00:00Z' },
    { name: 'rare_tag', category: 0, post_count: 49, created_at: '2026-10-20T00:00:00Z' },
    { name: 'bad,tag', category: 0, post_count: 100, created_at: '2026-10-20T00:00:00Z' },
    null,
  ]);
  check(
    eq(parsed, [{ tag: 'mary sue (black souls)', category: 4, count: 160, created_at: Date.parse('2026-10-20T13:09:01.611-04:00') }]),
    `parseDanbooruTags：${JSON.stringify(parsed)}`,
  );
  check(eq(parseDanbooruTags({ error: 'x' }), []), 'parseDanbooruTags 能处理错误响应');
  check(eq(aggregate([{ tag: 'x', label: '甲', aliases: '[]', count: 120 }]), [{ tag: 'x', label: '甲', aliases: [], count: 120 }]), 'aggregate 带上新标签的图片数');
}
{
  const rows = [
    { tag: 'cat ears', label: '猫耳', aliases: '["喵耳"]' },
    { tag: 'cat ears', label: '', aliases: '["猫娘","喵耳"]' },
    { tag: 'cat ears', label: '猫耳朵', aliases: '[]' },
    { tag: 'smile', label: '', aliases: '["笑"]' },
  ];
  const agg = aggregate(rows);
  check(
    eq(agg, [
      { tag: 'cat ears', label: '猫耳朵', aliases: ['猫娘', '喵耳'] },
      { tag: 'smile', label: '', aliases: ['笑'] },
    ]),
    `aggregate：${JSON.stringify(agg)}`,
  );
  check(toCsv(agg) === '# zh-override.csv\ncat ears,猫耳朵\n\n# zh-extra.csv\ncat ears,猫娘/喵耳\nsmile,笑\n', `toCsv：${JSON.stringify(toCsv(agg))}`);
}

// ---- Worker ----
// D1 的 prepare().bind().first()/all()/run() 用 node:sqlite 实现；queries 记下执行了几条查询，
// 免费版 D1 每次调用最多 50 条
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
const env = { DB: d1(db), ADMIN_TOKEN: 'test-admin-token', IP_SALT: 'salt' };
const ctx = { waitUntil() {} };
const BASE = 'https://novelai-cn.example.workers.dev';

async function call(method, p, { body, ip = '203.0.113.1', token, type = 'application/json' } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (body !== undefined) headers['Content-Type'] = type;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(BASE + p, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), env, ctx);
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, data };
}
const admin = (method, p, body) => call(method, p, { body, token: env.ADMIN_TOKEN });

{
  const res = await call('GET', '/');
  const csp = res.headers.get('Content-Security-Policy') || '';
  const nonce = (csp.match(/'nonce-([^']+)'/) || [])[1];
  check(res.status === 200 && nonce && res.data.includes(`<script nonce="${nonce}">`), '提交页的脚本带上 CSP 的 nonce');
  check(!/script-src[^;]*'unsafe-inline'/.test(csp), '提交页不允许内联脚本');
  check(csp.includes('connect-src \'self\' https://raw.githubusercontent.com'), `提交页可以读词典：${csp}`);
  check(!res.data.includes('cf-turnstile'), '没配 Turnstile 时不显示人机验证');
  const page = await call('GET', '/admin');
  check(page.status === 200 && page.data.includes('ADMIN_TOKEN') && !page.data.includes(env.ADMIN_TOKEN), '审核页不含口令');
  // 页面里的脚本要能解析
  for (const [name, html] of [['提交页', res.data], ['审核页', page.data]]) {
    const scripts = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    check(scripts.length === 1, `${name}应有一段脚本，实际 ${scripts.length}`);
    for (const s of scripts) {
      try {
        new vm.Script(`(async () => {${s}\n})`);
      } catch (e) {
        check(false, `${name}脚本语法错误：${e.message}`);
      }
    }
  }
}

check((await call('POST', '/api/suggestions', { body: '{}', type: 'text/plain' })).status === 415, '非 JSON 提交返回 415');
check((await call('POST', '/api/suggestions', { body: 'not json' })).status === 400, '坏 JSON 返回 400');
check((await call('POST', '/api/suggestions', { body: { tag: 'cat ears', label: '<img src=x>猫' } })).status === 400, '含 < > 的译名被拒绝');

const first = await call('POST', '/api/suggestions', { body: { tag: 'Cat_Ears', label: '猫耳', aliases: '喵耳/猫娘', note: '更常用' } });
check(first.status === 201 && first.data.id === 1, `提交成功：${JSON.stringify(first)}`);
check(db.prepare('SELECT ip_hash FROM suggestions WHERE id = 1').get().ip_hash.length === 64, '只存 IP 的哈希');
check(!JSON.stringify(db.prepare('SELECT * FROM suggestions').all()).includes('203.0.113.1'), '数据库里没有明文 IP');

for (let i = 0; i < 19; i++) await call('POST', '/api/suggestions', { body: { tag: 'smile', aliases: [`笑${i}`] } });
check((await call('POST', '/api/suggestions', { body: { tag: 'smile', label: '笑' } })).status === 429, '同一 IP 每小时第 21 条被限流');
check((await call('POST', '/api/suggestions', { body: { tag: 'smile', label: '微笑' }, ip: '203.0.113.2' })).status === 201, '其他 IP 不受影响');

check(eq((await call('GET', '/api/overrides')).data.entries, []), '未审核的提交不对外');

check((await call('GET', '/api/admin/suggestions')).status === 401, '没有口令不能看提交');
check((await call('GET', '/api/admin/suggestions', { token: 'wrong' })).status === 401, '口令错误不能看提交');
check((await worker.fetch(new Request(`${BASE}/api/admin/suggestions`, { headers: { Authorization: 'Bearer x' } }), { ...env, ADMIN_TOKEN: '' }, ctx)).status === 401, '没设置 ADMIN_TOKEN 时谁都进不去');
{
  const list = await admin('GET', '/api/admin/suggestions');
  check(list.status === 200 && list.data.items.length === 21 && list.data.items[0].tag === 'cat ears', `待审核列表：${list.data.items?.length}`);
  check(eq(list.data.items[0].aliases, ['喵耳', '猫娘']) && list.data.items[0].note === '更常用', '列表带检索词和说明');
  check(!('ip_hash' in list.data.items[0]), '列表不含 IP 哈希');
  check((await admin('GET', '/api/admin/suggestions?status=bogus')).status === 400, '错误的状态返回 400');
}

check((await admin('POST', '/api/admin/suggestions/1', { action: 'approve', label: 'neko' })).status === 400, '审核时改的译名也要检查');
check((await admin('POST', '/api/admin/suggestions/1', { action: 'approve', label: '', aliases: '' })).status === 400, '审核时不能把内容改空');
check((await admin('POST', '/api/admin/suggestions/1', { action: 'approve', label: '猫耳朵', aliases: '喵耳' })).status === 200, '采纳时可以改内容');
check((await admin('POST', '/api/admin/suggestions/1', { action: 'approve' })).status === 409, '不能重复采纳');
check((await admin('POST', '/api/admin/suggestions/2', { action: 'approve' })).status === 200, '原样采纳');
check((await admin('POST', '/api/admin/suggestions/3', { action: 'reject' })).status === 200, '驳回');
check((await admin('POST', '/api/admin/suggestions/3', { action: 'revert' })).status === 409, '驳回的不能撤销');
check((await admin('POST', '/api/admin/suggestions/999', { action: 'approve' })).status === 404, '不存在的提交返回 404');
check((await admin('POST', '/api/admin/suggestions/2', { action: 'delete' })).status === 400, '未知操作返回 400');

let overrides;
{
  const res = await call('GET', '/api/overrides');
  overrides = res.data;
  check(res.headers.get('Access-Control-Allow-Origin') === '*', '/api/overrides 允许跨域');
  check(
    eq(overrides.entries, [
      { tag: 'cat ears', label: '猫耳朵', aliases: ['喵耳'] },
      { tag: 'smile', label: '', aliases: ['笑0'] },
    ]),
    `已采纳的修订：${JSON.stringify(overrides.entries)}`,
  );
  const csv = await call('GET', '/api/export.csv');
  check(csv.data === '# zh-override.csv\ncat ears,猫耳朵\n\n# zh-extra.csv\ncat ears,喵耳\nsmile,笑0\n', `导出：${JSON.stringify(csv.data)}`);
}
check((await admin('POST', '/api/admin/suggestions/2', { action: 'revert' })).status === 200, '撤销');
check(eq((await call('GET', '/api/overrides')).data.entries.map((e) => e.tag), ['cat ears']), '撤销后不再对外');
check((await admin('GET', '/api/admin/suggestions?status=reverted')).data.items[0]?.id === 2, '已撤销列表');
check((await call('GET', '/nope')).status === 404, '未知路径返回 404');

// 新标签：scripts/sync-tags.mjs 或审核页从 Danbooru 拉来后交给 /api/admin/tags
{
  const q = new URL(danbooruTagsUrl(2)).searchParams;
  check(
    danbooruTagsUrl(2).startsWith('https://danbooru.donmai.us/tags.json?') &&
      q.get('search[order]') === 'date' &&
      q.get('search[category]') === '0,3,4,5' &&
      q.get('search[post_count]') === '>=50' &&
      q.get('limit') === '1000' &&
      q.get('page') === '2',
    `Danbooru 请求参数：${danbooruTagsUrl(2)}`,
  );
  const danbooru = [
    { name: 'mary_sue_(black_souls)', category: 4, post_count: 160, created_at: '2026-10-20T13:09:01Z' },
    { name: 'masa_works_design_(copyright)', category: 3, post_count: 101, created_at: '2026-10-20T01:00:32Z' },
    { name: 'some_artist', category: 1, post_count: 900, created_at: '2026-10-19T00:00:00Z' },
    ...Array.from({ length: 997 }, (_, i) => ({ name: `filler_${i}`, category: 0, post_count: 50 + i, created_at: '2026-01-01T00:00:00Z' })),
    { name: 'cat_ears', category: 0, post_count: 404250, created_at: '2008-01-01T00:00:00Z' },
  ];
  check((await call('POST', '/api/admin/tags', { body: { tags: danbooru } })).status === 401, '没有口令不能存标签');
  const r = await admin('POST', '/api/admin/tags', { tags: danbooru });
  check(r.status === 200 && r.data.received === 1001 && r.data.stored === 1000, `存标签：${JSON.stringify(r.data)}`);
  // 再存一次：已有的更新图片数，不重复
  danbooru[1000].post_count = 404300;
  await admin('POST', '/api/admin/tags', { tags: danbooru });
  check(db.prepare('SELECT COUNT(*) AS n FROM tags').get().n === 1000, '再存一次不会重复');
  check(db.prepare("SELECT count FROM tags WHERE tag = 'cat ears'").get().count === 404300, '再存一次会更新图片数');
  // 每天同步最多 3000 个，一次请求要留在 D1 的查询上限内
  const many = Array.from({ length: 3000 }, (_, i) => ({ name: `bulk_${i}`, category: 0, post_count: 60, created_at: '2026-02-01T00:00:00Z' }));
  queries = 0;
  const bulk = await admin('POST', '/api/admin/tags', { tags: many });
  check(bulk.data.stored === 3000 && queries <= 5, `存 3000 个标签用了 ${queries} 条查询`);
  check(db.prepare("SELECT category, count, created_at FROM tags WHERE tag = 'bulk 2999'").get()?.count === 60, '批量写入的字段正确');
  db.prepare("DELETE FROM tags WHERE tag LIKE 'bulk %'").run();
  check((await admin('POST', '/api/admin/tags', { tags: 'x' })).status === 400, 'tags 不是数组时返回 400');
  check((await admin('POST', '/api/admin/tags', { tags: new Array(5001).fill(null) })).status === 400, '一次最多 5000 个');

  const tags = await call('GET', '/api/tags');
  check(tags.status === 200 && tags.data.tags.length === 1000 && tags.data.tags[0].tag === 'cat ears', `/api/tags：${tags.data.tags?.length}`);
  check(tags.headers.get('Access-Control-Allow-Origin') === '*', '/api/tags 允许跨域');
  check(eq(Object.keys(tags.data.tags[1]), ['tag', 'category', 'count', 'created_at']), '/api/tags 的字段');
  check(!tags.data.tags.some((t) => t.tag === 'some artist'), '不收画师');

  // 新标签的译名采纳后，/api/overrides 带上图片数，扩展据此新增
  const s = await call('POST', '/api/suggestions', { body: { tag: 'mary_sue_(black_souls)', label: '玛丽苏（黑魂）' }, ip: '203.0.113.9' });
  const pending = await call('GET', '/api/pending');
  check(pending.data.tags.some((t) => t.tag === 'mary sue (black souls)' && t.n === 1), `/api/pending：${JSON.stringify(pending.data)}`);
  await admin('POST', `/api/admin/suggestions/${s.data.id}`, { action: 'approve' });
  overrides = (await call('GET', '/api/overrides')).data;
  const mary = overrides.entries.find((e) => e.tag === 'mary sue (black souls)');
  check(eq(mary, { tag: 'mary sue (black souls)', label: '玛丽苏（黑魂）', aliases: [], count: 160 }), `新标签的修订带图片数：${JSON.stringify(mary)}`);
  check(!(await call('GET', '/api/pending')).data.tags.some((t) => t.tag === 'mary sue (black souls)'), '采纳后不再算待审核');
}

// Turnstile：配置了密钥就必须通过验证
{
  const realFetch = globalThis.fetch;
  let sent = null;
  let verdict = false;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), secret: init.body.get('secret'), response: init.body.get('response'), ip: init.body.get('remoteip') };
    return new Response(JSON.stringify({ success: verdict }));
  };
  const tenv = { ...env, TURNSTILE_SECRET: 'ts-secret', TURNSTILE_SITE_KEY: '0x4AAA"<b>' };
  const post = (token) =>
    worker.fetch(
      new Request(`${BASE}/api/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
        body: JSON.stringify({ tag: 'blush', label: '脸红', turnstile: token }),
      }),
      tenv,
      ctx,
    );
  check((await post('')).status === 400 && sent === null, '缺少人机验证时不去验证、直接拒绝');
  check((await post('tok')).status === 400 && sent?.secret === 'ts-secret' && sent.response === 'tok' && sent.ip === '198.51.100.7', '人机验证失败时拒绝');
  verdict = true;
  check((await post('tok')).status === 201, '人机验证通过后接受');
  globalThis.fetch = realFetch;
  const html = await (await worker.fetch(new Request(`${BASE}/`), tenv, ctx)).text();
  check(html.includes('data-sitekey="0x4AAA&#34;&#60;b&#62;"'), '站点密钥写进页面时转义');
}

// ---- 扩展端 ----
const core = fs.readFileSync(path.join(ROOT, 'src', 'core.js'), 'utf8');
const community = fs.readFileSync(path.join(ROOT, 'src', 'community.js'), 'utf8');
const ext = vm.createContext({});
vm.runInContext(`const NZH_COMMUNITY_URL = '';\n${core}\n${community}\nthis.sanitizeCommunity = sanitizeCommunity;`, ext);
const roundTrip = JSON.parse(JSON.stringify(ext.sanitizeCommunity(overrides)));
check(eq(roundTrip, overrides.entries), `平台的数据原样通过扩展端检查：${JSON.stringify(roundTrip)}`);
{
  const bad = ext.sanitizeCommunity({
    entries: [
      { tag: 'cat ears', label: '<script>', aliases: ['喵', 'http://x', 'abc', 5] },
      { tag: '猫耳', label: '猫耳' },
      { tag: 'smile', label: 'neko', aliases: [] },
      null,
      { tag: 'blush', label: '脸红'.repeat(31) },
    ],
  });
  check(eq(JSON.parse(JSON.stringify(bad)), [{ tag: 'cat ears', label: '', aliases: ['喵'] }]), `扩展端丢掉不合格的内容：${JSON.stringify(bad)}`);
  check(eq(JSON.parse(JSON.stringify(ext.sanitizeCommunity({ entries: 'x' }))), []) && ext.sanitizeCommunity(null).length === 0, '扩展端能处理格式不对的数据');
  const counted = JSON.parse(
    JSON.stringify(
      ext.sanitizeCommunity({
        entries: [
          { tag: 'a, nsfw', label: '甲', count: 100 },
          { tag: 'b', label: '乙', count: 1.5 },
          { tag: 'c', label: '丙', count: '100' },
          { tag: 'd', label: '丁', count: 100 },
        ],
      }),
    ),
  );
  check(
    eq(counted, [
      { tag: 'a, nsfw', label: '甲', aliases: [] },
      { tag: 'b', label: '乙', aliases: [] },
      { tag: 'c', label: '丙', aliases: [] },
      { tag: 'd', label: '丁', aliases: [], count: 100 },
    ]),
    `扩展端只给安全的标签名保留图片数：${JSON.stringify(counted)}`,
  );
}

console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
