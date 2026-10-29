// ---- 词典与检索（不依赖 DOM，scripts/test.mjs 也直接加载本文件） ----

const HAN_RE = /[㐀-䶿一-鿿豈-﫿]/;
const KANA_RE = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const SEP = '\u0001';
// 精确 / 前缀 / 包含 / 宽松匹配，相对 log10(使用次数) 的扣分
const MATCH_PENALTY = [0, 1, 1.5, 2.5];

function normZh(s) {
  return s
    .toLowerCase()
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[{}[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 繁体字逐字转成简体后再检索，只影响匹配，不改显示的译名
// pairs: 繁体字与对应简体字依次相连的字符串，由构建脚本从 OpenCC 的对照表生成
function createT2S(pairs) {
  const map = new Map();
  const chars = [...pairs];
  for (let i = 0; i + 1 < chars.length; i += 2) map.set(chars[i], chars[i + 1]);
  if (!map.size) return (s) => s;
  const re = new RegExp(`[${[...map.keys()].join('')}]`, 'gu');
  return (s) => s.replace(re, (c) => map.get(c));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 提示词里的标签，给中文对照（src/compare.js）用：按逗号、|、顿号和权重写法的 :: 切开，去掉 {} [] 和权重数字。
// 单个冒号是标签的一部分（artist:xxx）。返回 [{ text, tag, start, end }]：text 是 s.slice(start, end)，
// tag 是查词典用的部分，source#hugging 这类动作标签取 # 后面
const PROMPT_PART_RE = /(?:[^,|、:\n]|(?<!:):(?!:))+/g;
const PROMPT_WEIGHT_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;

function promptTags(s) {
  const out = [];
  for (const m of s.matchAll(PROMPT_PART_RE)) {
    const lead = m[0].match(/^[\s{}[\]]*/)[0].length;
    const text = m[0].slice(lead).replace(/[\s{}[\]]+$/, '');
    if (!text || PROMPT_WEIGHT_RE.test(text)) continue;
    const start = m.index + lead;
    out.push({ text, tag: text.slice(text.lastIndexOf('#') + 1).trim(), start, end: start + text.length });
  }
  return out;
}

// raw: 每行 `英文标签\t使用次数\t显示译名(多个用/分隔)\t额外检索词(用|分隔)\t旧标签名(用|分隔)`
// 旧标签名只用于给 NovelAI 英文联想里出现的旧名配上中文，不参与检索
// t2s: 繁简对照（见 createT2S），用来转换查询；译名里有繁体字的，构建时已把转换后的写法加进额外检索词
function createZhDict(raw, t2s = '') {
  const toSimp = createT2S(t2s);
  const tags = [];
  const counts = [];
  const labels = [];
  const keys = [];
  const byTag = new Map();
  const aliases = new Map();

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const [tag, count, label, extra, old] = line.split('\t');
    byTag.set(tag, tags.length);
    if (old) for (const o of old.split('|')) if (!aliases.has(o)) aliases.set(o, tags.length);
    tags.push(tag);
    counts.push(+count || 0);
    labels.push(label);
    // 前后都加分隔符，精确/前缀/包含匹配都只需一次 indexOf；检索词在构建时已规范化
    let key = SEP + normZh(label).split(/\s*\/\s*/).join(SEP) + SEP;
    if (extra) key += extra.split('|').join(SEP) + SEP;
    keys.push(key);
  }

  function search(query, limit) {
    const q = toSimp(normZh(query));
    if (!q) return [];
    const exact = SEP + q + SEP;
    const prefix = SEP + q;
    const hits = [];
    const seen = new Set();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.indexOf(q) < 0) continue;
      hits.push([k.includes(exact) ? 0 : k.includes(prefix) ? 1 : 2, i]);
      seen.add(i);
    }
    // 结果不足时做宽松匹配：按顺序包含所有字、字间最多隔 3 个字（白丝袜 → 白色丝袜）
    const chars = [...q].filter((c) => c !== ' ');
    if (hits.length < limit && chars.length >= 2) {
      const re = new RegExp(chars.map(escapeRe).join(`[^${SEP}]{0,3}`));
      for (let i = 0; i < keys.length; i++) {
        if (!seen.has(i) && re.test(keys[i])) hits.push([3, i]);
      }
    }
    // 匹配程度和热度一起排：冷门的前缀匹配不应压过热门的包含匹配
    for (const h of hits) h[0] = Math.log10(counts[h[1]] + 1) - MATCH_PENALTY[h[0]];
    hits.sort((a, b) => b[0] - a[0]);
    return hits.slice(0, limit).map(([, i]) => ({ tag: tags[i], zh: labels[i], count: counts[i] }));
  }

  function indexOf(tag) {
    const t = tag.trim().toLowerCase();
    // ^_^ 之类的表情标签本身带下划线，先按原样查
    const s = t.replace(/_/g, ' ');
    return byTag.get(t) ?? byTag.get(s) ?? aliases.get(t) ?? aliases.get(s);
  }

  function lookup(tag) {
    const i = indexOf(tag);
    return i === undefined ? null : labels[i];
  }

  // 社区修订（src/community.js）：换掉显示译名、追加检索词，原来的译名仍可检索。
  // 词典里没有的标签，只有平台从 Danbooru 拉来的新标签（带图片数 count）才新增，标签名由 community.js 检查过
  function amend(tag, label, terms = [], count = 0) {
    let i = indexOf(tag);
    if (i === undefined) {
      if (!count || !label) return false;
      i = tags.length;
      byTag.set(tag, i);
      tags.push(tag);
      counts.push(count);
      labels.push(label);
      keys.push(SEP);
    } else if (label) {
      labels[i] = label;
    }
    const add = [...(label ? normZh(label).split(/\s*\/\s*/) : []), ...terms.map(normZh)]
      .map(toSimp)
      .filter((k) => k && !keys[i].includes(SEP + k + SEP));
    if (add.length) keys[i] += add.join(SEP) + SEP;
    return true;
  }

  return {
    search,
    lookup,
    amend,
    get size() {
      return tags.length;
    },
  };
}
