// Settings and community translations live in NovelAI localStorage, accessed via bridge.js.
// Without a connected page, setting changes wait in extension storage until bridge.js applies them.
// scripts/crx.mjs replaces this line when packaging the extension.
const BUILD = { version: 'dev', hash: '', tags: 0, ui: 0, hard: 0, communityUrl: '' };

// Firefox for Android opens the popup as a full page, so it follows the screen width instead of the desktop panel's.
if (/Android/.test(navigator.userAgent)) document.documentElement.classList.add('mobile');

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('zh-CN');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let tabId = null;
let current = null;
// The setting being saved, or 'refresh' while community translations download.
let pending = null;
const DEFAULTS = { ui: false, tags: true, compare: false, auto: true, hours: 24 };
// Last settings seen by bridge.js plus changes made while no page was connected.
let offline = { ...DEFAULTS };

function notice(text, kind) {
  const n = $('notice');
  n.hidden = !text;
  n.textContent = text || '';
  n.className = 'notice' + (kind ? ' ' + kind : '');
}

async function loadOffline() {
  try {
    const { settings, queued } = await chrome.storage.local.get(['settings', 'queued']);
    offline = { ...DEFAULTS, ...settings, ...queued };
  } catch {}
}

async function query() {
  try {
    return tabId == null ? null : await chrome.tabs.sendMessage(tabId, { type: 'nzh-get' });
  } catch {
    return null;
  }
}

function controls() {
  const prefs = current || offline;
  const busy = !!pending;
  $('ui').disabled = $('tags').disabled = busy;
  // The tag reference is part of the Chinese tags feature.
  $('compare').disabled = busy || !prefs.tags;
  $('auto').disabled = busy || !BUILD.communityUrl || !prefs.tags;
  $('hours').disabled = $('auto').disabled || !prefs.auto;
  $('refresh').disabled = busy || !current || !BUILD.communityUrl || !current.tags;
  $('refresh').setAttribute('aria-busy', String(busy));
  $('refresh-label').textContent = pending === 'refresh' ? '正在更新社区译名…' : busy ? '正在刷新页面…' : '更新社区译名';
}

function render(s) {
  current = s;
  controls();
  const prefs = s || offline;
  $('ui').checked = !!prefs.ui;
  $('tags').checked = !!prefs.tags;
  $('compare').checked = !!prefs.compare;
  $('auto').checked = !!prefs.auto;
  $('hours').value = String(prefs.hours || DEFAULTS.hours);
  $('connection').dataset.state = s ? 'connected' : 'disconnected';
  $('connection-text').textContent = s ? '已连接 NovelAI' : '未连接 NovelAI 页面';
  const c = s?.community;
  $('n-community').textContent = c ? fmt(c.count) : '—';
  $('community-hash').textContent = c?.hash || '—';
  $('community-time').textContent = c?.time ? new Date(c.time).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—';
  notice('');
  if (!s) {
    $('community-meta').textContent = '';
    return;
  }
  // Settings changed while this page was open (from the popup elsewhere or another tab) apply after a reload.
  if (s.stale) notice('设置已更改，刷新 NovelAI 页面后生效。');
  if (!BUILD.communityUrl) {
    $('n-community').textContent = '—';
    $('community-meta').textContent = '此版本未启用社区译名';
  } else if (!s.tags) {
    $('community-meta').textContent = '开启「中文标签」后可更新';
  } else if (c?.failed) {
    $('community-meta').textContent = '上次更新失败，已保留本地译名';
  } else if (!c?.time && s.auto) {
    $('community-meta').textContent = '等待页面自动获取，也可手动更新';
  } else {
    $('community-meta').textContent = '';
  }
}

