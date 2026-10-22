// ---- 社区标签译名 ----
// 任何人都可以在社区平台（worker/，部署在 Cloudflare Workers 上）提交标签译名和检索词，审核通过后，
// 脚本每隔几小时拉一次已采纳的修改，存进 localStorage，覆盖内置词典里对应标签的显示译名、追加检索词。
// 只开放标签译名：它们在页面上只当纯文字显示（联想副标题、英文联想下的中文）；界面文案仍随版本内置。
// 拉来的内容照样检查：译名和检索词须含汉字、长度有限，不含 < >、控制字符和网址。
// 平台定时从 Danbooru 拉新标签，这些标签的条目带图片数 count，词典里没有时会新增；
// 新标签点选后原样插入提示词，所以标签名不能含 NovelAI 的分隔符和权重语法。

const COMMUNITY_CACHE_KEY = 'nzh-community';
const COMMUNITY_INTERVAL = 3 * 60 * 60 * 1000;
const COMMUNITY_UNSAFE = /[<>\u0000-\u001f\u007f]|[a-z][\w+.-]*:\/\/|javascript:|www\./i;
const COMMUNITY_TAG_UNSAFE = /[,|{}[\]#<>\\]|::/;

const communityText = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && HAN_RE.test(s) && !COMMUNITY_UNSAFE.test(s);

// 平台返回 { entries: [{ tag, label, aliases, count? }] }；不合格的字段丢掉，整条都没用的跳过
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
  for (const e of communityEntries) d.amend(e.tag, e.label, e.aliases, e.count);
}

function readCommunityCache() {
  try {
    return JSON.parse(localStorage.getItem(COMMUNITY_CACHE_KEY) || 'null');
  } catch {
    return null;
  }
}

async function refreshCommunity() {
  try {
    const res = await nativeFetch.call(window, `${NZH_COMMUNITY_URL}/api/overrides`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    communityEntries = sanitizeCommunity(await res.json());
    if (dict) amendDict(dict);
  } catch (e) {
    console.warn('[novelai-zh-tags] 获取社区译名失败', e);
  }
  // 失败也记下时间，离线时不会每次打开页面都重试
  try {
    localStorage.setItem(COMMUNITY_CACHE_KEY, JSON.stringify({ time: Date.now(), entries: communityEntries }));
  } catch {}
}

if (NZH_COMMUNITY_URL && tagsEnabled) {
  const cached = readCommunityCache();
  if (cached) communityEntries = sanitizeCommunity(cached);
  // 页面加载完再检查，不和 NovelAI 抢网络
  if (!cached || !(Date.now() - cached.time < COMMUNITY_INTERVAL)) {
    window.addEventListener('load', () => setTimeout(refreshCommunity, 3000));
  }
}
