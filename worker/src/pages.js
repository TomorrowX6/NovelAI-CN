// 提交页和审核页。页面脚本只用 textContent 渲染提交的内容，再配上带 nonce 的 CSP。
// 页面脚本是普通字符串（不用反引号和 ${}），wrangler 打包时不会改动。
import { danbooruTagsUrl, DANBOORU_PAGES } from './rules.js';

const DEFAULT_DICT_URL = 'https://raw.githubusercontent.com/TomorrowX6/NovelAI-CN/main/dist/zh-tags.tsv';

const dictUrl = (env) => env.DICT_URL || DEFAULT_DICT_URL;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// 给页面脚本的配置放在 JSON 里，转义 < 免得提前结束 <script>
const config = (data) => `<script type="application/json" id="cfg">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

export function pageCsp(env, nonce) {
  const dictOrigin = new URL(dictUrl(env)).origin;
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`,
    "style-src 'unsafe-inline'",
    // 审核页的「拉取新标签」在浏览器里请求 Danbooru
    `connect-src 'self' ${dictOrigin} https://danbooru.donmai.us`,
    'frame-src https://challenges.cloudflare.com',
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const STYLE = `
:root {
  --bg: #f6f7fb; --card: #fff; --text: #1d2433; --muted: #667085; --line: #e3e6ee;
  --accent: #2f4fb5; --accent-text: #fff; --soft: #eef2ff; --ok: #157347; --err: #c0392b; --warn: #9a6700;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #12151c; --card: #1b2029; --text: #e6e9f0; --muted: #98a2b3; --line: #2c3340;
    --accent: #7b96f0; --accent-text: #0d1220; --soft: #222a3d; --ok: #4cc38a; --err: #ff7b6b; --warn: #e3b341;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 0 0 12px; }
p { margin: 0 0 12px; }
a { color: var(--accent); }
.muted { color: var(--muted); font-size: 13px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-top: 16px; }
input, textarea { width: 100%; font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
textarea { min-height: 64px; resize: vertical; }
label { display: block; font-weight: 600; margin: 12px 0 4px; }
label .muted { font-weight: 400; }
button { font: inherit; border: 1px solid var(--line); border-radius: 6px; padding: 6px 14px; background: var(--card); color: var(--text); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 600; }
button:disabled { opacity: .5; cursor: default; }
code, .tag { font-family: ui-monospace, Consolas, monospace; }
.results { list-style: none; margin: 12px 0 0; padding: 0; }
.results li { border-top: 1px solid var(--line); }
.results button { width: 100%; text-align: left; border: 0; border-radius: 0; padding: 8px 4px; display: flex; gap: 12px; align-items: baseline; background: none; }
.results button:hover { background: var(--soft); }
.results .tag { flex: 0 0 40%; overflow-wrap: anywhere; }
.results .zh { flex: 1; }
.results .count { color: var(--muted); font-size: 12px; }
.badge { display: inline-block; font-size: 12px; padding: 0 6px; border-radius: 4px; background: var(--soft); color: var(--accent); margin-left: 6px; font-weight: 400; }
.badge.warn { color: var(--warn); }
.status { margin-top: 12px; min-height: 1.6em; }
.status.ok { color: var(--ok); }
.status.err { color: var(--err); }
.status.warn { color: var(--warn); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.tabs button[aria-pressed="true"] { background: var(--soft); border-color: var(--accent); color: var(--accent); }
.item { border-top: 1px solid var(--line); padding: 12px 0; }
.item:first-child { border-top: 0; }
.hidden { display: none !important; }
`;