async function queue(key, value) {
  pending = key;
  controls();
  let ok = true;
  try {
    const { queued } = await chrome.storage.local.get('queued');
    await chrome.storage.local.set({ queued: { ...queued, [key]: value } });
    offline = { ...offline, [key]: value };
  } catch {
    ok = false;
  }
  pending = null;
  render(null);
  notice(ok ? '已保存，刷新或打开 NovelAI 页面后生效。' : '设置未保存，请重试。', ok ? 'ok' : 'err');
}

async function reconnect(key, value) {
  let next = null;
  for (let i = 0; i < 20; i++) {
    await sleep(i === 0 ? 2000 : 1000);
    next = await query();
    if (next && !next.stale && next[key] === value) break;
  }
  if (!next) {
    await loadOffline();
    offline = { ...offline, [key]: value };
  }
  pending = null;
  render(next);
  if (!next) notice('设置已保存，暂未恢复与页面的连接。请稍后重新打开面板。', 'err');
  else if (next.stale || next[key] !== value) notice('设置已保存，页面尚未完成刷新，请稍后重试。', 'err');
}

// The page script downloads community translations in place and stamps a new time when done, whether or not it succeeded.
// On Firefox for Android the page sits in the background behind the popup and can be slow, so keep checking for a while.
async function refreshed(previousTime) {
  notice('正在获取社区译名…');
  let next = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    next = await query();
    if (!next || (next.community?.time || 0) > previousTime) break;
  }
  if (!next) await loadOffline();
  pending = null;
  render(next);
  // The cleared time stays saved, so the page downloads again the next time it loads.
  if (!next) notice('与页面的连接已断开，下次打开 NovelAI 时会继续更新。', 'err');
  else if ((next.community?.time || 0) <= previousTime) notice('尚未取得新数据，请稍后重试。', 'err');
  else if (next.community.failed) notice('更新失败，已保留本地译名。请稍后重试。', 'err');
  else notice('社区译名已更新', 'ok');
}

async function set(key, value) {
  if (pending) return;
  if (!current) return queue(key, value);
  const previousTime = current.community?.time || 0;
  pending = key;
  controls();
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'nzh-set', key, value });
    if (!r?.ok) throw new Error('Setting rejected');
    if (key === 'refresh') {
      refreshed(previousTime);
      return;
    }
    if (key === 'compare') {
      // The page script switches the tag reference in place, so the page does not reload.
      pending = null;
      render((await query()) || { ...current, compare: value });
      notice(value ? '中文对照已打开' : '中文对照已关闭', 'ok');
      return;
    }
    $('connection').dataset.state = 'loading';
    $('connection-text').textContent = '正在刷新 NovelAI 页面';
    notice('设置已保存，正在刷新页面…');
    reconnect(key, value);
  } catch {
    pending = null;
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
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('settings-panel').hidden) showSettings(false);
});
$('ui').addEventListener('change', (e) => set('ui', e.target.checked));
$('tags').addEventListener('change', (e) => set('tags', e.target.checked));
$('compare').addEventListener('change', (e) => set('compare', e.target.checked));
$('auto').addEventListener('change', (e) => set('auto', e.target.checked));
// Arrow keys on a closed <select> fire change at every step, so keyboard choices are saved once they settle.
let hoursKeyAt = 0;
let hoursTimer = null;
function saveHours() {
  clearTimeout(hoursTimer);
  hoursTimer = null;
  return set('hours', Number($('hours').value));
}
$('hours').addEventListener('keydown', () => { hoursKeyAt = Date.now(); });
$('hours').addEventListener('change', () => {
  clearTimeout(hoursTimer);
  if (Date.now() - hoursKeyAt < 100) hoursTimer = setTimeout(saveHours, 800);
  else return saveHours();
});
$('hours').addEventListener('blur', () => hoursTimer && saveHours());
$('refresh').addEventListener('click', () => set('refresh', true));

async function init() {
  let s = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    s = await query();
  } catch {}
  if (!s) await loadOffline();
  render(s);
  requestAnimationFrame(() => document.body.classList.add('ready'));
}
init();
