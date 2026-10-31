// ---- 页面集成 ----
// NovelAI 对含汉字/假名的片段会带 lang=jp 请求 suggest-tags，响应 [{jp_tag, en_tag, power}]，
// 面板显示英文标签 + 本地语副标题，点击插入英文标签。这里把含汉字（无假名）的请求改由本地中文词典应答。

const MAX_RESULTS = 15;
const SUGGEST_PATH = '/ai/generate-image/suggest-tags';
const SUB_CLASS = 'nzh-sub';
// 同时装了两份脚本（比如升级时旧版没删）时，互相改对方的副标题会让 MutationObserver 无限触发
const INSTANCE = Math.random().toString(36).slice(2);
// 扩展面板的「中文标签」开关（extension/bridge.js 写入，改了会刷新页面）：关掉后不接管联想、不加中文释义和中文对照按钮、不拉社区译名
const TAGS_PREF_KEY = 'nzh-tags';
const tagsEnabled = (() => {
  try {
    return localStorage.getItem(TAGS_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
})();

let dict = null;
function getDict() {
  if (!dict) {
    dict = createZhDict(ZH_TAG_DATA, ZH_T2S_DATA);
    amendDict(dict);
    console.info(`[novelai-zh-tags] 已载入 ${dict.size} 条中文标签`);
  }
  return dict;
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const nativeFetch = window.fetch;

// jpMode 决定前端按哪种格式解析：lang=jp 时是 [{jp_tag, en_tag, power}]，否则是 {tags: [{tag, count}]}
async function suggestZh(query, jpMode, url, init) {
  let list = [];
  try {
    const ready = dict || await preloadDict();
    list = ready.search(query, MAX_RESULTS);
  } catch (e) {
    console.warn('[novelai-zh-tags]', e);
  }
  if (list.length === 0) {
    // 本地没有命中，用 NovelAI 自带的日文匹配查同一个片段，能翻译的副标题换成中文
    const u = new URL(url, location.href);
    u.searchParams.set('prompt', query);
    u.searchParams.set('lang', 'jp');
    const res = await nativeFetch.call(window, u.href, init);
    if (!res.ok) return res;
    // 同一个英文标签常对应多个日文写法，换成中文后会重复，只留第一个
    const seen = new Set();
    for (const x of await res.json()) {
      if (seen.has(x.en_tag)) continue;
      seen.add(x.en_tag);
      list.push({ tag: x.en_tag, zh: getDict().lookup(x.en_tag) || x.jp_tag, count: x.power });
    }
  }
  return jsonResponse(
    jpMode
      ? list.map((r) => ({ jp_tag: r.zh, en_tag: r.tag, power: Math.min(r.count, 10000) }))
      : { tags: list.map((r) => ({ tag: r.tag, count: Math.min(r.count, 10000), confidence: 1 })) },
  );
}

// NovelAI 在 handleTextInput 里用「光标前的旧文本 + 新输入」拼查询串，没扣掉被替换的范围。
// 微软拼音这类把拼音写进编辑器的输入法上屏时，查询会变成 luo'li萝莉，所以直接取光标前的实际文本。
function fragmentBeforeCaret() {
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed || !promptEditorOf(sel.anchorNode)) return null;
  const node = sel.anchorNode;
  const block = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement).closest('p');
  if (!block) return null;
  const range = document.createRange();
  range.setStart(block, 0);
  range.setEnd(node, sel.anchorOffset);
  // 与 NovelAI 取片段的分隔符一致
  return (range.toString().split(/[#,[{|、]|\. |::/).pop() || '').trim();
}

// 组字过程中编辑器里是拼音，这时的联想没有意义，挂起到上屏后再按实际文本回答
let composing = false;
let compositionWaiters = [];
const compositionDone = () => (composing ? new Promise((resolve) => compositionWaiters.push(resolve)) : null);

async function handleSuggest(url, init, nativeRequest) {
  await compositionDone();
  const params = new URL(url, location.href).searchParams;
  const param = params.get('prompt') || '';
  const live = fragmentBeforeCaret();
  // 光标不在提示词框里（拿不到实际文本）时按原参数处理
  const query = live ?? param;
  if (query.length < 2) {
    // 挂起期间片段可能已被清空；请求失败时前端会关闭面板，与它对短片段的处理一致
    throw new Error('[novelai-zh-tags] 片段过短');
  }
  if (HAN_RE.test(query) && !KANA_RE.test(query)) {
    return suggestZh(query, params.get('lang') === 'jp', url, init);
  }
  if (query === param) return nativeRequest();
  const u = new URL(url, location.href);
  u.searchParams.set('prompt', query);
  return nativeFetch.call(window, u.href, init);
}

window.fetch = function (...args) {
  try {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : null;
    if (tagsEnabled && url && url.includes(SUGGEST_PATH)) {
      return handleSuggest(url, init, () => nativeFetch.apply(this, args));
    }
    const ui = url && uiSettingsFetch(url, init, () => nativeFetch.apply(this, args));
    if (ui) return ui;
  } catch (e) {
    console.warn('[novelai-zh-tags]', e);
  }
  return nativeFetch.apply(this, args);
};

// 英文联想项只有英文标签，补一行与原生副标题同样式的中文释义
const panels = document.getElementsByClassName('image-prompt-suggestions');

function annotatePanel(panel) {
  if (!dict) {
    preloadDict();
    return;
  }
  // 原生英文标签 span 没有 style；原生副标题和本脚本的副标题都有 style
  for (const enSpan of panel.querySelectorAll('span:not([style])')) {
    const item = enSpan.parentElement && enSpan.parentElement.parentElement;
    if (!item || item === panel || !panel.contains(item)) continue;
    let native = null;
    let mine = null;
    for (const c of item.children) {
      if (c.tagName !== 'SPAN') continue;
      if (c.classList.contains(SUB_CLASS) && c.dataset.nzh === INSTANCE) mine = c;
      else native = c;
    }
    // 没有通用中文名的标签（如 ^_^、部分作品名）译名就是原文，不重复显示
    let zh = native ? null : getDict().lookup(enSpan.textContent);
    if (zh && !HAN_RE.test(zh)) zh = null;
    if (!zh) {
      if (mine) mine.remove();
      continue;
    }
    if (!mine) {
      mine = document.createElement('span');
      mine.className = SUB_CLASS;
      mine.dataset.nzh = INSTANCE;
      mine.style.cssText = 'font-size:0.8rem;opacity:0.7';
      item.appendChild(mine);
    }
    if (mine.textContent !== zh) mine.textContent = zh;
  }
}

if (tagsEnabled) {
  document.addEventListener('nzh-dictionary', () => {
    for (const panel of panels) annotatePanel(panel);
  });
  new MutationObserver(() => {
    for (const panel of panels) annotatePanel(panel);
  }).observe(document, { childList: true, subtree: true });
}

// NovelAI 只认半角逗号和顿号作标签分隔，中文输入法的全角逗号会让整段被当成一个标签，
// 点选联想时前面的内容也会被替换掉；权重写法 1.2::标签:: 也只认半角冒号。
// 所以在生图提示词框里把「，」转成 ", "、「：」转成 ":"
const FULLWIDTH_RE = /[，：]/;
const toHalfwidth = (s) => s.replace(/，\s*/g, ', ').replace(/：/g, ':');

function promptEditorOf(node) {
  const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  const editor = el && el.closest('.ProseMirror');
  return editor && editor.closest('[data-prompt-input]') ? editor : null;
}

document.addEventListener(
  'beforeinput',
  (e) => {
    if (e.defaultPrevented || e.inputType !== 'insertText' || !e.data || !FULLWIDTH_RE.test(e.data)) return;
    if (!promptEditorOf(e.target)) return;
    e.preventDefault();
    document.execCommand('insertText', false, toHalfwidth(e.data));
  },
  true,
);

// 输入法上屏（composition）的输入不能在 beforeinput 里取消，等上屏后再替换光标前刚上屏的文本
function replaceCommittedText(text) {
  const sel = getSelection();
  const node = sel.anchorNode;
  if (!sel.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !promptEditorOf(node)) return;
  const end = sel.anchorOffset;
  // 光标前一般就是刚上屏的整段文本；对不上时只看光标前一个字
  const start = node.data.slice(end - text.length, end) === text ? end - text.length : end - 1;
  if (start < 0) return;
  const committed = node.data.slice(start, end);
  if (!FULLWIDTH_RE.test(committed)) return;
  sel.setBaseAndExtent(node, start, node, end);
  document.execCommand('insertText', false, toHalfwidth(committed));
}

document.addEventListener(
  'compositionstart',
  (e) => {
    if (promptEditorOf(e.target)) composing = true;
  },
  true,
);

document.addEventListener(
  'compositionend',
  (e) => {
    if (!composing) return;
    composing = false;
    const waiters = compositionWaiters;
    compositionWaiters = [];
    // 等上屏文本写入 DOM 后再处理；先换全角标点，挂起的联想再按换完的文本回答
    setTimeout(() => {
      if (e.data && FULLWIDTH_RE.test(e.data)) replaceCommittedText(e.data);
      for (const resolve of waiters) resolve();
    }, 0);
  },
  true,
);

// 空闲时预先解析词典，避免第一次联想卡顿。只在生图页做，写小说等页面用不到；
// NovelAI 是单页应用，从其他页面切到生图页时，在提示词框获得焦点时再解析
let dictPreload = null;
function preloadDict() {
  if (dict) return Promise.resolve(dict);
  if (dictPreload) return dictPreload;
  dictPreload = new Promise((resolve) => (window.requestIdleCallback || setTimeout)(resolve))
    .then(() => dict || createZhDictAsync(ZH_TAG_DATA, ZH_T2S_DATA))
    .then((loaded) => {
      // 用户先触发了同步查词时，保留已经使用、可能已更新的那份词典。
      if (!dict) {
        dict = loaded;
        amendDict(dict);
      }
      document.dispatchEvent(new Event('nzh-dictionary'));
      return dict;
    })
    .catch((e) => { console.warn('[novelai-zh-tags] 预载词典失败', e); })
    .finally(() => { dictPreload = null; });
  return dictPreload;
}
if (tagsEnabled) {
  window.addEventListener('load', () => {
    if (location.pathname.startsWith('/image')) preloadDict();
  });
  document.addEventListener(
    'focusin',
    (e) => {
      if (!dict && promptEditorOf(e.target)) preloadDict();
    },
    true,
  );
}
