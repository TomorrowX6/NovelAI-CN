// ---- 标签中文对照 ----
// 每个提示词框（基础提示词、负面提示词、角色提示词）的标题栏多一个「中」按钮。打开后在框下面列出框里的每个标签和它的中文，
// 没有中文的标签暗着显示，常见的拼写错误（worth quality）用橙色标出「拼错？」和正确写法的中文；点一项就在提示词里选中这个标签。开关对所有提示词框生效，记在 localStorage 里，
// 扩展面板的「中文对照」开关改的是同一个值（extension/bridge.js），改了当场生效、不刷新页面。
// 只在框外面加元素，不改编辑器（ProseMirror）里的内容。

const COMPARE_PREF_KEY = 'nzh-tag-compare';
const CMP_BTN = 'nzh-cmp-btn';
const CMP_PANEL = 'nzh-cmp';
// 自然语言写的长句截短显示，鼠标停留时看全文
const CMP_MAX_TEXT = 40;
const CMP_CSS = `
.${CMP_BTN}{margin-left:auto;padding:5px 6px;border:0;border-radius:4px;background:none;color:inherit;font:700 15px/20px sans-serif;cursor:pointer;opacity:.5}
.${CMP_BTN}:not(:last-child){margin-right:6px}
.${CMP_BTN}:hover{opacity:.8}
.${CMP_BTN}[aria-pressed=true]{opacity:1;background:rgba(127,127,127,.25)}
.${CMP_PANEL}{display:flex;flex-wrap:wrap;gap:4px;max-height:180px;overflow-y:auto;padding:6px 12px 10px}
.${CMP_PANEL}[hidden]{display:none}
.${CMP_PANEL} button{display:inline-flex;flex-direction:column;align-items:flex-start;max-width:100%;padding:3px 7px;border:0;border-radius:4px;background:rgba(127,127,127,.15);color:inherit;font:inherit;text-align:left;cursor:pointer}
.${CMP_PANEL} button:hover{background:rgba(127,127,127,.3)}
.${CMP_PANEL} .nzh-cmp-zh{font-size:.85rem;line-height:1.25}
.${CMP_PANEL} .nzh-cmp-en{max-width:100%;overflow:hidden;font-size:.7rem;line-height:1.2;white-space:nowrap;text-overflow:ellipsis;opacity:.6}
.${CMP_PANEL} .nzh-cmp-none{opacity:.55}
.${CMP_PANEL} .nzh-cmp-typo .nzh-cmp-zh{color:#e0913a}
`;

function readComparePref() {
  try {
    return localStorage.getItem(COMPARE_PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

let compareOn = readComparePref();

function setCompare(on) {
  compareOn = on;
  try {
    if (on) localStorage.setItem(COMPARE_PREF_KEY, 'on');
    else localStorage.removeItem(COMPARE_PREF_KEY);
  } catch {}
  updateCompare();
}

// 提示词框上方的标题栏：基础、负面提示词是框的前一个元素；角色提示词的框外面还包了两层，同一层的另一个是负面提示词的框
function promptHeaderOf(box) {
  for (let el = box, i = 0; el && i < 4; el = el.parentElement, i++) {
    const prev = el.previousElementSibling;
    if (prev && prev.classList.contains(CMP_PANEL)) return null;
    if (prev && !prev.querySelector('[data-prompt-input]')) return prev;
  }
  return null;
}

// 标题栏是两端对齐的 flex：放在右边那组图标的前面，只有一组标签页时放在最后
function ensureCompareButton(header) {
  let btn = header.querySelector(`.${CMP_BTN}`);
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = CMP_BTN;
    btn.textContent = '中';
    btn.title = '中文对照：在提示词框下面列出每个标签的中文';
    btn.setAttribute('aria-label', '标签中文对照');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setCompare(!compareOn);
    });
    if (header.children.length > 1) header.insertBefore(btn, header.lastElementChild);
    else header.appendChild(btn);
  }
  const pressed = String(compareOn);
  if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
}

function createComparePanel(box, editor) {
  const panel = document.createElement('div');
  panel.className = CMP_PANEL;
  panel.dataset.nzh = INSTANCE;
  panel.translate = false;
  // 框的底色画在编辑器的外层上，面板用同样的底色，和框连成一块（跟着主题变）
  for (let el = editor; el && el !== box.parentElement; el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(bg)) {
      panel.style.backgroundColor = bg;
      break;
    }
  }
  // 不抢编辑器的焦点
  panel.addEventListener('mousedown', (e) => e.preventDefault());
  panel.addEventListener('click', (e) => {
    const item = e.target.closest('button');
    const editor = item && panel.previousElementSibling?.querySelector('.ProseMirror');
    if (editor) selectInEditor(editor, +item.dataset.para, +item.dataset.start, +item.dataset.end);
  });
  return panel;
}

