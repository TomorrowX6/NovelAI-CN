// 扩展面板：版本、构建哈希、词条数，以及「中文界面」「中文标签」两个开关。
// 开关和社区译名的状态存在 NovelAI 页面的 localStorage 里，通过 bridge.js 读写，所以要在 NovelAI 的标签页上打开。
// 下面这行由 scripts/crx.mjs 打包时填入
const BUILD = { version: 'dev', hash: '', tags: 0, ui: 0, hard: 0, communityUrl: '' };

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('zh-CN');
let tabId = null;

function notice(text, kind) {
  const n = $('notice');
  n.hidden = !text;
  n.textContent = text || '';
  n.className = 'notice' + (kind ? ' ' + kind : '');
}

async function query() {
  try {
    return tabId == null ? null : await chrome.tabs.sendMessage(tabId, { type: 'nzh-get' });
  } catch {
    return null;
  }
}

function render(s) {
  for (const id of ['ui', 'tags', 'refresh']) $(id).disabled = !s;
  if (!s) {
    notice('在 NovelAI 页面上打开这里才能切换。刚装好或更新过扩展的话，先刷新一下 NovelAI 页面。');
    return;
  }
  notice('');
  $('ui').checked = s.ui;
  $('tags').checked = s.tags;
  const c = s.community;
  $('refresh').disabled = !BUILD.communityUrl || !s.tags;
  if (!BUILD.communityUrl) {
    $('n-community').textContent = '未启用';
  } else if (!s.tags) {
    $('n-community').textContent = c ? fmt(c.count) : '—';
    $('community-meta').textContent = '中文标签关闭时不更新';
  } else if (!c) {
    $('n-community').textContent = '—';
    $('community-meta').textContent = '还没有拉取，页面加载几秒后自动拉取';
  } else {
    $('n-community').textContent = fmt(c.count);
    const time = c.time ? new Date(c.time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '等待更新';
    $('community-meta').textContent = '更新于 ' + time + ' · #' + c.hash;
  }
}

async function set(key, value) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'nzh-set', key, value });
    if (!r || !r.ok) throw new Error();
    notice(key === 'refresh' ? '正在刷新页面并重新拉取社区译名…' : '已切换，NovelAI 页面正在刷新', 'ok');
  } catch {
    notice('切换失败，请刷新 NovelAI 页面后再试', 'err');
  }
}

$('version').textContent = 'v' + BUILD.version;
$('hash').textContent = BUILD.hash || '开发版';
$('n-tags').textContent = fmt(BUILD.tags);
$('n-ui').textContent = fmt(BUILD.ui);
$('n-hard').textContent = fmt(BUILD.hard);
if (BUILD.communityUrl) $('contribute').href = BUILD.communityUrl;
else $('contribute').hidden = true;

$('ui').addEventListener('change', (e) => set('ui', e.target.checked));
$('tags').addEventListener('change', (e) => set('tags', e.target.checked));
$('refresh').addEventListener('click', async () => {
  await set('refresh', true);
  // 页面加载完 3 秒后才拉取，等一会儿再读
  setTimeout(async () => render(await query()), 8000);
});

chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  tabId = tab ? tab.id : null;
  render(await query());
  requestAnimationFrame(() => document.body.classList.add('ready'));
});
