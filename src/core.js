// ---- 词典与检索（不依赖 DOM，scripts/test.mjs 也直接加载本文件） ----

const HAN_RE = /[㐀-䶿一-鿿豈-﫿]/;
const KANA_RE = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const SEP = '\u0001';
// 精确 / 前缀 / 包含 / 宽松匹配，相对 log10(使用次数) 的扣分
const MATCH_PENALTY = [0, 1, 1.5, 2.5];
const YEAR_TAG_RE = /^year[ _]?(\d{4})$/;

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

// 提示词里的标签，给中文对照（src/compare.js）用：按逗号（含全角）、|、顿号、零宽空格和权重写法的 :: 切开，去掉 {} [] 和权重数字。
// 单个冒号是标签的一部分（artist:xxx）。返回 [{ text, tag, start, end }]：text 是 s.slice(start, end)，
// tag 是查词典用的部分（见 cleanPromptTag），source#hugging 这类动作标签取 # 后面
const PROMPT_PART_RE = /(?:[^,，|、:\n\u200b-\u200d\ufeff]|(?<!:):(?!:))+/g;
const PROMPT_WEIGHT_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;
// Stable Diffusion 的权重 tag:1.2；冒号前全是数字的（16:9）不算
const SD_WEIGHT_RE = /^(.*\D)\s*:\s*-?(?:\d+\.?\d*|\.\d+)$/;

const parenDepthOk = (s) => {
  let depth = 0;
  for (const c of s) if ((depth += c === '(' ? 1 : c === ')' ? -1 : 0) < 0) return false;
  return depth === 0;
};
const countChar = (s, c) => s.split(c).length - 1;

// 去掉从 Stable Diffusion 抄来的权重写法：(tag)、((tag))、(tag:1.2)，以及 (a, b) 被逗号切开后两头多出的括号。
// 标签名自带的括号（albedo (overlord)）不动
function stripSdWeight(t) {
  for (let prev; prev !== t; ) {
    prev = t;
    if (t.startsWith('(') && countChar(t, '(') > countChar(t, ')')) t = t.slice(1).trim();
    if (t.endsWith(')') && countChar(t, ')') > countChar(t, '(')) t = t.slice(0, -1).trim();
    if (t.startsWith('(') && t.endsWith(')') && parenDepthOk(t.slice(1, -1))) t = t.slice(1, -1).trim();
    t = t.replace(SD_WEIGHT_RE, '$1').trim();
  }
  return t;
}

