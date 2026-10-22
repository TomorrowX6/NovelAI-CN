// 编辑器页面：仿照 EhTagTranslation 的 ehtt.vercel.app（Angular Material 风格），这里是不依赖框架的单页应用。
// 列表页 /list/:类别 按搜索（普通文字或 /正则/）、类别、范围筛选，分页显示；编辑页 /edit/:标签 左边表单、右边预览和编辑日志。
// 页面脚本放在 String.raw 里（不用反引号和 ${}），反斜杠原样保留；提交的内容一律用 textContent 渲染，配合带 nonce 的 CSP。

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// 给页面脚本的配置放在 JSON 里，转义 < 免得提前结束 <script>
const config = (data) => `<script type="application/json" id="cfg">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

export function pageCsp(nonce) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const STYLE = `
:root {
  --accent: #aa00ff; --accent-dark: #7c00c4; --text: rgba(0,0,0,.87); --muted: rgba(0,0,0,.54); --faint: rgba(0,0,0,.38);
  --line: rgba(0,0,0,.12); --bg: #fafafa; --card: #fff; --hover: rgba(0,0,0,.04); --mark: #ffff00; --warn: #b26a00; --error: #f44336; --ok: #2e7d32;
  --shadow: 0 5px 5px -3px rgba(0,0,0,.2), 0 8px 10px 1px rgba(0,0,0,.14), 0 3px 14px 2px rgba(0,0,0,.12);
  --shadow-1: 0 2px 1px -1px rgba(0,0,0,.2), 0 1px 1px 0 rgba(0,0,0,.14), 0 1px 3px 0 rgba(0,0,0,.12);
  --shadow-2: 0 3px 1px -2px rgba(0,0,0,.2), 0 2px 2px 0 rgba(0,0,0,.14), 0 1px 5px 0 rgba(0,0,0,.12);
  color-scheme: light;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--bg); color: var(--text); font: 14px/20px Roboto, "Noto Sans", Arial, Helvetica, "Noto Sans CJK SC", "Microsoft Yahei UI", sans-serif; }
a { color: var(--accent-dark); }
[hidden] { display: none !important; }
svg.icon { width: 24px; height: 24px; fill: currentColor; flex: none; }