// 编辑器每段（<p>）的纯文本；高亮权重的 <span> 不影响文本和位置
const editorParagraphs = (editor) => [...editor.children].map((p) => p.textContent);
const plainName = (s) => s.toLowerCase().replace(/[\s_\-!.:'’]+/g, '');

function renderComparePanel(panel, editor) {
  const paras = editorParagraphs(editor);
  const key = paras.join('\n');
  if (panel.nzhKey === key) return;
  panel.nzhKey = key;
  const seen = new Set();
  const items = [];
  paras.forEach((text, para) => {
    for (const t of promptTags(text)) {
      const id = t.text.toLowerCase().replace(/_/g, ' ');
      if (seen.has(id)) continue;
      seen.add(id);
      const zh = getDict().lookup(t.tag);
      let typo;
      const item = document.createElement('button');
      item.type = 'button';
      item.tabIndex = -1;
      item.title = t.text;
      Object.assign(item.dataset, { para, start: t.start, end: t.end });
      const en = document.createElement('span');
      en.className = 'nzh-cmp-en';
      en.textContent = t.text.length > CMP_MAX_TEXT ? t.text.slice(0, CMP_MAX_TEXT) + '…' : t.text;
      if (zh) {
        const label = document.createElement('span');
        label.className = 'nzh-cmp-zh';
        label.textContent = zh;
        // 没有通用中文名、译名就是原文的（3d → 3D、Love Live!）认得出来，只是不重复显示原文
        if (HAN_RE.test(zh) || plainName(zh) !== plainName(t.tag)) item.append(label, en);
        else item.append(label);
      } else if ((typo = getDict().typo(t.tag))) {
        // 常见的拼写错误：显示正确写法的中文，标出可能拼错
        const label = document.createElement('span');
        label.className = 'nzh-cmp-zh';
        label.textContent = `拼错？${typo.zh}`;
        item.className = 'nzh-cmp-typo';
        item.title = `${t.text}\n可能拼错了，应为 ${typo.tag}`;
        item.append(label, en);
      } else {
        item.className = 'nzh-cmp-none';
        item.append(en);
      }
      items.push(item);
    }
  });
  panel.replaceChildren(...items);
  panel.hidden = items.length === 0;
}

// 选中第 para 段里 [start, end) 的文字，ProseMirror 从页面的选区同步自己的选区；标签在框外时滚动编辑器
function selectInEditor(editor, para, start, end) {
  const p = editor.children[para];
  if (!p) return;
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let from = null;
  let to = null;
  for (let n; (n = walker.nextNode()); pos += n.data.length) {
    if (!from && start < pos + n.data.length) from = [n, start - pos];
    if (end <= pos + n.data.length) {
      to = [n, end - pos];
      break;
    }
  }
  if (!from || !to) return;
  editor.focus({ preventScroll: true });
  getSelection().setBaseAndExtent(from[0], from[1], to[0], to[1]);
  const rect = getSelection().getRangeAt(0).getBoundingClientRect();
  for (let el = editor; el; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight || !/auto|scroll/.test(getComputedStyle(el).overflowY)) continue;
    const view = el.getBoundingClientRect();
    if (rect.top < view.top || rect.bottom > view.bottom) el.scrollTop += rect.top - view.top - view.height / 3;
    break;
  }
}

function updateCompare() {
  const boxes = document.querySelectorAll('[data-prompt-input]');
  if (!boxes.length) return;
  if (!document.getElementById('nzh-cmp-style')) {
    const style = document.createElement('style');
    style.id = 'nzh-cmp-style';
    style.textContent = CMP_CSS;
    document.head.appendChild(style);
  }
  for (const box of boxes) {
    const editor = box.querySelector('.ProseMirror');
    if (!editor) continue;
    const header = promptHeaderOf(box);
    if (header) ensureCompareButton(header);
    let panel = box.nextElementSibling;
    if (!panel || !panel.classList.contains(CMP_PANEL)) panel = null;
    // 同时装了两份脚本时，面板归先放上去的那份管
    if (panel && panel.dataset.nzh !== INSTANCE) continue;
    if (!compareOn) {
      if (panel) panel.remove();
      continue;
    }
    if (!panel) {
      panel = createComparePanel(box, editor);
      box.after(panel);
    }
    renderComparePanel(panel, editor);
  }
}

let compareScheduled = false;
function scheduleCompare() {
  if (compareScheduled) return;
  compareScheduled = true;
  requestAnimationFrame(() => {
    compareScheduled = false;
    updateCompare();
  });
}

if (tagsEnabled) {
  // 编辑器里打字改的是文本节点，也要看 characterData；面板内容没变时 updateCompare 不写 DOM，不会循环触发
  new MutationObserver(scheduleCompare).observe(document, { childList: true, subtree: true, characterData: true });
  const reloadComparePref = () => {
    compareOn = readComparePref();
    scheduleCompare();
  };
  // 其他标签页切换了开关
  window.addEventListener('storage', (e) => {
    if (e.key === COMPARE_PREF_KEY) reloadComparePref();
  });
  // 扩展面板在这个页面上改了开关：同一个页面里改 localStorage 不触发 storage 事件，由 bridge.js 发这个事件
  document.addEventListener('nzh-compare', reloadComparePref);
}
