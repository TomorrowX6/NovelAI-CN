// 扩展面板（popup.html）和 NovelAI 页面之间的桥。运行在内容脚本的隔离环境里，
// 和页面里的脚本共用 novelai.net 的 localStorage：面板来读状态、改设置，改完刷新页面，
// 让 document_start 注入的脚本按新设置重新运行。
const KEYS = { ui: 'nzh-ui-lang', tags: 'nzh-tags', community: 'nzh-community' };

function readCommunity() {
  try {
    const c = JSON.parse(localStorage.getItem(KEYS.community) || 'null');
    return c && Array.isArray(c.entries) ? c : null;
  } catch {
    return null;
  }
}

async function shortHash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf, 0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function state() {
  const c = readCommunity();
  return {
    ui: localStorage.getItem(KEYS.ui) === 'zh',
    tags: localStorage.getItem(KEYS.tags) !== 'off',
    community: c && { count: c.entries.length, time: c.time || 0, hash: await shortHash(JSON.stringify(c.entries)) },
  };
}

function set(key, value) {
  if (key === 'ui') {
    if (value) localStorage.setItem(KEYS.ui, 'zh');
    else localStorage.removeItem(KEYS.ui);
  } else if (key === 'tags') {
    if (value) localStorage.removeItem(KEYS.tags);
    else localStorage.setItem(KEYS.tags, 'off');
  } else if (key === 'refresh') {
    // 把上次拉取的时间清零，页面刷新后就会重新拉社区译名
    const c = readCommunity();
    if (c) localStorage.setItem(KEYS.community, JSON.stringify({ ...c, time: 0 }));
  } else {
    return false;
  }
  setTimeout(() => location.reload(), 50);
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg) return;
  if (msg.type === 'nzh-get') {
    state().then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.type === 'nzh-set') sendResponse({ ok: set(msg.key, !!msg.value) });
});