function layout(title, nonce, body, head = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>${STYLE}</style>
${head}
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

// 两个页面共用：载入词典、已采纳的社区修订、自动拉来的新标签和待审核的标签。
// 词典里没有的新标签也放进 rows（isNew），搜索时一起出现
const DICT_SCRIPT = `
const SEP = '\\u0001';
const HAN = /[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]/;
const CATEGORY_NAMES = { 0: '通用', 3: '作品', 4: '角色', 5: '元标签' };
const normTag = (s) => {
  let t = s.trim().toLowerCase().replace(/\\s+/g, ' ');
  if (/[a-z]{2}/.test(t)) t = t.replace(/_/g, ' ').replace(/\\s+/g, ' ').trim();
  return t;
};
const getJson = (u, fallback) => fetch(u).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);
const dict = { rows: [], byTag: new Map(), community: new Map(), pending: new Map(), size: 0, newCount: 0, ready: null };
function dictRow(tag) {
  return dict.byTag.get(tag) || dict.byTag.get(tag.replace(/_/g, ' ')) || null;
}
function buildKey(r) {
  const c = dict.community.get(r.tag);
  const names = r.label.split('/').concat(r.extra, c ? [c.label].concat(c.aliases) : []);
  r.key = SEP + names.filter(Boolean).map((s) => s.trim().toLowerCase()).join(SEP) + SEP;
}
function loadDict() {
  if (dict.ready) return dict.ready;
  const tsv = fetch(cfg.dictUrl).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
  dict.ready = Promise.all([tsv, getJson('/api/overrides', {}), getJson('/api/tags', {}), getJson('/api/pending', {})]).then(([text, ov, nt, pd]) => {
    for (const e of ov.entries || []) dict.community.set(e.tag, e);
    for (const p of pd.tags || []) dict.pending.set(p.tag, p.n);
    for (const line of text.split('\\n')) {
      if (!line) continue;
      const [tag, count, label, extra, old] = line.split('\\t');
      const r = { tag, count: +count || 0, label: label || '', extra: extra ? extra.split('|') : [] };
      buildKey(r);
      dict.rows.push(r);
      dict.byTag.set(tag, r);
      if (old) for (const o of old.split('|')) if (!dict.byTag.has(o)) dict.byTag.set(o, r);
    }
    dict.size = dict.rows.length;
    for (const t of nt.tags || []) {
      if (dict.byTag.has(t.tag)) continue;
      const r = { tag: t.tag, count: t.count, label: '', extra: [], isNew: true, category: t.category, created: t.created_at };
      buildKey(r);
      dict.rows.push(r);
      dict.byTag.set(t.tag, r);
      dict.newCount++;
    }
  });
  dict.ready.catch(() => (dict.ready = null));
  return dict.ready;
}
// 当前显示的中文：社区修订优先
function currentLabel(r) {
  const c = dict.community.get(r.tag);
  return c && c.label ? c.label : r.label;
}
function rowNote(r) {
  if (r.isNew) return 'Danbooru 新标签（' + (CATEGORY_NAMES[r.category] || '') + '，' + r.count.toLocaleString() + ' 张图），词典里还没有；采纳后扩展会直接收录';
  return '';
}
function el(tag, props, children) {
  const n = document.createElement(tag);
  if (props) for (const k in props) {
    if (k === 'text') n.textContent = props[k];
    else if (k === 'class') n.className = props[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), props[k]);
    else n.setAttribute(k, props[k]);
  }
  for (const c of children || []) if (c) n.append(c);
  return n;
}
function setStatus(node, text, kind) {
  node.textContent = text;
  node.className = 'status' + (kind ? ' ' + kind : '');
}
`;

const SUBMIT_SCRIPT = `
const $ = (id) => document.getElementById(id);
let selected = null;
let filter = 'new';
let shown = 100;

function search(q) {
  const zh = HAN.test(q);
  q = zh ? q.trim().toLowerCase() : normTag(q);
  if (!q) return [];
  const hits = [];
  for (const r of dict.rows) {
    let rank;
    if (zh) {
      if (r.key.indexOf(q) < 0) continue;
      rank = r.key.includes(SEP + q + SEP) ? 0 : r.key.includes(SEP + q) ? 1 : 2;
    } else {
      if (r.tag.indexOf(q) < 0) continue;
      rank = r.tag === q ? 0 : r.tag.startsWith(q) ? 1 : 2;
    }
    hits.push([rank, r]);
  }
  hits.sort((a, b) => a[0] - b[0] || b[1].count - a[1].count);
  return hits.slice(0, 30).map((h) => h[1]);
}

function resultItem(r) {
  const label = currentLabel(r);
  const zh = el('span', { class: 'zh' }, [label ? label : el('span', { class: 'muted', text: '（还没有中文）' })]);
  if (r.isNew) zh.append(el('span', { class: 'badge', text: '新标签' }));
  if (dict.community.has(r.tag)) zh.append(el('span', { class: 'badge', text: '社区修订' }));
  const n = dict.pending.get(r.tag);
  if (n) zh.append(el('span', { class: 'badge warn', text: n + ' 条待审核' }));
  return el('li', null, [el('button', { type: 'button', onclick: () => select(r.tag) }, [
    el('span', { class: 'tag', text: r.tag }),
    zh,
    el('span', { class: 'count', text: r.count.toLocaleString() }),
  ])]);
}

function renderResults() {
  const q = $('q').value;
  const list = $('results');
  list.textContent = '';
  if (!q.trim() || !dict.rows.length) return;
  for (const r of search(q)) list.append(resultItem(r));
  const tag = normTag(q);
  if (!HAN.test(q) && /^[\\x20-\\x7e]+$/.test(tag) && !dictRow(tag)) {
    list.append(el('li', null, [el('button', { type: 'button', onclick: () => select(tag) }, [
      el('span', { class: 'tag', text: tag }),
      el('span', { class: 'zh', text: '词典里没有这个标签，为它提交译名' }),
    ])]));
  }
  if (!list.children.length) list.append(el('li', { class: 'muted', text: '没有找到。输入英文标签可以为词典里没有的标签提交译名。' }));
}

// 未翻译：自动拉来、词典里还没有的新标签（可按类别筛选），或词典里只有英文名的标签；已有社区译名的不算
function untranslated() {
  const out = [];
  for (const r of dict.rows) {
    const c = dict.community.get(r.tag);
    if (c && c.label) continue;
    if (filter === 'english') {
      if (r.isNew || HAN.test(r.label)) continue;
    } else if (!r.isNew || (filter !== 'new' && String(r.category) !== filter)) {
      continue;
    }
    out.push(r);
  }
  return out.sort((a, b) => b.count - a.count);
}

function renderUntranslated() {
  for (const b of document.querySelectorAll('#filters button')) b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
  const list = $('todo');
  list.textContent = '';
  if (!dict.rows.length) return;
  const all = untranslated();
  for (const r of all.slice(0, shown)) list.append(resultItem(r));
  setStatus($('todo-status'), all.length ? '共 ' + all.length.toLocaleString() + ' 个，按图片数排序' : filter === 'english' ? '都有中文了' : '没有待翻译的新标签');
  $('more').classList.toggle('hidden', all.length <= shown);
}

function setView(v) {
  const todo = v === 'todo';
  $('tab-search').setAttribute('aria-pressed', String(!todo));
  $('tab-todo').setAttribute('aria-pressed', String(todo));
  $('search-view').classList.toggle('hidden', todo);
  $('todo-view').classList.toggle('hidden', !todo);
  if (todo) renderUntranslated();
  history.replaceState(null, '', location.pathname + location.search + (todo ? '#todo' : ''));
}

function select(tag) {
  const r = dictRow(tag);
  const c = r && dict.community.get(r.tag);
  selected = r ? r.tag : tag;
  $('form-card').classList.remove('hidden');
  $('sel-tag').textContent = selected;
  $('sel-label').textContent = !r ? '（词典里没有）' : r.isNew ? '（还没有）' : r.label || '（无）';
  $('sel-community').textContent = c ? [c.label, c.aliases.join(' / ')].filter(Boolean).join('；检索词：') || '（无）' : '（无）';
  $('sel-extra').textContent = r && r.extra.length ? r.extra.join(' / ') : '（无）';
  const note = $('new-tag-note');
  if (!r) setStatus(note, '词典里还没有这个标签，Danbooru 新标签里也没有。采纳后会在下个版本加入词典；在此之前扩展不会用上它。', 'warn');
  else if (r.isNew) setStatus(note, rowNote(r), 'ok');
  else setStatus(note, '');
  $('label').value = '';
  $('aliases').value = '';
  $('note').value = '';
  setStatus($('status'), '');
  history.replaceState(null, '', '?tag=' + encodeURIComponent(selected) + location.hash);
  $('form-card').scrollIntoView({ block: 'start' });
  $('label').focus({ preventScroll: true });
}

async function submit(e) {
  e.preventDefault();
  if (!selected) return;
  const body = { tag: selected, label: $('label').value, aliases: $('aliases').value, note: $('note').value };
  if (cfg.turnstileSiteKey) {
    body.turnstile = window.turnstile ? window.turnstile.getResponse() : '';
    if (!body.turnstile) return setStatus($('status'), '请先完成人机验证', 'warn');
  }
  $('submit').disabled = true;
  setStatus($('status'), '正在提交…');
  try {
    const res = await fetch('/api/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus($('status'), '已提交，谢谢！审核通过后，扩展会在几个小时内用上。', 'ok');
      $('label').value = '';
      $('aliases').value = '';
      $('note').value = '';
      dict.pending.set(selected, (dict.pending.get(selected) || 0) + 1);
      if (!$('todo-view').classList.contains('hidden')) renderUntranslated();
    } else {
      setStatus($('status'), data.error || '提交失败（' + res.status + '）', 'err');
    }
  } catch (err) {
    setStatus($('status'), '网络出错了，请重试', 'err');
  } finally {
    $('submit').disabled = false;
    if (window.turnstile) window.turnstile.reset();
  }
}

let timer = 0;
$('q').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(renderResults, 150);
});
$('form').addEventListener('submit', submit);
$('tab-search').addEventListener('click', () => setView('search'));
$('tab-todo').addEventListener('click', () => setView('todo'));
for (const b of document.querySelectorAll('#filters button')) {
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    shown = 100;
    renderUntranslated();
  });
}
$('more').addEventListener('click', () => {
  shown += 200;
  renderUntranslated();
});
if (location.hash === '#todo') setView('todo');
window.addEventListener('hashchange', () => setView(location.hash === '#todo' ? 'todo' : 'search'));
setStatus($('dict-status'), '正在载入词典…');
loadDict().then(
  () => {
    setStatus($('dict-status'), '词典共 ' + dict.size.toLocaleString() + ' 个标签，社区已修订 ' + dict.community.size.toLocaleString() + ' 个，另有 ' + dict.newCount.toLocaleString() + ' 个 Danbooru 新标签词典里还没有。');
    if (location.hash === '#todo') renderUntranslated();
    const tag = new URLSearchParams(location.search).get('tag');
    if (tag) {
      $('q').value = tag;
      renderResults();
      select(normTag(tag));
    } else {
      renderResults();
    }
  },
  () => setStatus($('dict-status'), '词典载入失败，请刷新重试', 'err'),
);
`;

export function submitPage(env, nonce) {
  const siteKey = env.TURNSTILE_SITE_KEY || '';
  const head = siteKey
    ? `<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : '';
  const body = `
<h1>NovelAI中文化助手 · 标签译名</h1>
<p class="muted">觉得哪个标签的中文译名不准，或者用某个说法搜不到想要的标签？在这里提交，审核通过后所有人的扩展都会用上。这里只能改标签的中文译名和检索词。</p>
<div id="dict-status" class="status"></div>

<div class="row tabs" style="margin-top:8px">
  <button type="button" id="tab-search" aria-pressed="true">搜索标签</button>
  <button type="button" id="tab-todo" aria-pressed="false">未翻译</button>
</div>

<section id="search-view" class="card">
  <label for="q" style="margin-top:0">搜索标签 <span class="muted">中文或英文都可以</span></label>
  <input id="q" type="search" autocomplete="off" placeholder="例如：猫耳、cat ears">
  <ul id="results" class="results"></ul>
</section>

<section id="todo-view" class="card hidden">
  <p class="muted">每天自动从 Danbooru 拉取新出现的标签（图片数 50 以上，不含画师），词典里还没有的列在这里，翻译采纳后扩展会直接收录。「只有英文名」是词典里没有中文译名的标签，多为作品名和商标，有通行中文名的再补。</p>
  <div id="filters" class="row tabs">
    <button type="button" data-filter="new">全部新标签</button>
    <button type="button" data-filter="4">角色</button>
    <button type="button" data-filter="3">作品</button>
    <button type="button" data-filter="0">通用</button>
    <button type="button" data-filter="5">元标签</button>
    <button type="button" data-filter="english">只有英文名</button>
  </div>
  <div id="todo-status" class="status"></div>
  <ul id="todo" class="results"></ul>
  <div class="row" style="margin-top:12px"><button id="more" type="button" class="hidden">显示更多</button></div>
</section>

<section id="form-card" class="card hidden">
  <h2>修改 <span id="sel-tag" class="tag"></span></h2>
  <dl>
    <dt>词典译名</dt><dd id="sel-label"></dd>
    <dt>社区修订</dt><dd id="sel-community"></dd>
    <dt>已有检索词</dt><dd id="sel-extra"></dd>
  </dl>
  <p id="new-tag-note" class="status"></p>
  <form id="form">
    <label for="label">新译名 <span class="muted">联想里显示的中文，留空表示不改</span></label>
    <input id="label" maxlength="60" autocomplete="off">
    <label for="aliases">检索词 <span class="muted">用这些词也能搜到这个标签，多个用 / 分隔，最多 8 个</span></label>
    <input id="aliases" autocomplete="off" placeholder="例如：兽耳娘/猫娘">
    <label for="note">说明 <span class="muted">选填，只给审核的人看</span></label>
    <textarea id="note" maxlength="300"></textarea>
    ${siteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" style="margin-top:12px"></div>` : ''}
    <div class="row" style="margin-top:12px"><button id="submit" class="primary" type="submit">提交</button></div>
    <div id="status" class="status"></div>
  </form>
</section>

<p class="muted" style="margin-top:24px">提交时只记录加盐哈希后的 IP，用来限制提交频率。已采纳的修订公开在 <a href="/api/overrides">/api/overrides</a>。</p>
${config({ dictUrl: dictUrl(env), turnstileSiteKey: siteKey })}
<script nonce="${nonce}">
const cfg = JSON.parse(document.getElementById('cfg').textContent);
${DICT_SCRIPT}
${SUBMIT_SCRIPT}
</script>`;
  return layout('标签译名 · NovelAI中文化助手', nonce, body, head);
}

const ADMIN_SCRIPT = `
const $ = (id) => document.getElementById(id);
const STATUS_NAMES = { pending: '待审核', approved: '已采纳', rejected: '已驳回', reverted: '已撤销' };
let token = '';
let status = 'pending';
try { token = sessionStorage.getItem('nzh-admin') || ''; } catch {}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout();
    throw new Error('口令不对');
  }
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

function logout() {
  token = '';
  try { sessionStorage.removeItem('nzh-admin'); } catch {}
  $('login').classList.remove('hidden');
  $('panel').classList.add('hidden');
}

function fmt(t) {
  return t ? new Date(t).toLocaleString() : '';
}

function renderItem(it) {
  const r = dictRow(it.tag);
  const c = dict.community.get(it.tag);
  const msg = el('div', { class: 'status' });
  const fields = [
    el('dt', { text: '词典译名' }),
    el('dd', { text: !dict.rows.length ? '…' : !r ? '（词典里没有，Danbooru 新标签里也没有；采纳后只进导出，下个版本加入词典）' : r.isNew ? '（' + rowNote(r) + '）' : r.label || '（无）' }),
  ];
  if (c && it.status === 'pending') fields.push(el('dt', { text: '当前社区修订' }), el('dd', { text: [c.label, c.aliases.join(' / ')].filter(Boolean).join('；检索词：') }));
  if (it.note) fields.push(el('dt', { text: '说明' }), el('dd', { text: it.note }));
  fields.push(el('dt', { text: '时间' }), el('dd', { text: fmt(it.created_at) + (it.reviewed_at ? '（审核于 ' + fmt(it.reviewed_at) + '）' : '') }));
  const node = el('div', { class: 'item' }, [
    el('div', { class: 'row' }, [el('strong', { class: 'tag', text: it.tag }), el('span', { class: 'muted', text: '#' + it.id })]),
  ]);
  if (it.status === 'pending') {
    const label = el('input', { maxlength: '60', 'aria-label': '译名' });
    label.value = it.label;
    const aliases = el('input', { 'aria-label': '检索词' });
    aliases.value = it.aliases.join('/');
    const act = async (action, btn) => {
      btn.disabled = true;
      try {
        await api('/api/admin/suggestions/' + it.id, action === 'approve' ? { action, label: label.value, aliases: aliases.value } : { action });
        node.remove();
      } catch (e) {
        setStatus(msg, e.message, 'err');
        btn.disabled = false;
      }
    };
    node.append(
      el('label', { text: '译名' }), label,
      el('label', { text: '检索词（/ 分隔）' }), aliases,
      el('dl', { style: 'margin-top:8px' }, fields),
      el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('button', { class: 'primary', type: 'button', text: '采纳', onclick: (e) => act('approve', e.currentTarget) }),
        el('button', { type: 'button', text: '驳回', onclick: (e) => act('reject', e.currentTarget) }),
      ]),
      msg,
    );
  } else {
    fields.unshift(el('dt', { text: '译名' }), el('dd', { text: it.label || '（不改）' }), el('dt', { text: '检索词' }), el('dd', { text: it.aliases.join(' / ') || '（无）' }));
    node.append(el('dl', { style: 'margin-top:8px' }, fields));
    if (it.status === 'approved') {
      node.append(el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('button', { type: 'button', text: '撤销', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api('/api/admin/suggestions/' + it.id, { action: 'revert' });
            node.remove();
          } catch (err) {
            setStatus(msg, err.message, 'err');
          }
        } }),
      ]), msg);
    }
  }
  return node;
}

