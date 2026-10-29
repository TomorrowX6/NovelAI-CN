// 扩展面板（popup.html）和 NovelAI 页面之间的桥。运行在内容脚本的隔离环境里，
// 和页面里的脚本共用 novelai.net 的 localStorage：面板来读状态、改设置，改完刷新页面，
// 让 document_start 注入的脚本按新设置重新运行（中文对照例外，页面脚本当场切换）。
// 面板没连上页面时把改动存进扩展的 storage（queued），这里写进 localStorage：页面刚打开时随即刷新，
// 已经开着的页面等用户自己刷新。当前设置也存一份（settings），面板没连上页面时照着显示。
const KEYS = {
  ui: 'nzh-ui-lang', uiForce: 'nzh-ui-force', tags: 'nzh-tags', compare: 'nzh-tag-compare',
  auto: 'nzh-community-auto', hours: 'nzh-community-hours', community: 'nzh-community',
  // NovelAI 没登录时自己存设置（含界面语言 uiLanguage）的地方，不经过账号接口，src/ui.js 改不到
  noAccount: 'noAccountSettings',
};
// 自动更新的检查间隔（小时），可选的几档和默认值与 src/community.js 的 COMMUNITY_HOURS 一致
const validHours = (h) => [1, 6, 12, 24, 168].includes(h);

function readHours() {
  const h = Number(localStorage.getItem(KEYS.hours));
  return validHours(h) ? h : 24;
}

function readCommunity() {
  try {
    const c = JSON.parse(localStorage.getItem(KEYS.community) || 'null');
    return c && Array.isArray(c.entries) ? c : null;
  } catch {
    return null;
  }
}

function readNoAccount() {
  try {
    const s = JSON.parse(localStorage.getItem(KEYS.noAccount) || 'null');
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
  } catch {
    return null;
  }
}

// 和 NovelAI 一样，会话在 sessionStorage 或 localStorage 里就是登录了
function loggedIn() {
  try {
    return !!(sessionStorage.getItem('session') || localStorage.getItem('session'));
  } catch {
    return false;
  }
}

// 没登录时页面按 noAccountSettings 里的界面语言显示，面板也照它显示开关
function uiOn() {
  const s = !loggedIn() && readNoAccount();
  return s && s.uiLanguage ? s.uiLanguage === 'zh' : localStorage.getItem(KEYS.ui) === 'zh';
}

async function shortHash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf, 0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function settings() {
  return {
    ui: uiOn(),
    tags: localStorage.getItem(KEYS.tags) !== 'off',
    compare: localStorage.getItem(KEYS.compare) === 'on',
    auto: localStorage.getItem(KEYS.auto) !== 'off',
    hours: readHours(),
  };
}

async function state() {
  const c = readCommunity();
  return {
    ...settings(),
    stale: stale(),
    community: c && { count: c.entries.length, time: c.time || 0, hash: await shortHash(JSON.stringify(c.entries)), failed: c.failed === true },
  };
}

function write(key, value) {
  if (key === 'ui') {
    // 强制标记让账号语言是日文时也显示中文（src/ui.js 的 UI_FORCE_KEY）
    if (value) {
      localStorage.setItem(KEYS.ui, 'zh');
      localStorage.setItem(KEYS.uiForce, '1');
    } else {
      localStorage.removeItem(KEYS.ui);
      localStorage.removeItem(KEYS.uiForce);
    }
    // 没登录时 NovelAI 用自己存的界面语言，上面两个标记只管登录后和第一次打开，这里一起改掉：
    // 打开时换成中文，关掉时中文换回英文（日文保持不变）
    const s = readNoAccount();
    if (s && (value || s.uiLanguage === 'zh')) localStorage.setItem(KEYS.noAccount, JSON.stringify({ ...s, uiLanguage: value ? 'zh' : 'en' }));
  } else if (key === 'tags') {
    if (value) localStorage.removeItem(KEYS.tags);
    else localStorage.setItem(KEYS.tags, 'off');
  } else if (key === 'compare') {
    if (value) localStorage.setItem(KEYS.compare, 'on');
    else localStorage.removeItem(KEYS.compare);
    // 页面脚本（src/compare.js）收到后当场切换；同一个页面里改 localStorage 不会触发 storage 事件
    document.dispatchEvent(new Event('nzh-compare'));
  } else if (key === 'auto') {
    if (value) localStorage.removeItem(KEYS.auto);
    else localStorage.setItem(KEYS.auto, 'off');
  } else if (key === 'hours') {
    if (!validHours(value)) return false;
    localStorage.setItem(KEYS.hours, String(value));
  } else if (key === 'refresh') {
    // 把上次拉取的时间清零，页面刷新后就会重新拉社区译名（自动更新关着也拉，src/community.js）
    const c = readCommunity() || { entries: [] };
    localStorage.setItem(KEYS.community, JSON.stringify({ ...c, time: 0, failed: false }));
  } else {
    return false;
  }
  return true;
}

function set(key, value) {
  if (!write(key, value)) return false;
  if (key !== 'compare') setTimeout(() => location.reload(), 50);
  return true;
}

// 页面脚本在 document_start 读到的设置。localStorage 和它不一样时（别的标签页或面板改过），页面刷新后才用上新设置。
// 中文对照随时生效（页面上的「中」按钮也会改它），不算在内
const reloadSettings = () => {
  const { compare, ...s } = settings();
  return JSON.stringify(s);
};
let loaded = null;
try {
  loaded = reloadSettings();
} catch {}
const stale = () => reloadSettings() !== loaded;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg) return;
  if (msg.type === 'nzh-get') {
    state().then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.type === 'nzh-set') sendResponse({ ok: set(msg.key, msg.key === 'hours' ? msg.value : !!msg.value) });
});

// 给没连上页面时的面板存一份当前设置，有变化才写
async function remember() {
  const now = settings();
  const { settings: saved } = await chrome.storage.local.get('settings');
  if (JSON.stringify(saved) !== JSON.stringify(now)) await chrome.storage.local.set({ settings: now });
}

// 面板没连上页面时存下的改动，写进 localStorage。页面刚打开时顺手刷新一次；
// 已经开着的页面不自动刷新（可能正在生成图片），面板连上它时会提示刷新后生效
async function apply(queued, reload) {
  if (!queued || typeof queued !== 'object') return;
  // 先删掉，写入出错也不会每次打开页面都刷新
  await chrome.storage.local.remove('queued');
  for (const [key, value] of Object.entries(queued)) write(key, value);
  if (reload && stale()) location.reload();
}

// 放在消息监听之后：扩展存储不可用时不影响面板连接页面
try {
  chrome.storage.local.get('queued').then(({ queued }) => apply(queued, true)).then(remember).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.queued?.newValue) apply(changes.queued.newValue, false).then(remember).catch(() => {});
  });
  // 页面自己也会改设置（NovelAI 的语言选单，src/ui.js），切到别的标签页时再存一次
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) remember().catch(() => {});
  });
} catch {}
