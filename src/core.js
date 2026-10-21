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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// raw: 每行 `英文标签\t使用次数\t显示译名(多个用/分隔)\t额外检索词(用|分隔)\t旧标签名(用|分隔)`
// 旧标签名只用于给 NovelAI 英文联想里出现的旧名配上中文，不参与检索
function createZhDict(raw) {
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
    const q = normZh(query);
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

  function lookup(tag) {
    const t = tag.trim().toLowerCase();
    // ^_^ 之类的表情标签本身带下划线，先按原样查
    const s = t.replace(/_/g, ' ');
    const i = byTag.get(t) ?? byTag.get(s) ?? aliases.get(t) ?? aliases.get(s);
    return i === undefined ? null : labels[i];
  }

  return { search, lookup, size: tags.length };
}
