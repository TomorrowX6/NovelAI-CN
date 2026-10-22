// Settings and community translations live in NovelAI localStorage, accessed via bridge.js.
// scripts/crx.mjs replaces this line when packaging the extension.
const BUILD = { version: 'dev', hash: '', tags: 0, ui: 0, hard: 0, communityUrl: '' };

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('zh-CN');
let tabId = null;
let current = null;
let pending = false;

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

function controls() {
  $('ui').disabled = $('tags').disabled = pending || !current;
  $('refresh').disabled = pending || !current || !BUILD.communityUrl || !current.tags;
  $('refresh').setAttribute('aria-busy', String(pending));
  $('refresh-label').textContent = pending ? '正在刷新页面…' : '更新社区译名';
}

function render(s) {
  current = s;
  controls();
  $('ui').checked = !!s?.ui;
  $('tags').checked = !!s?.tags;
  $('open-novelai').hidden = !!s;
  $('connection').dataset.state = s ? 'connected' : 'disconnected';
  $('connection-text').textContent = s ? '已连接 NovelAI' : '未连接 NovelAI 页面';
  const c = s?.community;
  $('n-community').textContent = c ? fmt(c.count) : '—';
  $('community-hash').textContent = c?.hash || '—';
  $('community-time').textContent = c?.time ? new Date(c.time).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—';
  if (!s) {
    $('community-meta').textContent = '连接页面后可更新社区译名';
    notice('请在 NovelAI 页面打开；已打开时请刷新。');
    return;
  }
  notice('');
  if (!BUILD.communityUrl) {
    $('n-community').textContent = '—';
    $('community-meta').textContent = '此版本未启用社区译名';
  } else if (!s.tags) {
    $('community-meta').textContent = '开启「中文标签」后可更新';
  } else if (c?.failed) {
    $('community-meta').textContent = '上次更新失败，已保留本地译名';
  } else if (!c?.time) {
    $('community-meta').textContent = '等待页面自动获取，也可手动更新';
  } else {
    $('community-meta').textContent = '每 3 小时自动检查更新';
  }
}

async function set(key, value) {
  if (pending || !current) return;
  const previousTime = current.community?.time || 0;
  pending = true;
  controls();
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'nzh-set', key, value });
    if (!r?.ok) throw new Error('Setting rejected');
    $('connection').dataset.state = 'loading';
    $('connection-text').textContent = '正在刷新 NovelAI 页面';
    notice(key === 'refresh' ? '正在重新获取社区译名…' : '设置已保存，正在刷新页面…');
    // Community data starts downloading three seconds after the page loads.
    setTimeout(async () => {
      const next = await query();
      pending = false;
      render(next);
      if (next && key === 'refresh') {
        if (next.community?.failed) notice('更新失败，已保留本地译名。请稍后重试。', 'err');
        else if ((next.community?.time || 0) > previousTime) notice('社区译名已更新', 'ok');
        else notice('尚未取得新数据，请稍后重试。', 'err');
      }
    }, key === 'refresh' ? 8000 : 2000);
  } catch {
    pending = false;
    render(current);
    notice(key === 'refresh' ? '更新失败，请刷新 NovelAI 页面后重试。' : '设置未保存，请刷新 NovelAI 页面后重试。', 'err');
  }
}

function showSettings(show) {
  $('main-panel').hidden = show;
  $('settings-panel').hidden = !show;
  $('settings-open').setAttribute('aria-expanded', String(show));
  $(show ? 'settings-close' : 'settings-open').focus();
}

$('version').textContent = 'v' + BUILD.version;
$('version').title = '内容脚本构建 ' + (BUILD.hash || '开发版');
$('n-tags').textContent = fmt(BUILD.tags);
$('n-ui').textContent = fmt(BUILD.ui);
$('n-hard').textContent = fmt(BUILD.hard);
if (BUILD.communityUrl) $('contribute').href = BUILD.communityUrl;
else $('contribute').hidden = true;

$('settings-open').addEventListener('click', () => showSettings(true));
$('settings-close').addEventListener('click', () => showSettings(false));
$('settings-done').addEventListener('click', () => showSettings(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('settings-panel').hidden) showSettings(false);
});
$('ui').addEventListener('change', (e) => set('ui', e.target.checked));
$('tags').addEventListener('change', (e) => set('tags', e.target.checked));
$('refresh').addEventListener('click', () => set('refresh', true));

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    render(await query());
  } catch {
    render(null);
  }
  requestAnimationFrame(() => document.body.classList.add('ready'));
}
init();