async function load() {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-pressed', String(b.dataset.status === status));
  const list = $('list');
  setStatus($('list-status'), '正在载入…');
  try {
    const data = await api('/api/admin/suggestions?status=' + status);
    list.textContent = '';
    for (const it of data.items) list.append(renderItem(it));
    setStatus($('list-status'), data.items.length ? STATUS_NAMES[status] + ' ' + data.items.length + ' 条' + (data.items.length >= 200 ? '（只显示前 200 条）' : '') : '没有' + STATUS_NAMES[status] + '的提交');
  } catch (e) {
    setStatus($('list-status'), e.message, 'err');
  }
}

function start() {
  $('login').classList.add('hidden');
  $('panel').classList.remove('hidden');
  load();
  // 词典到了再重画一次，好对照原译名
  loadDict().then(() => load(), () => {});
}

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  token = $('token').value.trim();
  if (!token) return;
  try { sessionStorage.setItem('nzh-admin', token); } catch {}
  $('token').value = '';
  start();
});
for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => {
    status = b.dataset.status;
    load();
  });
}
$('refresh').addEventListener('click', load);
$('sync').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  setStatus($('list-status'), '正在从 Danbooru 拉取新标签…');
  try {
    // Danbooru 拒绝 Cloudflare Workers 的请求，所以在浏览器里拉，再交给平台存
    const tags = [];
    for (const u of cfg.danbooruUrls) {
      const res = await fetch(u, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error('Danbooru 返回 HTTP ' + res.status);
      const list = await res.json();
      tags.push(...list);
      if (list.length < 1000) break;
    }
    const r = await api('/api/admin/tags', { tags });
    setStatus($('list-status'), '拉到 ' + r.received + ' 个标签，存下 ' + r.stored + ' 个；提交页一小时内更新', 'ok');
  } catch (err) {
    setStatus($('list-status'), err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});
$('logout').addEventListener('click', logout);
if (token) start();
`;

export function adminPage(env, nonce) {
  const body = `
<h1>标签译名审核</h1>
<p class="muted">采纳后 5 分钟内生效，扩展每 3 小时更新一次。发版前用 <a href="/api/export.csv">导出 CSV</a> 把已采纳的修订并进 data/zh-override.csv 和 data/zh-extra.csv。</p>

<section id="login" class="card">
  <form id="login-form">
    <label for="token">管理口令 <span class="muted">即部署时设置的 ADMIN_TOKEN，只保存在本标签页</span></label>
    <input id="token" type="password" autocomplete="current-password">
    <div class="row" style="margin-top:12px"><button class="primary" type="submit">进入</button></div>
  </form>
</section>

<section id="panel" class="card hidden">
  <div class="row tabs">
    <button type="button" data-status="pending">待审核</button>
    <button type="button" data-status="approved">已采纳</button>
    <button type="button" data-status="rejected">已驳回</button>
    <button type="button" data-status="reverted">已撤销</button>
    <span style="flex:1"></span>
    <button id="sync" type="button" title="平时由 GitHub Actions 每天拉一次">拉取新标签</button>
    <button id="refresh" type="button">刷新</button>
    <button id="logout" type="button">退出</button>
  </div>
  <div id="list-status" class="status"></div>
  <div id="list"></div>
</section>
${config({ dictUrl: dictUrl(env), danbooruUrls: Array.from({ length: DANBOORU_PAGES }, (_, i) => danbooruTagsUrl(i + 1)) })}
<script nonce="${nonce}">
const cfg = JSON.parse(document.getElementById('cfg').textContent);
${DICT_SCRIPT}
${ADMIN_SCRIPT}
</script>`;
  return layout('审核 · NovelAI中文化助手', nonce, body);
}