/* 顶栏 */
.toolbar { position: sticky; top: 0; z-index: 10; height: 64px; display: flex; align-items: center; gap: 8px; padding: 0 16px; background: var(--accent); color: #fff; box-shadow: var(--shadow); }
.toolbar .title { color: #fff; text-decoration: none; font-size: 20px; font-weight: 500; letter-spacing: .0125em; padding: 0 16px; line-height: 36px; border-radius: 4px; white-space: nowrap; }
.toolbar .title:hover { background: rgba(255,255,255,.08); }
.spacer { flex: 1 1 auto; }
.icon-btn { width: 40px; height: 40px; border: 0; border-radius: 50%; padding: 8px; display: inline-flex; align-items: center; justify-content: center; background: none; color: inherit; cursor: pointer; text-decoration: none; }
.icon-btn:hover { background: var(--hover); }
.toolbar .icon-btn:hover { background: rgba(255,255,255,.12); }
.icon-btn:disabled { color: var(--faint); cursor: default; background: none; }
.icon-btn.accent { color: var(--accent); }
.user { position: relative; margin-right: 64px; }
.user-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 10px; border: 0; border-radius: 4px; background: none; color: #fff; font: inherit; font-weight: 500; cursor: pointer; text-decoration: none; }
.user-btn:hover { background: rgba(255,255,255,.12); }
.user-btn img { width: 28px; height: 28px; border-radius: 50%; }
.menu { position: absolute; right: 0; top: 40px; min-width: 160px; padding: 8px 0; background: var(--card); color: var(--text); border-radius: 4px; box-shadow: var(--shadow); z-index: 20; }
.menu a, .menu button { display: block; width: 100%; padding: 0 16px; line-height: 48px; border: 0; background: none; color: inherit; font: inherit; text-align: left; text-decoration: none; cursor: pointer; white-space: nowrap; }
.menu a:hover, .menu button:hover { background: var(--hover); }
.github-corner { position: absolute; top: 0; right: 0; color: #fff; }
.github-corner svg { display: block; width: 64px; height: 64px; fill: #151513; }
.github-corner:hover .octo-arm { animation: octocat-wave 560ms ease-in-out; }
@keyframes octocat-wave { 0%, 100% { transform: rotate(0); } 20%, 60% { transform: rotate(-25deg); } 40%, 80% { transform: rotate(10deg); } }

/* 页面卡片 */
article { padding: 32px 24px; }
.page-box { background: var(--card); border-radius: 4px; box-shadow: var(--shadow); min-height: calc(100vh - 128px); display: flex; flex-direction: column; }
.page-box > header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 24px; padding: 16px 24px 8px; }

/* 输入框（Material 下划线样式） */
.field { position: relative; display: flex; flex-direction: column; min-width: 0; padding-top: 18px; }
.field-label { position: absolute; top: 0; left: 0; display: flex; align-items: center; gap: 2px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.field-label svg.icon { width: 14px; height: 14px; }
.field input, .field textarea, .field select { width: 100%; border: 0; border-bottom: 1px solid rgba(0,0,0,.42); padding: 4px 0 6px; font: inherit; font-size: 15px; color: inherit; background: none; outline: none; border-radius: 0; }
.field textarea { resize: vertical; min-height: 44px; }
.field input:focus, .field textarea:focus, .field select:focus { border-bottom: 2px solid var(--accent); padding-bottom: 5px; }
.field:focus-within .field-label { color: var(--accent); }
.field input:disabled { color: var(--faint); border-bottom: 1px dotted rgba(0,0,0,.42); }
.field .suffix { position: absolute; right: 0; bottom: 8px; color: var(--muted); font-size: 12px; font-family: ui-monospace, Consolas, monospace; }
.field .suffix-btn { position: absolute; right: -8px; bottom: 0; }
.field-hint { font-size: 12px; color: var(--muted); margin-top: 6px; min-height: 16px; line-height: 16px; }
.field-error { font-size: 12px; color: var(--error); margin-top: 2px; line-height: 16px; }
.field.invalid input, .field.invalid textarea { border-bottom: 2px solid var(--error); }
.field.invalid .field-label { color: var(--error); }

/* 列表页 */
.search { width: 220px; }
.search input { padding-right: 24px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chip { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 6px 0 12px; border-radius: 16px; background: #e0e0e0; font-size: 14px; }
.chip button { border: 0; background: none; padding: 0; display: inline-flex; color: rgba(0,0,0,.54); cursor: pointer; }
.chip button svg.icon { width: 18px; height: 18px; }
.paginator { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
.paginator select { border: 0; border-bottom: 1px solid rgba(0,0,0,.42); font: inherit; font-size: 12px; color: var(--text); background: none; padding: 4px 0; }
.paginator .range { margin: 0 16px; white-space: nowrap; }
.select-field { width: 120px; }
.table-wrapper { overflow-x: auto; flex: 1; position: relative; }
table { width: 100%; border-collapse: collapse; }
th { position: sticky; top: 0; background: var(--card); z-index: 1; height: 56px; padding: 0 12px; text-align: left; font-size: 12px; font-weight: 500; color: var(--muted); border-bottom: 1px solid var(--line); white-space: nowrap; }
th[data-sort] { cursor: pointer; user-select: none; }
th[data-sort]:hover { color: var(--text); }
th .arrow { display: inline-block; width: 12px; margin-left: 4px; }
td { padding: 12px; border-bottom: 1px solid var(--line); vertical-align: middle; }
tbody tr:hover { background: var(--hover); }
td.handle, th.handle { width: 56px; padding: 0 0 0 16px; }
td.handle .icon-btn { color: var(--faint); }
td.handle .icon-btn:hover { color: var(--accent); }
td.cat a { color: var(--text); text-decoration: none; }
td.cat a:hover { text-decoration: underline; }
td.raw { font-family: inherit; overflow-wrap: anywhere; min-width: 140px; }
td.name { min-width: 120px; }
td.aliases { color: var(--muted); min-width: 140px; max-width: 360px; }
td.count { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
th.count { text-align: right; }
mark { background: var(--mark); color: inherit; padding: 0; }
.badge { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 10px; font-size: 11px; line-height: 18px; background: #f3e5f5; color: var(--accent-dark); white-space: nowrap; vertical-align: 1px; }
.badge.new { background: #e8f5e9; color: var(--ok); }
.none { color: var(--faint); }
.empty, .spinner-box { padding: 48px 24px; text-align: center; color: var(--muted); }
.spinner { width: 48px; height: 48px; margin: 0 auto; border: 4px solid #e1bee7; border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 编辑页 */
.headline { font-size: 24px; line-height: 32px; }
.btn { height: 36px; padding: 0 16px; border: 0; border-radius: 4px; font: inherit; font-weight: 500; cursor: pointer; background: var(--card); color: var(--text); box-shadow: var(--shadow-2); }
.btn.primary { background: var(--accent); color: #fff; }
.btn:disabled { background: rgba(0,0,0,.12); color: var(--faint); box-shadow: none; cursor: default; }
.btn.text { box-shadow: none; background: none; }
.btn.text:hover { background: var(--hover); }
.banner { margin: 0 24px 8px; padding: 10px 16px; border-radius: 4px; background: #f3e5f5; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.banner.warn { background: #fff8e1; color: #5d4037; }
.edit-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; padding: 8px 24px 24px; }
.form-col { display: flex; flex-direction: column; gap: 14px; }
.guide { font-size: 12px; color: var(--muted); }
.guide ul { margin: 4px 0 0; padding-left: 18px; }
.guide li { margin: 2px 0; }
.preview-col { display: flex; flex-direction: column; gap: 16px; }
.cards-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.card { background: var(--card); border-radius: 4px; box-shadow: var(--shadow-1); padding: 16px; min-height: 80px; overflow-wrap: anywhere; }
.card-label { font-size: 14px; color: var(--muted); margin-bottom: 12px; }
.card-row { display: flex; align-items: center; justify-content: space-between; }
.card-row .card-label { margin: 0; }
.caption { font-size: 12px; color: var(--muted); margin-top: 6px; }
.alias-chip { display: inline-block; margin: 0 6px 6px 0; padding: 2px 10px; border-radius: 12px; background: #eeeeee; font-size: 13px; }
.alias-chip.mine { background: #f3e5f5; color: var(--accent-dark); }
.history { list-style: none; margin: 12px 0 0; padding: 0; }
.history li { display: flex; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
.history img { width: 32px; height: 32px; border-radius: 50%; flex: none; }
.history .what { font-size: 13px; }
.history .meta { font-size: 12px; color: var(--muted); }
.suggest { position: absolute; left: 0; right: 0; top: 100%; z-index: 5; background: var(--card); box-shadow: var(--shadow); border-radius: 4px; padding: 8px 0; max-height: 320px; overflow-y: auto; }
.suggest a { display: flex; justify-content: space-between; gap: 12px; padding: 0 16px; line-height: 40px; color: var(--text); text-decoration: none; }
.suggest a:hover { background: var(--hover); }
.suggest .zh { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.snackbar { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 30; min-width: 288px; max-width: calc(100vw - 32px); padding: 14px 16px; border-radius: 4px; background: #323232; color: #fff; box-shadow: var(--shadow); display: flex; align-items: center; gap: 16px; }
.snackbar a { color: #ea80fc; font-weight: 500; white-space: nowrap; }
.snackbar.error { background: #b71c1c; }

@media (max-width: 760px) {
  article { padding: 8px 0 0; }
  .page-box { border-radius: 0; min-height: calc(100vh - 72px); }
  .page-box > header { padding: 12px 16px 8px; }
  .search { width: 100%; }
  .paginator .range { margin: 0 4px; }
  .edit-body { grid-template-columns: 1fr; padding: 8px 16px 16px; }
  .banner { margin: 0 16px 8px; }
  .toolbar .title { padding: 0 4px; font-size: 18px; }
  .user { margin-right: 48px; }
  .user-btn .name { display: none; }
  .github-corner svg { width: 48px; height: 48px; }
}
`;

// Material Icons 的路径
const ICONS = {
  arrow_back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  add_circle: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  help: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
  chevron_left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  chevron_right: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  cancel: 'M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z',
  github:
    'M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.58v-2.02c-3.34.73-4.04-1.6-4.04-1.6-.55-1.4-1.34-1.77-1.34-1.77-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.31-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.62-5.48 5.92.42.36.81 1.1.81 2.22v3.29c0 .32.21.7.82.58A12 12 0 0 0 12 .3',
};

const svg = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

const CORNER =
  '<svg viewBox="0 0 250 250" aria-hidden="true"><path d="M0 0l115 115h15l12 27 108 108V0z"/>' +
  '<path class="octo-arm" fill="currentColor" style="transform-origin:130px 106px" d="M128.3 109c-14.5-9.3-9.3-19.4-9.3-19.4 3-6.9 1.5-11 1.5-11-1.3-6.6 2.9-2.3 2.9-2.3 3.9 4.6 2.1 11 2.1 11-2.6 10.3 5.1 14.6 8.9 15.9"/>' +
  '<path fill="currentColor" d="M115 115c-.1.1 3.7 1.5 4.8.4l13.9-13.8c3.2-2.4 6.2-3.2 8.5-3-8.4-10.6-14.7-24.2 1.6-40.6 4.7-4.6 10.2-6.8 15.9-7 .6-1.6 3.5-7.4 11.7-10.9 0 0 4.7 2.4 7.4 16.1 4.3 2.4 8.4 5.6 12.1 9.2 3.6 3.6 6.8 7.8 9.2 12.2 13.7 2.6 16.2 7.3 16.2 7.3-3.6 8.2-9.4 11.1-10.9 11.7-.3 5.8-2.4 11.2-7.1 15.9-16.4 16.4-30 10-40.6 1.6.2 2.8-1 6.8-5 10.8L141 136.5c-1.2 1.2.6 5.4.8 5.3z"/></svg>';

// 页面脚本。String.raw 保留反斜杠；不能出现反引号和 ${
const CLIENT = String.raw`
const cfg = JSON.parse(document.getElementById('cfg').textContent);
const $ = (id) => document.getElementById(id);
const SEP = '\u0001';
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const UNSAFE = /[<>\x00-\x1f\x7f]|[a-z][\w+.-]*:\/\/|javascript:|www\./i;
const CATS = { 0: ['general', '通用'], 3: ['copyright', '作品'], 4: ['character', '角色'], 5: ['meta', '元标签'] };
const CAT_BY_SLUG = { general: 0, copyright: 3, character: 4, meta: 5 };
const SCOPES = { all: '全部标签', todo: '未翻译', community: '社区修订' };
const ICONS = cfg.icons;

function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'icon');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]);
  s.append(p);
  return s;
}
function el(tag, props, children) {
  const n = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children || []) if (c != null && c !== false) n.append(c);
  return n;
}
const normTag = (s) => {
  let t = String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  if (/[a-z]{2}/.test(t)) t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
};
const fmt = (n) => (n || 0).toLocaleString('zh-CN');
const editHref = (tag) => '/edit/' + encodeURIComponent(tag);
const ghUrl = (p) => 'https://github.com/' + cfg.repo + p;
const fileHistoryUrl = () => ghUrl('/commits/' + cfg.branch + '/' + cfg.path);

// ---- 提示条 ----
let snackTimer = 0;
function snack(text, opts) {
  opts = opts || {};
  const s = $('snackbar');
  s.textContent = '';
  s.className = 'snackbar' + (opts.error ? ' error' : '');
  s.append(el('span', { text: text }));
  if (opts.link) s.append(el('a', { href: opts.link.href, target: '_blank', rel: 'noopener', text: opts.link.text }));
  s.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => (s.hidden = true), opts.error ? 8000 : 5000);
}

// ---- 数据：词典（带类别）、Danbooru 新标签、社区修订 ----
const db = { rows: [], byTag: new Map(), alias: new Map(), community: new Map(), ready: null };
function addRow(r) {
  db.rows.push(r);
  db.byTag.set(r.tag, r);
}
function rowFor(tag) {
  return db.byTag.get(tag) || db.byTag.get(db.alias.get(tag)) || null;
}
function setCommunity(entries) {
  db.community = new Map((entries || []).map((e) => [e.tag, e]));
  // 社区里有、词典和新标签里都没有的标签也列出来
  for (const e of db.community.values()) if (!db.byTag.has(e.tag)) addRow({ tag: e.tag, count: e.count || 0, label: '', extra: [], category: null, isNew: false, outside: true });
}
function loadData() {
  if (db.ready) return db.ready;
  const dict = fetch(cfg.dictUrl).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
  const getJson = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  db.ready = Promise.all([dict, getJson('/api/tags'), getJson('/api/community')]).then(([text, nt, cm]) => {
    for (const line of text.split('\n')) {
      if (!line) continue;
      const f = line.split('\t');
      const r = { tag: f[0], count: +f[1] || 0, label: f[2] || '', extra: f[3] ? f[3].split('|') : [], category: f[5] === undefined || f[5] === '' ? null : +f[5] };
      addRow(r);
      if (f[4]) for (const o of f[4].split('|')) if (!db.alias.has(o)) db.alias.set(o, r.tag);
    }
    db.dictSize = db.rows.length;
    for (const t of nt.tags || []) if (!db.byTag.has(t.tag)) addRow({ tag: t.tag, count: t.count, label: '', extra: [], category: t.category, isNew: true });
    setCommunity(cm.entries);
  });
  db.ready.catch(() => (db.ready = null));
  return db.ready;
}
const communityOf = (r) => db.community.get(r.tag) || null;
const nameOf = (r) => {
  const c = communityOf(r);
  return (c && c.label) || r.label;
};
const aliasesOf = (r) => {
  const c = communityOf(r);
  return (c ? c.aliases : []).concat(r.extra.filter((x) => !(c && c.aliases.includes(x))));
};
const untranslated = (r) => !HAN.test(nameOf(r));

// ---- 搜索：普通文字或 /正则/ ----
function matcher(q) {
  q = q.trim();
  if (!q) return null;
  const m = q.match(/^\/(.+)\/([imsu]*)$/);
  if (m) {
    try {
      const re = new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i');
      return { regex: true, test: (s) => re.test(s), re: re };
    } catch (e) {}
  }
  const low = q.toLowerCase();
  const alt = normTag(q);
  return { regex: false, test: (s) => s.toLowerCase().includes(low) || (alt !== low && s.toLowerCase().includes(alt)), word: low, alt: alt };
}
// 把匹配到的部分包在 <mark> 里，只用文本节点
function highlight(text, m) {
  const frag = document.createDocumentFragment();
  if (!m || !text) {
    frag.append(text || '');
    return frag;
  }
  const ranges = [];
  if (m.regex) {
    const re = new RegExp(m.re.source, m.re.flags.includes('g') ? m.re.flags : m.re.flags + 'g');
    let x;
    while ((x = re.exec(text)) && ranges.length < 50) {
      if (!x[0]) {
        re.lastIndex++;
        continue;
      }
      ranges.push([x.index, x.index + x[0].length]);
    }
  } else {
    const low = text.toLowerCase();
    for (const w of m.alt !== m.word ? [m.word, m.alt] : [m.word]) {
      let i = 0;
      while (w && (i = low.indexOf(w, i)) >= 0 && ranges.length < 50) {
        ranges.push([i, i + w.length]);
        i += w.length;
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
  }
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a < pos) continue;
    frag.append(text.slice(pos, a), el('mark', { text: text.slice(a, b) }));
    pos = b;
  }
  frag.append(text.slice(pos));
  return frag;
}

// ---- 路由 ----
function navigate(href, replace) {
  history[replace ? 'replaceState' : 'pushState'](null, '', href);
  render();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', () => render());
$('back').addEventListener('click', () => (history.length > 1 ? history.back() : navigate('/')));

// ---- 登录状态 ----
// 登录链接在点击时才带上当前地址，登录完回到这里
const loginHref = () => '/auth/login?return=' + encodeURIComponent(location.pathname + location.search);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a.login');
  if (a) a.href = loginHref();
  for (const m of document.querySelectorAll('.menu')) if (!m.parentNode.contains(e.target)) m.hidden = true;
});
function renderUser() {
  const box = $('user');
  box.textContent = '';
  $('login-banner').hidden = !!cfg.user;
  if (!cfg.user) {
    box.append(el('a', { class: 'user-btn login', href: loginHref() }, [icon('github'), el('span', { class: 'name', text: '登录' })]));
    return;
  }
  const menu = el('div', { class: 'menu', hidden: true }, [
    el('a', { href: 'https://github.com/' + cfg.user.login, target: '_blank', rel: 'noopener', text: '@' + cfg.user.login }),
    el('a', { href: fileHistoryUrl() + '?author=' + encodeURIComponent(cfg.user.login), target: '_blank', rel: 'noopener', text: '我的修改' }),
    el('button', {
      type: 'button',
      text: '退出',
      onclick: () => fetch('/auth/logout', { method: 'POST' }).then(() => location.reload()),
    }),
  ]);
  const btn = el('button', { class: 'user-btn', type: 'button', 'aria-haspopup': 'menu', onclick: () => (menu.hidden = !menu.hidden) }, [
    cfg.user.avatar ? el('img', { src: cfg.user.avatar + (cfg.user.avatar.includes('?') ? '&' : '?') + 's=56', alt: '' }) : icon('github'),
    el('span', { class: 'name', text: cfg.user.login }),
  ]);
  box.append(btn, menu);
}

// ---- 列表页 ----
function listState() {
  const p = new URLSearchParams(location.search);
  const slug = decodeURIComponent(location.pathname.replace(/^\/list\/?/, '').replace(/^\/$/, ''));
  return {
    cat: slug in CAT_BY_SLUG ? CAT_BY_SLUG[slug] : null,
    search: p.get('search') || '',
    scope: p.get('scope') in SCOPES ? p.get('scope') : 'all',
    page: Math.max(0, +p.get('page') || 0),
    size: [10, 25, 50, 100].includes(+p.get('size')) ? +p.get('size') : 25,
    sort: ['tag', 'name', 'count', 'category'].includes(p.get('sort')) ? p.get('sort') : 'count',
    dir: p.get('dir') === 'asc' ? 'asc' : 'desc',
  };
}
function listHref(s) {
  const p = new URLSearchParams();
  if (s.search) p.set('search', s.search);
  if (s.scope !== 'all') p.set('scope', s.scope);
  if (s.page) p.set('page', s.page);
  if (s.size !== 25) p.set('size', s.size);
  if (s.sort !== 'count' || s.dir !== 'desc') {
    p.set('sort', s.sort);
    p.set('dir', s.dir);
  }
  const q = p.toString();
  return (s.cat == null ? '/list' : '/list/' + CATS[s.cat][0]) + (q ? '?' + q : '');
}
function setList(change, replace) {
  navigate(listHref(Object.assign(listState(), change)), replace);
}
let searchTimer = 0;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => setList({ search: v, page: 0 }, true), 200);
});
$('scope').addEventListener('change', (e) => setList({ scope: e.target.value, page: 0 }));
$('page-size').addEventListener('change', (e) => setList({ size: +e.target.value, page: 0 }));
$('prev').addEventListener('click', () => setList({ page: listState().page - 1 }));
$('next').addEventListener('click', () => setList({ page: listState().page + 1 }));
for (const th of document.querySelectorAll('th[data-sort]')) {
  th.addEventListener('click', () => {
    const s = listState();
    const key = th.dataset.sort;
    setList({ sort: key, dir: s.sort === key && s.dir === 'desc' ? 'asc' : 'desc', page: 0 });
  });
}

function filtered(s) {
  const m = matcher(s.search);
  const out = [];
  for (const r of db.rows) {
    if (s.cat != null && r.category !== s.cat) continue;
    if (s.scope === 'todo' && !untranslated(r)) continue;
    if (s.scope === 'community' && !communityOf(r)) continue;
    if (m) {
      const c = communityOf(r);
      if (!(m.test(r.tag) || m.test(r.label) || (c && m.test(c.label)) || m.test(aliasesOf(r).join(SEP)))) continue;
    }
    out.push(r);
  }
  const dir = s.dir === 'asc' ? 1 : -1;
  const key = { tag: (r) => r.tag, name: (r) => nameOf(r), count: (r) => r.count, category: (r) => (r.category == null ? 9 : r.category) }[s.sort];
  out.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || b.count - a.count;
  });
  return { rows: out, m: m };
}

function renderList() {
  const s = listState();
  $('view-list').hidden = false;
  $('view-edit').hidden = true;
  document.title = (s.cat != null ? CATS[s.cat][1] + ' - ' : '') + 'NovelAI Tag Editor';
  if (document.activeElement !== $('search')) $('search').value = s.search;
  $('scope').value = s.scope;
  $('page-size').value = String(s.size);
  $('add').setAttribute('href', '/edit/*new');
  const m = matcher(s.search);
  $('search-mode').textContent = m ? (m.regex ? '.*' : 'ab') : '';
  $('search-mode').title = m ? (m.regex ? '正在使用正则表达式进行匹配' : '正在使用普通文本进行匹配') : '';
  const chips = $('chips');
  chips.textContent = '';
  if (s.cat != null) chips.append(el('span', { class: 'chip' }, ['类别：' + CATS[s.cat][1], el('button', { type: 'button', 'aria-label': '取消类别筛选', onclick: () => setList({ cat: null, page: 0 }) }, [icon('cancel')])]));
  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.querySelector('.arrow').textContent = th.dataset.sort === s.sort ? (s.dir === 'asc' ? '↑' : '↓') : '';
  }
  $('col-cat').hidden = s.cat != null;
  const body = $('rows');
  body.textContent = '';
  if (!db.rows.length) {
    $('table-msg').hidden = false;
    return;
  }
  $('table-msg').hidden = true;
  const res = filtered(s);
  const pages = Math.max(1, Math.ceil(res.rows.length / s.size));
  const page = Math.min(s.page, pages - 1);
  const start = page * s.size;
  const shown = res.rows.slice(start, start + s.size);
  $('range').textContent = res.rows.length ? fmt(start + 1) + ' - ' + fmt(start + shown.length) + ' / ' + fmt(res.rows.length) : '0 / 0';
  $('prev').disabled = page === 0;
  $('next').disabled = page >= pages - 1;
  for (const r of shown) {
    const c = communityOf(r);
    const name = nameOf(r);
    const nameCell = el('td', { class: 'name' });
    if (name) nameCell.append(highlight(name, res.m));
    else nameCell.append(el('span', { class: 'none', text: '（还没有中文）' }));
    if (c) nameCell.append(el('span', { class: 'badge', text: '社区' }));
    const raw = el('td', { class: 'raw' }, [highlight(r.tag, res.m)]);
    if (r.isNew) raw.append(el('span', { class: 'badge new', title: 'Danbooru 新标签，词典里还没有', text: '新' }));
    body.append(
      el('tr', null, [
        el('td', { class: 'handle' }, [el('a', { class: 'icon-btn', href: editHref(r.tag), 'data-link': true, title: '编辑', 'aria-label': '编辑 ' + r.tag }, [icon('edit')])]),
        s.cat == null ? el('td', { class: 'cat' }, [r.category != null && CATS[r.category] ? el('a', { href: '/list/' + CATS[r.category][0], 'data-link': true, text: CATS[r.category][1] }) : el('span', { class: 'none', text: '—' })]) : null,
        raw,
        nameCell,
        el('td', { class: 'aliases' }, [highlight(aliasesOf(r).slice(0, 8).join(' / '), res.m)]),
        el('td', { class: 'count', text: fmt(r.count) }),
      ]),
    );
  }
  if (!shown.length) body.append(el('tr', null, [el('td', { colspan: 6, class: 'empty', text: s.scope === 'todo' && !s.search ? '这个类别的标签都有中文了' : '没有找到' })]));
}

// ---- 编辑页 ----
const edit = { tag: null, create: false, original: null, base: null, saving: false };
function checkZh(s, max) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return t.length <= max && HAN.test(t) && !UNSAFE.test(t) ? t : null;
}
function parseAliasesInput(s) {
  const out = [];
  for (const raw of String(s || '').split(/[/／、，,]/)) {
    if (!raw.trim()) continue;
    const a = checkZh(raw, 30);
    if (a === null) return null;
    if (!out.includes(a)) out.push(a);
  }
  return out.length <= 8 ? out : null;
}
function setFieldError(id, msg) {
  const f = $(id).closest('.field');
  f.classList.toggle('invalid', !!msg);
  f.querySelector('.field-error').textContent = msg || '';
}
function currentTag() {
  return edit.create ? normTag($('f-raw').value) : edit.tag;
}
function formValue() {
  return { label: checkZh($('f-name').value, 60), aliases: parseAliasesInput($('f-aliases').value), note: $('f-note').value.trim() };
}
function validate() {
  const v = formValue();
  const tag = currentTag();
  let ok = true;
  if (edit.create) {
    const bad = !tag || tag.length > 100 || !/^[\x20-\x7e]+$/.test(tag);
    setFieldError('f-raw', $('f-raw').value && bad ? '只能包含英文字母、数字和符号，最多 100 个字符' : '');
    if (bad) ok = false;
  }
  setFieldError('f-name', v.label === null ? '必须含汉字，最多 60 个字，不能有 < > 或网址' : '');
  setFieldError('f-aliases', v.aliases === null ? '最多 8 个，每个必须含汉字、最多 30 个字，不能有 < > 或网址' : '');
  if (v.label === null || v.aliases === null) ok = false;
  const changed = ok && edit.original && (v.label !== edit.original.label || v.aliases.join('/') !== edit.original.aliases.join('/'));
  $('submit').disabled = !cfg.user || !changed || edit.saving;
  $('delete-hint').hidden = !(ok && edit.base && !v.label && !v.aliases.length);
  return ok ? v : null;
}

function renderPreview() {
  const tag = currentTag();
  const r = tag ? rowFor(tag) : null;
  const v = formValue();
  $('p-raw').textContent = tag || '';
  const name = $('p-name');
  name.textContent = '';
  if (v.label) name.append(v.label);
  else if (r && r.label) name.append(el('span', { class: 'none', text: r.label + '（沿用词典）' }));
  else name.append(el('span', { class: 'none', text: '（还没有中文）' }));
  $('p-dict').textContent = r && r.label && !r.isNew ? '词典译名：' + r.label : '';
  const al = $('p-aliases');
  al.textContent = '';
  for (const a of v.aliases || []) al.append(el('span', { class: 'alias-chip mine', text: a }));
  for (const a of r ? r.extra : []) if (!(v.aliases || []).includes(a)) al.append(el('span', { class: 'alias-chip', text: a }));
  if (!al.children.length) al.append(el('span', { class: 'none', text: '（无）' }));
  const dan = $('p-danbooru');
  dan.textContent = '';
  if (tag) {
    const q = encodeURIComponent(tag.replace(/ /g, '_'));
    dan.append(
      el('div', { text: (r && r.category != null && CATS[r.category] ? CATS[r.category][1] + ' · ' : '') + (r ? fmt(r.count) + ' 张图' : '不在词典里') }),
      el('div', { class: 'caption' }, [
        el('a', { href: 'https://danbooru.donmai.us/wiki_pages/' + q, target: '_blank', rel: 'noopener', text: 'Danbooru Wiki' }),
        ' · ',
        el('a', { href: 'https://danbooru.donmai.us/posts?tags=' + q, target: '_blank', rel: 'noopener', text: '图片' }),
        ' · ',
        el('a', { href: 'https://zh.moegirl.org.cn/index.php?search=' + encodeURIComponent(v.label || (r && r.label) || tag), target: '_blank', rel: 'noopener', text: '萌娘百科' }),
        ' · ',
        el('a', { href: 'https://zh.wikipedia.org/w/index.php?search=' + encodeURIComponent(v.label || (r && r.label) || tag), target: '_blank', rel: 'noopener', text: '维基百科' }),
      ]),
    );
  }
  const note = $('raw-note');
  if (edit.create && tag && !r) note.textContent = '词典和 Danbooru 新标签里都没有这个标签：提交后扩展不会用上，下个版本核实后再并入词典';
  else if (r && r.isNew) note.textContent = 'Danbooru 新标签，词典里还没有：填好名称后扩展会直接收录';
  else note.textContent = edit.create ? '输入英文标签；已有的标签会出现在下面' : '修改标签时无法更改此项';
}

function renderSuggest() {
  const box = $('raw-suggest');
  box.textContent = '';
  const q = normTag($('f-raw').value);
  if (!edit.create || q.length < 2) {
    box.hidden = true;
    return;
  }
  const hits = [];
  for (const r of db.rows) {
    if (r.tag.indexOf(q) < 0) continue;
    hits.push(r);
  }
  hits.sort((a, b) => (a.tag === q ? -1 : b.tag === q ? 1 : 0) || b.count - a.count);
  for (const r of hits.slice(0, 8)) box.append(el('a', { href: editHref(r.tag), 'data-link': true }, [el('span', { text: r.tag }), el('span', { class: 'zh', text: nameOf(r) || '' })]));
  box.hidden = !box.children.length;
}

async function loadHistory() {
  const tag = currentTag();
  const list = $('history');
  list.textContent = '';
  $('load-history').disabled = true;
  try {
    const d = await fetch('/api/history?tag=' + encodeURIComponent(tag), { cache: 'no-store' }).then((r) => r.json());
    for (const it of d.items || []) {
      const what = { add: '新增', update: '修改', delete: '删除' }[it.action] || it.action;
      const detail = it.action === 'delete' ? '' : [it.label ? '名称「' + it.label + '」' : '', it.aliases ? '检索词「' + it.aliases + '」' : ''].filter(Boolean).join('，');
      list.append(
        el('li', null, [
          it.avatar ? el('img', { src: it.avatar + (it.avatar.includes('?') ? '&' : '?') + 's=64', alt: '' }) : null,
          el('div', null, [
            el('div', { class: 'what' }, [el('a', { href: 'https://github.com/' + it.login, target: '_blank', rel: 'noopener', text: it.login }), ' ' + what + (detail ? '：' + detail : '')]),
            it.note ? el('div', { class: 'meta', text: it.note }) : null,
            el('div', { class: 'meta' }, [
              new Date(it.created_at).toLocaleString('zh-CN'),
              it.sha ? ' · ' : '',
              it.sha ? el('a', { href: ghUrl('/commit/' + it.sha), target: '_blank', rel: 'noopener', text: it.sha.slice(0, 7) }) : '',
            ]),
          ]),
        ]),
      );
    }
    if (!list.children.length) list.append(el('li', { class: 'meta', text: '这个标签还没有通过编辑器修改过' }));
  } catch (e) {
    list.append(el('li', { class: 'meta', text: '加载失败' }));
  } finally {
    $('load-history').disabled = false;
  }
}

function fillForm(entry) {
  $('f-name').value = entry ? entry.label : '';
  $('f-aliases').value = entry ? entry.aliases.join('/') : '';
  $('f-note').value = '';
}

function renderEdit(param) {
  $('view-list').hidden = true;
  $('view-edit').hidden = false;
  const create = param === '*new';
  const tag = create ? null : normTag(param);
  // 同一个标签的编辑页重复渲染（比如登录状态变化）时保留正在填的内容
  if (edit.tag !== tag || edit.create !== create || !edit.original) {
    edit.create = create;
    edit.tag = tag;
    const c = tag ? db.community.get(tag) || null : null;
    edit.base = c ? { label: c.label, aliases: c.aliases } : null;
    edit.original = { label: c ? c.label : '', aliases: c ? c.aliases.slice() : [] };
    $('f-raw').value = create ? new URLSearchParams(location.search).get('raw') || '' : tag;
    fillForm(c);
    $('history').textContent = '';
  }
  $('edit-title').textContent = create ? '创建标签' : '修改标签';
  document.title = (create ? '创建标签' : tag) + ' - NovelAI Tag Editor';
  $('f-raw').disabled = !create;
  const r = tag ? rowFor(tag) : null;
  $('f-category').textContent = r && r.category != null && CATS[r.category] ? CATS[r.category][1] + '（' + CATS[r.category][0] + '）' : '—';
  $('gh-history').href = fileHistoryUrl();
  renderPreview();
  validate();
}

async function submit() {
  const v = validate();
  const tag = currentTag();
  if (!v || !tag || !cfg.user) return;
  edit.saving = true;
  validate();
  try {
    const res = await fetch('/api/tags/' + encodeURIComponent(tag), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: v.label, aliases: v.aliases, note: v.note, base: edit.create ? db.community.get(tag) || null : edit.base }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) {
      cfg.user = null;
      renderUser();
      renderEdit(edit.create ? '*new' : edit.tag);
      return snack('登录已过期，请重新登录', { error: true });
    }
    if (!res.ok) return snack(d.error || '提交失败（HTTP ' + res.status + '）', { error: true });
    if (d.action === 'delete') db.community.delete(tag);
    else if (d.entry) setCommunity([...db.community.values()].filter((e) => e.tag !== tag).concat([d.entry]));
    edit.base = d.entry && d.action !== 'delete' ? { label: d.entry.label, aliases: d.entry.aliases } : null;
    edit.original = { label: v.label, aliases: v.aliases };
    $('f-note').value = '';
    if (d.action === 'none') snack('内容没有变化');
    else snack({ add: '已新增', update: '已修改', delete: '已删除' }[d.action] + ' ' + tag + '，扩展几小时内用上', d.commit && d.commit.url ? { link: { href: d.commit.url, text: '查看提交' } } : null);
    if (edit.create) {
      edit.create = false;
      edit.tag = tag;
      history.replaceState(null, '', editHref(tag));
      renderEdit(tag);
    }
    if ($('history').children.length) loadHistory();
  } catch (e) {
    snack('网络出错了，请重试', { error: true });
  } finally {
    edit.saving = false;
    validate();
  }
}

for (const id of ['f-name', 'f-aliases']) $(id).addEventListener('input', () => (renderPreview(), validate()));
$('f-raw').addEventListener('input', () => (renderSuggest(), renderPreview(), validate()));
$('f-raw').addEventListener('blur', () => setTimeout(() => ($('raw-suggest').hidden = true), 200));
$('reset').addEventListener('click', () => {
  const c = edit.tag ? db.community.get(edit.tag) || null : null;
  fillForm(c);
  renderPreview();
  validate();
});
$('submit').addEventListener('click', submit);
$('load-history').addEventListener('click', loadHistory);
$('form').addEventListener('submit', (e) => e.preventDefault());

// ---- 渲染 ----
function render() {
  const path = location.pathname;
  // 数据没到之前先显示列表页的加载圈
  if (!db.rows.length) {
    $('view-list').hidden = false;
    $('view-edit').hidden = true;
    return;
  }
  if (path.startsWith('/edit/')) renderEdit(decodeURIComponent(path.slice(6)));
  else renderList();
}

const startParams = new URLSearchParams(location.search);
if (startParams.get('login_error')) {
  snack(startParams.get('login_error'), { error: true });
  startParams.delete('login_error');
  const q = startParams.toString();
  history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
}
renderUser();
render();
loadData().then(render, () => {
  $('table-msg').textContent = '词典载入失败，请刷新重试';
  $('table-msg').hidden = false;
  $('view-list').hidden = false;
});
`;

export function editorPage(env, nonce, user) {
  const repo = env.GH_REPO || 'TomorrowX6/NovelAI-CN';
  const cfg = {
    user,
    repo,
    branch: env.GH_BRANCH || 'main',
    path: env.DATA_PATH || 'data/zh-community.tsv',
    dictUrl: env.DICT_URL || '/zh-tags.tsv',
    icons: ICONS,
  };
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NovelAI Tag Editor</title>
<style>${STYLE}</style>
</head>
<body>
<header class="toolbar" role="heading" aria-level="1">
  <button id="back" class="icon-btn" type="button" aria-label="返回">${svg('arrow_back')}</button>
  <a class="title" href="/" data-link>NovelAI Tag Editor</a>
  <span class="spacer"></span>
  <div id="user" class="user"></div>
  <a class="github-corner" href="https://github.com/${escapeHtml(repo)}" target="_blank" rel="noopener" aria-label="在 GitHub 上查看">${CORNER}</a>
</header>
<article>
  <div id="view-list" class="page-box">
    <header>
      <label class="field search">
        <span class="field-label">${svg('search')}搜索</span>
        <input id="search" type="search" placeholder="string or /regex/" autocomplete="off" spellcheck="false">
        <span id="search-mode" class="suffix"></span>
      </label>
      <div id="chips" class="chips"></div>
      <span class="spacer"></span>
      <label class="field select-field">
        <span class="field-label">显示</span>
        <select id="scope"><option value="all">全部标签</option><option value="todo">未翻译</option><option value="community">社区修订</option></select>
      </label>
      <div class="paginator">
        <span>每页条数</span>
        <select id="page-size" aria-label="每页条数"><option>10</option><option>25</option><option>50</option><option>100</option></select>
        <span id="range" class="range"></span>
        <button id="prev" class="icon-btn" type="button" aria-label="上一页">${svg('chevron_left')}</button>
        <button id="next" class="icon-btn" type="button" aria-label="下一页">${svg('chevron_right')}</button>
      </div>
    </header>
    <section class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="handle"><a id="add" class="icon-btn accent" href="/edit/*new" data-link title="新增" aria-label="新增">${svg('add_circle')}</a></th>
            <th id="col-cat" data-sort="category">类别<span class="arrow"></span></th>
            <th data-sort="tag">原始标签<span class="arrow"></span></th>
            <th data-sort="name">名称<span class="arrow"></span></th>
            <th>检索词</th>
            <th data-sort="count" class="count">图片数<span class="arrow"></span></th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
      <div id="table-msg" class="spinner-box"><div class="spinner"></div></div>
    </section>
  </div>

  <div id="view-edit" class="page-box" hidden>
    <header>
      <span id="edit-title" class="headline">修改标签</span>
      <a class="icon-btn" href="https://github.com/${escapeHtml(repo)}#参与标签翻译" target="_blank" rel="noopener" title="查看参与翻译指南" aria-label="参与翻译指南">${svg('help')}</a>
      <span class="spacer"></span>
      <button id="reset" class="btn" type="button">重置</button>
      <button id="submit" class="btn primary" type="button" disabled>提交</button>
    </header>
    <p id="login-banner" class="banner" hidden>用 GitHub 登录后才能提交修改，提交会以你的名义记进仓库的历史。<a class="btn text login" href="/auth/login" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none">${svg('github')} 登录</a></p>
    <p id="delete-hint" class="banner warn" hidden>名称和检索词都清空了：提交后会删除这个标签的社区修订，恢复词典原来的译名。</p>
    <section class="edit-body">
      <form id="form" class="form-col" autocomplete="off">
        <div class="field">
          <span class="field-label">类别</span>
          <div id="f-category" style="padding:4px 0 6px;border-bottom:1px dotted rgba(0,0,0,.42);color:rgba(0,0,0,.38)"></div>
          <span class="field-hint">由 Danbooru 决定</span>
        </div>
        <div class="guide">
          <span>填写指南</span>
          <ul>
            <li>名称是联想里显示的中文，写最常用的叫法；有官方中文名的用官方译名。多个叫法用 / 分隔，第一个用来显示。</li>
            <li>检索词是用来搜到这个标签的其他说法（俗称、简称、旧译名），不显示。</li>
            <li>名称留空表示沿用词典译名，只追加检索词；名称和检索词都清空会删除这条社区修订。</li>
          </ul>
        </div>
        <label class="field">
          <span class="field-label">原始标签</span>
          <input id="f-raw" required spellcheck="false">
          <div id="raw-suggest" class="suggest" hidden></div>
          <span id="raw-note" class="field-hint"></span>
          <span class="field-error"></span>
        </label>
        <label class="field">
          <span class="field-label">名称</span>
          <input id="f-name" maxlength="60">
          <span class="field-hint">输入标签的中文翻译</span>
          <span class="field-error"></span>
        </label>
        <label class="field">
          <span class="field-label">检索词</span>
          <input id="f-aliases" placeholder="例如：兽耳娘/猫娘">
          <span class="field-hint">用这些词也能搜到这个标签，多个用 / 分隔，最多 8 个</span>
          <span class="field-error"></span>
        </label>
        <label class="field">
          <span class="field-label">修改说明</span>
          <textarea id="f-note" maxlength="200" rows="2"></textarea>
          <span class="field-hint">选填，写进提交记录</span>
          <span class="field-error"></span>
        </label>
      </form>
      <div class="preview-col">
        <div class="cards-row">
          <div class="card"><div class="card-label">原始标签</div><div id="p-raw"></div></div>
          <div class="card"><div class="card-label">名称</div><div id="p-name"></div><div id="p-dict" class="caption"></div></div>
        </div>
        <div class="card"><div class="card-label">检索词</div><div id="p-aliases"></div></div>
        <div class="card"><div class="card-label">Danbooru</div><div id="p-danbooru"></div></div>
        <div class="card">
          <div class="card-row"><span class="card-label">编辑日志</span><button id="load-history" class="btn text" type="button">加载</button></div>
          <ol id="history" class="history"></ol>
          <div class="caption"><a id="gh-history" target="_blank" rel="noopener">在 GitHub 查看全部提交</a></div>
        </div>
      </div>
    </section>
  </div>
</article>
<div id="snackbar" class="snackbar" role="status" hidden></div>
${config(cfg)}
<script nonce="${nonce}">${CLIENT}</script>
</body>
</html>`;
}