// 查词典前整理别处抄来的写法：中文输入法的全角括号和冒号、句尾的 ; 和 .；粘在第一个负面标签前的「Negative prompt:」、
// 角色名前的「character:」；
// Danbooru 网页侧栏复制的「? blue eyes 1.3m」；标注工具带置信度的「long hair 0.845」；Stable Diffusion 的括号和权重
function cleanPromptTag(t) {
  t = t.replace(/\s*（\s*/g, ' (').replace(/\s*）/g, ')').replace(/：/g, ':').replace(/[;.。]+$/, '').trim();
  // 夹在中间的 NovelAI 强调括号（traditional {slavic dress}）、列表开头的「- 」、括号前少的空格（keqing(genshin impact)）
  t = t.replace(/[{}[\]]/g, '').replace(/^(?:-\s+|=)/, '').replace(/([a-z])\((?=[a-z])/gi, '$1 (').trim();
  // 夹在中间的 Stable Diffusion 括号：带权重的 (long hair:1.5)、双层的 ((black twintails))、后面还有字的 (curly) hair。
  // 结尾的单层括号是出处（albedo (overlord)、saber (fate) (cosplay)），不动
  for (let prev; prev !== t; ) {
    prev = t;
    t = t.replace(/\(([^()]*?)\s*:\s*-?[\d.]+\)/g, '$1').replace(/\(\(([^()]*)\)\)/g, '$1').replace(/\(([^()]*)\)(?=\s*[\p{L}\p{N}])/gu, '$1');
  }
  t = t.replace(/^(?:negative prompt|character)\s*:\s*/i, '');
  if (/^\?\s/.test(t)) t = t.slice(1).trim().replace(/\s+\d+(?:\.\d+)?[km]?$/i, '');
  t = t.replace(/\s+\d+(?:\.\d+)?[km]$/i, '').replace(/\s+(?:0\.\d+|1\.0+)$/, '');
  return stripSdWeight(t);
}

// 一个逗号段里连着写的几个标签再切开：(artist:a)[[artist:b]]、(wlop)year 2023 在括号后面切；
// vibrant. happy. large breasts 这样用句号隔开的在句号后面切，mr. st. 这类缩写后面的不切（st. louis (azur lane)）
const GLUED_SPLIT_RE = /[)\]}](?=[([{\p{L}\p{N}])|(?<!(?:^|[^\p{L}])(?:mr|mrs|ms|dr|st|jr|vs|no|vol|ft|mt|lt|prof|feat))[.。](?=\s)/giu;

function* gluedParts(part, offset) {
  let from = 0;
  for (const m of part.matchAll(GLUED_SPLIT_RE)) {
    yield [part.slice(from, m.index + 1), offset + from];
    from = m.index + 1;
  }
  yield [part.slice(from), offset + from];
}

function promptTags(s) {
  const out = [];
  for (const m of s.matchAll(PROMPT_PART_RE)) {
    for (const [part, offset] of gluedParts(m[0], m.index)) {
      const lead = part.match(/^[\s{}[\]]*/)[0].length;
      const text = part.slice(lead).replace(/[\s{}[\]]+$/, '');
      if (!text || PROMPT_WEIGHT_RE.test(text)) continue;
      const tag = cleanPromptTag(text.slice(text.lastIndexOf('#') + 1).trim());
      // 只剩括号、标点的（多出来的「(」）不算标签
      if (!/[\p{L}\p{N}]/u.test(tag)) continue;
      const start = offset + lead;
      out.push({ text, tag, start, end: start + text.length });
    }
  }
  return out;
}

// 词典里没有、但提示词里常见的写法，按规则给个说明
const SPECIAL_TAGS = [
  [/^artist\s*:/, '画师'],
  // by 画师名；by the window、by the sea 这类是位置，不算
  [/^by (?!(?:the|a|an|her|his|my|your|their|our|its|night|day|moonlight|sunlight|candlelight|firelight|lamplight|window|sea|lake|river|hand|hands|myself|herself|himself)\b)\S/, '画师'],
  [/^style\s*:\s*\S/, '画风'],
  [/^negative prompt$/, '负面提示词（标题）'],
  [/^break$/, '分段（SD 语法）'],
  [/^-?(?:smea|dyn|smea ?\+ ?dyn|(?:k[ _])?(?:dpm|euler|ddim|lms|heun|unipc)\w*(?: .*)?|sampl(?:er|ing steps?)|(?:steps?|seed|cfg(?: scale)?|clip skip|m)\s*[=:]\s*[\d.]+)$/, '生成参数（不是标签）'],
];

// raw: 每行 `英文标签\t使用次数\t显示译名(多个用/分隔)\t额外检索词(用|分隔)\t旧标签名和英文别名(用|分隔)`
// 旧标签名和别名只用于查中文（NovelAI 英文联想里的旧名、提示词里写的 peace sign 这类别名），不参与检索
// t2s: 繁简对照（见 createT2S），用来转换查询；译名里有繁体字的，构建时已把转换后的写法加进额外检索词
function* buildZhDict(raw, t2s = '') {
  const toSimp = createT2S(t2s);
  const tags = [];
  const counts = [];
  const labels = [];
  const keys = [];
  const byTag = new Map();
  const aliases = new Map();
  const typos = new Map();
  // 人物、作品名（打包进脚本的词典在使用次数前加 x；dist/zh-tags.tsv 里是第 6 列的类别 3、4）：按词拼译名时不用
  const proper = [];

  let parsed = 0;
  for (let start = 0; start < raw.length; ) {
    const newline = raw.indexOf('\n', start);
    const end = newline < 0 ? raw.length : newline;
    const line = raw.slice(start, end);
    start = end + 1;
    if (!line) continue;
    const [tag, rawCount, label, extra, old, kind] = line.split('\t');
    const count = rawCount[0] === 'x' ? rawCount.slice(1) : rawCount;
    byTag.set(tag, tags.length);
    proper.push(count !== rawCount || kind === '3' || kind === '4');
    // 「~」开头的是常见的拼写错误（data/zh-words.csv 的 ?标签），不当别名
    if (old) {
      for (const o of old.split('|')) {
        const map = o[0] === '~' ? typos : aliases;
        const name = o[0] === '~' ? o.slice(1) : o;
        if (!map.has(name)) map.set(name, tags.length);
      }
    }
    tags.push(tag);
    counts.push(+count || 0);
    labels.push(label);
    // 前后都加分隔符，精确/前缀/包含匹配都只需一次 indexOf；检索词在构建时已规范化
    let key = SEP + normZh(label).split(/\s*\/\s*/).join(SEP) + SEP;
    if (extra) key += extra.split('|').join(SEP) + SEP;
    keys.push(key);
    if (++parsed % 256 === 0) yield;
  }

  const baseSize = tags.length;
  const originals = new Map();
  let revision = 0;

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
    for (const h of hits) {
      // 社区自定义标签没有 Danbooru 频次：精确命中译名或检索词时优先，不把“未知”当成冷门。
      h[2] = h[0] === 0 && h[1] >= baseSize && counts[h[1]] === 0 ? 1 : 0;
      h[0] = Math.log10(counts[h[1]] + 1) - MATCH_PENALTY[h[0]];
    }
    hits.sort((a, b) => b[2] - a[2] || b[0] - a[0]);
    return hits.slice(0, limit).map(([, i]) => ({ tag: tags[i], zh: labels[i], count: counts[i] }));
  }

  function indexOf(tag) {
    const t = tag.trim().toLowerCase().replace(/\s+/g, ' ');
    // ^_^ 之类的表情标签本身带下划线，先按原样查
    const s = t.replace(/_/g, ' ');
    const found = byTag.get(t) ?? byTag.get(s) ?? aliases.get(t) ?? aliases.get(s);
    if (found !== undefined || !s.includes('-')) return found;
    // 用连字符代替空格的（detailed-eyes、hair-ribbon）
    const h = s.replace(/-/g, ' ');
    return byTag.get(h) ?? aliases.get(h);
  }

  function lookup(tag) {
    const t = tag.trim().toLowerCase();
    // NovelAI 的年份标签（year 2025）：按那一年的画风出图。来源数据把一些年份记成 Danbooru 年份标签（2014）的别名，以这里为准
    const year = t.match(YEAR_TAG_RE);
    if (year) return `${year[1]}年画风`;
    const i = indexOf(tag);
    if (i !== undefined) return labels[i];
    // 「角色 from 作品」：先查「角色 (作品)」，角色名有两个词以上的再单查角色名（yuri from ... 不能查成「百合」）
    const from = t.match(/^(.+?) from (.+)$/);
    if (from) {
      const j = indexOf(`${from[1]} (${from[2]})`) ?? (from[1].includes(' ') ? indexOf(from[1]) : undefined);
      if (j !== undefined) return labels[j];
    }
    // 名和姓写反的角色名（nico yazawa (love live) → yazawa nico）：两个词对调，带出处括号的也试试去掉括号
    const name = t.match(/^(\S+) (\S+)( \(.+\))?$/);
    if (name) {
      const k = indexOf(`${name[2]} ${name[1]}${name[3] || ''}`) ?? (name[3] ? indexOf(`${name[2]} ${name[1]}`) : undefined);
      if (k !== undefined) return labels[k];
    }
    for (const [re, label] of SPECIAL_TAGS) if (re.test(t)) return label;
    // 从 Danbooru 标签列表连着图片数一起复制来的（plaid skirt 103945）
    const counted = t.match(/^(.+?) \d{4,}$/);
    return counted ? lookup(counted[1]) : null;
  }

  // 社区修订（src/community.js）：换掉显示译名、追加检索词，原来的译名仍可检索。
  // 词典里没有的社区标签也收录；图片数可选，原样插入提示词的名称须避开分隔符和权重语法。
  function amend(tag, label, terms = [], count = 0) {
    let i = indexOf(tag);
    if (i === undefined) {
      if (!label || !/^[\x20-\x7e]{1,100}$/.test(tag) || /[,|{}[\]#<>\\]|::/.test(tag)) return false;
      i = tags.length;
      byTag.set(tag, i);
      tags.push(tag);
      // 社区新加的标签类别未知，不拿来拼译名。
      proper.push(true);
      counts.push(Number.isInteger(count) && count > 0 ? count : 0);
      labels.push(label);
      keys.push(SEP);
    } else if (label) {
      if (i < baseSize && !originals.has(i)) originals.set(i, [labels[i], keys[i]]);
      labels[i] = label;
    }
    if (i < baseSize && !originals.has(i)) originals.set(i, [labels[i], keys[i]]);
    const add = [...(label ? normZh(label).split(/\s*\/\s*/) : []), ...terms.map(normZh)]
      .map(toSimp)
      .filter((k) => k && !keys[i].includes(SEP + k + SEP));
    if (add.length) keys[i] += add.join(SEP) + SEP;
    revision++;
    return true;
  }

  // 社区数据是完整快照：恢复基础记录后应用新覆盖，撤销和删除也立即生效。
  function replaceCommunity(entries) {
    for (const [i, [label, key]] of originals) {
      labels[i] = label;
      keys[i] = key;
    }
    originals.clear();
    for (let i = baseSize; i < tags.length; i++) byTag.delete(tags[i]);
    tags.length = counts.length = labels.length = keys.length = proper.length = baseSize;
    for (const e of entries) amend(e.tag, e.label, e.aliases, e.count);
    revision++;
  }

  // 常见的拼写错误（worth quality）对应的正确标签：{ tag, zh }，中文对照用它提示可能拼错
  function typo(tag) {
    const t = tag.trim().toLowerCase().replace(/\s+/g, ' ');
    const i = typos.get(t) ?? typos.get(t.replace(/_/g, ' '));
    return i === undefined ? null : { tag: tags[i], zh: labels[i] };
  }

  // 词典里没有的词组按词拼一个译名：panda plushie → 熊猫·毛绒动物玩具，edge of bed → 床的边缘。
  // 只用通用标签和常用词，人物、作品名不拼；每一段都要查得到、译名里有汉字，最多拼三段
  const GLOSS_PREP = {
    of: (a, b) => `${b}的${a}`,
    with: (a, b) => `带${b}的${a}`,
    on: (a, b) => `${b}上的${a}`,
    in: (a, b) => `${b}里的${a}`,
  };
  function glossPart(words) {
    const i = indexOf(words.join(' '));
    if (i === undefined || proper[i]) return null;
    const zh = labels[i].split('/')[0].replace(/[（(][^（）()]*[）)]$/, '').replace(/^一个/, '');
    return HAN_RE.test(zh) ? zh : null;
  }
  // 从右往左切：先试最长的结尾，前面剩下的也要都切得开
  function glossWords(words) {
    if (!words.length) return [];
    for (let i = 0; i < words.length; i++) {
      const head = glossPart(words.slice(i));
      if (!head) continue;
      const rest = glossWords(words.slice(0, i));
      if (rest) return [...rest, head];
    }
    return null;
  }
  function gloss(tag) {
    const words = tag.trim().toLowerCase().replace(/_/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) return null;
    const p = words.findIndex((w, i) => i > 0 && i < words.length - 1 && GLOSS_PREP[w]);
    if (p > 0) {
      const a = glossWords(words.slice(0, p));
      const b = glossWords(words.slice(p + 1));
      return a && b && a.length + b.length <= 3 ? GLOSS_PREP[words[p]](a.join(''), b.join('')) : null;
    }
    const parts = glossWords(words);
    return parts && parts.length > 1 && parts.length <= 3 ? parts.join('·') : null;
  }

  return {
    search,
    lookup,
    typo,
    gloss,
    amend,
    replaceCommunity,
    get revision() {
      return revision;
    },
    get size() {
      return tags.length;
    },
  };
}

function createZhDict(raw, t2s = '') {
  const build = buildZhDict(raw, t2s);
  let next;
  do { next = build.next(); } while (!next.done);
  return next.value;
}

// 每批最多解析 256 条，再把主线程交还给浏览器。MessageChannel 不受连续定时器的最小间隔限制。
async function createZhDictAsync(raw, t2s = '', yieldTask) {
  let channel;
  if (!yieldTask) {
    if (typeof MessageChannel === 'function') {
      channel = new MessageChannel();
      yieldTask = () => new Promise((resolve) => {
        channel.port1.onmessage = resolve;
        channel.port2.postMessage(null);
      });
    } else yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));
  }
  try {
    const build = buildZhDict(raw, t2s);
    for (;;) {
      const next = build.next();
      if (next.done) return next.value;
      await yieldTask();
    }
  } finally {
    channel?.port1.close();
    channel?.port2.close();
  }
}
