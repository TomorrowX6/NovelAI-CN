// ---- 社区标签译名 ----
// 任何人都可以在编辑器（worker/，https://novelai.000.moe）用 GitHub 登录后修改标签译名和检索词，修改提交到仓库的
// data/zh-community.tsv。脚本每隔几小时从 GitHub 拉一次这个文件，存进 localStorage，覆盖内置词典里对应标签的显示译名、追加检索词。
// 只开放标签译名：它们在页面上只当纯文字显示（联想副标题、英文联想下的中文）；界面文案仍随版本内置。
// 拉来的内容照样检查：译名和检索词须含汉字、长度有限，不含 < >、控制字符和网址。
// 审核通过的新标签不要求来自 Danbooru；从 Danbooru 拉来的标签可附图片数 count。
// 新标签点选后原样插入提示词，所以标签名不能含 NovelAI 的分隔符和权重语法。

const COMMUNITY_CACHE_KEY = 'nzh-community';
// 扩展面板设置里的「自动更新」（extension/bridge.js 写入）：关掉后只在面板里点「更新社区译名」时拉取；
// 检查间隔（小时）只能是面板下拉框里的几档，默认 1 天
const COMMUNITY_AUTO_KEY = 'nzh-community-auto';
const COMMUNITY_HOURS_KEY = 'nzh-community-hours';
const COMMUNITY_HOURS = [1, 6, 12, 24, 168];
const COMMUNITY_DEFAULT_HOURS = 24;
const COMMUNITY_UNSAFE = /[<>\u0000-\u001f\u007f]|[a-z][\w+.-]*:\/\/|javascript:|www\./i;
const COMMUNITY_TAG_UNSAFE = /[,|{}[\]#<>\\]|::/;

const communityText = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && HAN_RE.test(s) && !COMMUNITY_UNSAFE.test(s);

// data/zh-community.tsv：# 开头是说明；每行 英文标签 \t 译名 \t 检索词（/ 分隔）\t 图片数（只有新标签有）
function parseCommunityTsv(text) {
  const entries = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const [tag, label = '', aliases = '', count = ''] = line.split('\t');
    entries.push({ tag, label, aliases: aliases ? aliases.split('/') : [], count: /^\d+$/.test(count) ? +count : 0 });
  }
  return { entries };
}

// { entries: [{ tag, label, aliases, count? }] }；不合格的字段丢掉，整条都没用的跳过
function sanitizeCommunity(data) {
  const out = [];
  for (const e of data && Array.isArray(data.entries) ? data.entries.slice(0, 50000) : []) {
    if (!e || typeof e.tag !== 'string' || !/^[\x20-\x7e]{1,100}$/.test(e.tag)) continue;
    const label = communityText(e.label, 60) ? e.label : '';
    const aliases = Array.isArray(e.aliases) ? e.aliases.filter((a) => communityText(a, 30)).slice(0, 8) : [];
    if (!label && !aliases.length) continue;
    const entry = { tag: e.tag, label, aliases };
    if (Number.isInteger(e.count) && e.count > 0 && !COMMUNITY_TAG_UNSAFE.test(e.tag)) entry.count = e.count;
    out.push(entry);
  }
  return out;
}

let communityEntries = [];

// main.js 的 getDict 建好词典后调用；数据晚到时也会对已有词典再调用一次
function amendDict(d) {
  d.replaceCommunity(communityEntries);
}

function applyCommunity(data) {
  communityEntries = sanitizeCommunity(data);
  if (dict) {
    amendDict(dict);
    document.dispatchEvent(new Event('nzh-dictionary'));
  }
}

function readCommunityCache() {
  try {
    return JSON.parse(localStorage.getItem(COMMUNITY_CACHE_KEY) || 'null');
  } catch {
    return null;
  }
}

// 失败尝试的序号不代表 entries 的版本。旧失败缓存缺少成功请求序号时才回退到成功时间。
const communitySuccessRequestTime = (data) => data?.successRequestTime
  ?? (data?.failed ? (data.successTime || 0) : (data?.requestTime || data?.time || 0));

let communityRefresh = null;
// 只锁住请求编号和缓存提交，网络下载在锁外进行，其他页面不会被慢网阻塞。
const communityLock = (fn) => typeof navigator !== 'undefined' && navigator.locks
  ? navigator.locks.request('nzh-community-cache', fn)
  : fn();

function refreshCommunity() {
  if (communityRefresh) return communityRefresh;
  communityRefresh = downloadCommunity().finally(() => { communityRefresh = null; });
  return communityRefresh;
}

async function downloadCommunity() {
  let reservation = communityLock(() => {
    const before = readCommunityCache();
    const requestTime = Math.max(Date.now(), (before?.requestCounter || before?.requestTime || before?.time || 0) + 1);
    try {
      localStorage.setItem(COMMUNITY_CACHE_KEY, JSON.stringify({ ...before, time: before?.time || 0, entries: before?.entries || [], requestCounter: requestTime }));
    } catch {}
    return { before, requestTime };
  });
  if (reservation?.then) reservation = await reservation;
  const { before, requestTime } = reservation;
  let entries;
  let failed = false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
  try {
    const res = await nativeFetch.call(window, NZH_COMMUNITY_DATA, {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache',
      ...(controller ? { signal: controller.signal } : {}),
    });
    // 还没有人修改过时文件不存在
    if (res.status === 404) entries = [];
    else if (!res.ok) throw new Error(`HTTP ${res.status}`);
    else entries = sanitizeCommunity(parseCommunityTsv(await res.text()));
  } catch (e) {
    failed = true;
    console.warn('[novelai-zh-tags] 获取社区译名失败', e);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
  return communityLock(() => {
    const latest = readCommunityCache();
    // 成功响应只让位给较新的成功快照；较新的失败尝试仍可以被成功响应补救。
    const latestRequestTime = failed ? (latest?.requestTime || latest?.time || 0) : communitySuccessRequestTime(latest);
    if (latestRequestTime > requestTime || (failed && latest && latest.time > (before?.time || 0) && !latest.failed)) {
      applyCommunity(latest);
      return;
    }
    // 失败也记下尝试时间，保留持久缓存的最新内容；成功时间独立保存，便于诊断。
    const data = {
      time: Math.max(Date.now(), (latest?.time || 0) + 1),
      requestTime,
      requestCounter: Math.max(latest?.requestCounter || 0, requestTime),
      successRequestTime: failed ? communitySuccessRequestTime(latest) : requestTime,
      successTime: failed ? (latest?.successTime || (!latest?.failed && latest?.time) || 0) : Date.now(),
      entries: failed ? sanitizeCommunity(latest || { entries: communityEntries }) : entries,
      failed,
    };
    applyCommunity(data);
    try {
      localStorage.setItem(COMMUNITY_CACHE_KEY, JSON.stringify(data));
    } catch {}
  });
}

const communityAuto = (() => {
  try {
    return localStorage.getItem(COMMUNITY_AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
})();

const communityHours = (() => {
  try {
    const hours = Number(localStorage.getItem(COMMUNITY_HOURS_KEY));
    return COMMUNITY_HOURS.includes(hours) ? hours : COMMUNITY_DEFAULT_HOURS;
  } catch {
    return COMMUNITY_DEFAULT_HOURS;
  }
})();

if (NZH_COMMUNITY_DATA && tagsEnabled) {
  const cached = readCommunityCache();
  if (cached) communityEntries = sanitizeCommunity(cached);
  // 时间为 0 表示面板点了「更新社区译名」，自动更新关着也要拉
  const requested = cached && cached.time === 0;
  const due = !cached || !(Date.now() - cached.time < communityHours * 60 * 60 * 1000);
  // 页面加载完再检查，不和 NovelAI 抢网络
  if (requested || (communityAuto && due)) {
    window.addEventListener('load', () => setTimeout(refreshCommunity, 3000));
  }
  // 扩展面板点了「更新社区译名」：当场拉取，不刷新页面（extension/bridge.js 发这个事件）。
  // 安卓版 Firefox 打开面板时 NovelAI 在后台，后台刷新页面很慢，还可能被系统杀掉
  document.addEventListener('nzh-community-refresh', () => refreshCommunity());
  window.addEventListener('storage', (e) => {
    if (e.key === COMMUNITY_CACHE_KEY) applyCommunity(readCommunityCache());
  });
}
