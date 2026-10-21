// 合并标签词典并生成 dist/novelai-zh-tags.user.js
// 用法: node scripts/build.mjs [--refresh]   (--refresh 重新下载 data/raw 下的源数据)
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const DIST_DIR = path.join(ROOT, 'dist');

const AMELA = 'https://huggingface.co/datasets/ame-la/danbooru-tags-data-zh/resolve/main/tags';
const SOURCES = {
  // 主数据：社区通用译名 + 别名 + 2026 年的使用次数。画师不收录：NovelAI V5 的联想里没有 Danbooru 画师
  'zh-general.csv': `${AMELA}/general.csv`,
  'zh-character.csv': `${AMELA}/character.csv`,
  'zh-copyright.csv': `${AMELA}/copyright.csv`,
  'zh-meta.csv': `${AMELA}/meta.csv`,
  // 较早的人工翻译，只作为补充检索词
  'zh-manual.csv': 'https://raw.githubusercontent.com/byzod/a1111-sd-webui-tagcomplete-CN/HEAD/tags/Tags-zh-full-pack.csv',
  // 2024 年前后的 Danbooru 标签表：用来找出改名标签的旧名，给 NovelAI 英文联想里的旧名配上中文
  'danbooru-old.csv': 'https://raw.githubusercontent.com/DominikDoom/a1111-sd-webui-tagcomplete/HEAD/tags/danbooru.csv',
  // 繁体字 → 简体字对照（OpenCC，Apache-2.0）：繁体输入转成简体后再检索
  'opencc-ts-characters.txt': 'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt',
};
const PRIMARY = ['zh-general.csv', 'zh-character.csv', 'zh-copyright.csv', 'zh-meta.csv'];

const MAX_SEARCH_NAMES = 8;

// 这些表情标签的下划线是标签本身的一部分（与 tagcomplete 的排除列表一致）
const KEEP_UNDERSCORE = new Set([
  '0_0', '(o)_(o)', '+_+', '+_-', '._.', '<o>_<o>', '<|>_<|>', '=_=', '>_<', '3_3',
  '6_9', '>_o', '@_@', '^_^', 'o_o', 'u_u', 'x_x', '|_|', '||_||',
]);

const HAN_RE = /[㐀-䶿一-鿿豈-﫿]/;
const KANA_RE = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;

async function readSource(name, refresh) {
  const file = path.join(RAW_DIR, name);
  if (!refresh) {
    try {
      return await fs.readFile(file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  console.log(`下载 ${SOURCES[name]}`);
  const res = await fetch(SOURCES[name]);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${SOURCES[name]}`);
  const text = await res.text();
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(file, text);
  return text;
}

async function readOptional(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

// 引号只在字段开头才算引用，标签里偶尔出现的 " 按普通字符处理
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') field += '"', i++;
      else quoted = false;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.length > 1 || r[0]);
}

// 带表头的 CSV -> 对象数组
function parseTable(text) {
  const [header, ...rows] = parseCsv(text);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// 两列译名表（标签,译名）；译文里没加引号的逗号会被拆开，拼回去
function parseTranslations(text) {
  return parseCsv(text)
    .filter((r) => r[0] && !r[0].startsWith('#'))
    .map((r) => [r[0].trim(), r.slice(1).join(',').trim()]);
}

function cleanText(s) {
  return s.replace(/[\t\r\n|]/g, ' ').replace(/\s+/g, ' ').trim();
}

// 检索词只要含汉字、不含假名的（假名输入会直接交给 NovelAI）
function searchable(s) {
  return HAN_RE.test(s) && !KANA_RE.test(s);
}

// 括号里只是类别说明（「Katsu（食物）」「x（符号）」），拆出来当检索词会同时命中几十个标签
const CATEGORY_WORDS = new Set(
  '模因 梗 风格 样式 画风 符号 物品 对象 物体 生物 游戏 表情 动作 表达 仪器 乐器 车辆 载具 场所 地点 物质 字体 角色 形象 食物 植物 动物 武器 服装 衣物 图案 颜色 花 鱼 鸟 船 舰船 建筑 媒介'.split(' '),
);

// 「死鱼眼（鄙夷眼神）」拆出括号前后两部分；角色/作品的括号是出处（荧（原神）），只取前半
function nameParts(zh, category) {
  const m = zh.match(/^(.+?)[（(](.+)[）)]$/);
  if (!m) return [];
  return category === 0 && !CATEGORY_WORDS.has(m[2]) ? [m[1], m[2]] : [m[1]];
}

// 检索词在构建时规范化并转成简体，运行时只需处理显示译名；规范化规则与 src/core.js 共用
const coreFns = vm.runInNewContext(
  `${await fs.readFile(path.join(ROOT, 'src', 'core.js'), 'utf8')}\n({ normZh, createT2S })`,
);
let toSimp = (s) => s;
function normZh(s) {
  return toSimp(coreFns.normZh(s));
}

// OpenCC 对照表每行 `繁体字\t简体字 其他写法`，取第一个简体写法，生成 createT2S 用的对照串
function parseT2S(text) {
  let pairs = '';
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [from, to = ''] = line.trim().split('\t');
    const simp = to.split(' ')[0];
    if ([...from].length === 1 && [...simp].length === 1 && simp !== from) pairs += from + simp;
  }
  return pairs;
}

function normTag(t) {
  return t.trim().toLowerCase().replace(/ /g, '_');
}

function displayTag(tag) {
  return KEEP_UNDERSCORE.has(tag) ? tag : tag.replace(/_/g, ' ');
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const raw = {};
  for (const name of Object.keys(SOURCES)) raw[name] = await readSource(name, refresh);
  const t2s = parseT2S(raw['opencc-ts-characters.txt']);
  toSimp = coreFns.createT2S(t2s);
  const curatedCsv = await readOptional(path.join(ROOT, 'data', 'zh-curated.csv'));
  const ehtagCsv = await readOptional(path.join(ROOT, 'data', 'zh-ehtag.csv'));
  const extraCsv = await readOptional(path.join(ROOT, 'data', 'zh-extra.csv'));
  const overrideCsv = await readOptional(path.join(ROOT, 'data', 'zh-override.csv'));
  const renameCsv = await readOptional(path.join(ROOT, 'data', 'novelai-rename.csv'));

  const entries = new Map(); // 标签 -> { category, count, label, names: Set, oldNames: Set }
  const aliasOf = new Map(); // 英文别名（含旧标签名）-> 标签
  for (const file of PRIMARY) {
    for (const r of parseTable(raw[file])) {
      const tag = normTag(r.tag);
      const category = +r.category;
      const label = cleanText(r.zh);
      if (!tag || !label) continue;
      const names = new Set(nameParts(label, category).map(cleanText));
      const aliases = r.aliases ? r.aliases.split('|').map(cleanText).filter(Boolean) : [];
      for (const a of aliases) {
        if (searchable(a)) names.add(a);
        else if (/^[\x21-\x7e ]+$/.test(a) && !aliasOf.has(normTag(a))) aliasOf.set(normTag(a), tag);
      }
      entries.set(tag, { category, count: +r.count || 0, label, names, oldNames: new Set() });
    }
  }
  const resolve = (t) => {
    t = normTag(t);
    return entries.has(t) ? t : aliasOf.get(t) ?? null;
  };

  // 旧快照里有、新数据里没有的标签名，若是某个新标签的别名，就记为它的旧名
  const oldTags = new Map(); // 旧标签 -> { category, count }
  const oldAliasOf = new Map();
  for (const [tag, category, count, aliasList] of parseCsv(raw['danbooru-old.csv'])) {
    oldTags.set(tag, { category: +category, count: +count || 0 });
    for (const a of (aliasList || '').split(',')) if (a && !oldAliasOf.has(a)) oldAliasOf.set(a, tag);
    if (entries.has(tag)) continue;
    const target = aliasOf.get(tag);
    if (target) entries.get(target).oldNames.add(tag);
  }

  const stats = { manual: 0, legacy: 0, ehtag: 0, curated: 0, extra: 0, override: 0 };
  for (const [t, zh] of parseTranslations(raw['zh-manual.csv'])) {
    const names = zh.split(/[/|]/).map(cleanText).filter(searchable);
    if (!names.length) continue;
    const e = entries.get(resolve(t));
    if (e) {
      for (const n of names) e.names.add(n);
      stats.manual++;
      continue;
    }
    // Danbooru 已删除或改掉、但 NovelAI 仍认识的旧标签（black_footwear、otoko_no_ko、bangs 等）
    const n = normTag(t);
    const old = oldTags.has(n) ? n : oldAliasOf.get(n);
    const info = old && oldTags.get(old);
    if (!info || info.category === 1 || entries.has(old) || aliasOf.has(old)) continue;
    entries.set(old, { category: info.category, count: info.count, label: names.join('/'), names: new Set(), oldNames: new Set() });
    stats.legacy++;
  }

  // EhTagTranslation 的人工译名（data/zh-ehtag.csv，已按 Danbooru 标签对齐），作为补充检索词
  for (const [t, zh] of parseTranslations(ehtagCsv)) {
    const e = entries.get(resolve(t));
    if (!e) continue;
    for (const n of zh.split('/').map(cleanText)) if (searchable(n)) e.names.add(n);
    stats.ehtag++;
  }

  // 审定表和 zh-extra.csv 里手写的检索词是有意加的，不受后面的冲突规则限制
  const pin = (e, names) => {
    e.pinned ??= new Set();
    for (const n of names) e.pinned.add(normZh(n));
  };

  // 审定译名（data/zh-curated.csv）：标签,译名,补充检索词；译名留空表示只补检索词，被替换的原译名保留为检索词；
  // 检索词前加「-」表示删掉这个来源数据里的错误检索词
  for (const [t, zh, aliases = ''] of parseCsv(curatedCsv).filter((r) => r[0] && !r[0].startsWith('#'))) {
    const e = entries.get(resolve(t));
    if (!e) {
      console.log(`审定表里的标签不存在: ${t}`);
      continue;
    }
    const parts = aliases.split('/').map(cleanText).filter(Boolean);
    const drop = new Set(parts.filter((n) => n.startsWith('-')).map((n) => normZh(n.slice(1))));
    const names = parts.filter((n) => !n.startsWith('-'));
    pin(e, names);
    if (zh && zh.trim() !== e.label) {
      names.push(e.label);
      e.label = cleanText(zh);
    }
    e.names = new Set([...names, ...e.names]);
    for (const n of e.names) if (drop.has(normZh(n))) e.names.delete(n);
    stats.curated++;
  }

  // 自定义：zh-extra.csv 追加检索词，zh-override.csv 替换显示译名；词表外的标签也收录
  const customOnly = new Set();
  const customEntry = (t) => {
    const tag = resolve(t);
    if (tag) return entries.get(tag);
    const raw = normTag(t);
    customOnly.add(raw);
    // 没有使用次数，主要是 NovelAI 质量词这类常用词，给一个中等热度
    const e = { category: 0, count: 10000, label: '', names: new Set(), oldNames: new Set() };
    entries.set(raw, e);
    return e;
  };
  // 自定义检索词排在前面，以免被数量上限截掉
  for (const [t, zh] of parseTranslations(extraCsv)) {
    const e = customEntry(t);
    const names = zh.split('/').map(cleanText).filter(Boolean);
    if (!e.label) e.label = names.shift();
    pin(e, names);
    e.names = new Set([...names, ...e.names]);
    stats.extra++;
  }
  for (const [t, zh] of parseTranslations(overrideCsv)) {
    const e = customEntry(t);
    if (e.label) e.names.add(e.label);
    e.label = cleanText(zh);
    stats.override++;
  }
  if (customOnly.size) console.log(`新数据里没有的自定义标签（请确认拼写）: ${[...customOnly].join(', ')}`);

  // 别名、旧译名、被审定替换下来的原译名常常正好是另一个标签的正式译名（chinese_clothes 的别名「汉服」、
  // choker 换下来的「项圈」），留着会让它精确命中两个标签、热门的那个反而排前面，所以丢掉
  const labelOwner = new Map();
  for (const [tag, e] of entries) for (const l of e.label.split('/')) labelOwner.set(normZh(l), tag);
  for (const [tag, e] of entries) {
    for (const n of e.names) {
      const key = normZh(n);
      const owner = labelOwner.get(key);
      if (owner && owner !== tag && !e.pinned?.has(key)) e.names.delete(n);
    }
  }

  // NovelAI 不认识 Danbooru 新名字的标签，输出为 NovelAI 认识的名字
  const renamed = new Map();
  for (const [from, to] of parseTranslations(renameCsv)) {
    const tag = resolve(from);
    if (!tag) console.log(`改名表里的标签不存在: ${from}`);
    else renamed.set(tag, normTag(to));
  }

  const rows = [...entries]
    .map(([tag, e]) => {
      const out = renamed.get(tag) ?? tag;
      // 运行时译名只做基本规范化、不转简体，含繁体字的译名把转换后的写法放进检索词
      const labels = e.label.split('/').map(coreFns.normZh);
      const converted = labels.map(toSimp).filter((l) => !labels.includes(l));
      // 不含汉字或含假名的检索词永远查不到（这类输入不走本地词典），被替换下来的假名、罗马字旧译名也在此丢掉
      const names = [...new Set([...converted, ...[...e.names].map(normZh)])]
        .filter((n) => n && !labels.includes(n) && searchable(n))
        .slice(0, MAX_SEARCH_NAMES);
      const oldNames = [...e.oldNames, ...(out !== tag ? [tag] : [])].filter((n) => n !== out);
      return { tag: out, count: e.count, label: e.label, names, oldNames };
    })
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'en'));

  // 每行: 标签 \t 使用次数 \t 显示译名 \t 检索词(|分隔) \t 旧标签名(|分隔，只用于给英文联想配中文)
  const tsv = rows
    .map((r) =>
      [displayTag(r.tag), r.count, r.label, r.names.join('|'), r.oldNames.map(displayTag).join('|')].join('\t').replace(/\t+$/, ''),
    )
    .join('\n');

  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const header = (await fs.readFile(path.join(ROOT, 'src', 'header.js'), 'utf8')).replace('{{version}}', pkg.version);
  const core = await fs.readFile(path.join(ROOT, 'src', 'core.js'), 'utf8');
  const mainJs = await fs.readFile(path.join(ROOT, 'src', 'main.js'), 'utf8');
  const script = `${header.trim()}\n\n(function () {\n'use strict';\n\nconst ZH_TAG_DATA = ${JSON.stringify(tsv)};\nconst ZH_T2S_DATA = ${JSON.stringify(t2s)};\n\n${core.trim()}\n\n${mainJs.trim()}\n})();\n`;

  await fs.mkdir(DIST_DIR, { recursive: true });
  await fs.writeFile(path.join(DIST_DIR, 'zh-tags.tsv'), tsv + '\n');
  await fs.writeFile(path.join(DIST_DIR, 'zh-t2s.txt'), t2s + '\n');
  await fs.writeFile(path.join(DIST_DIR, 'novelai-zh-tags.user.js'), script);
  // 脚本管理器检查更新时只下载这个文件头（@updateURL），版本号变了才下载完整脚本
  await fs.writeFile(path.join(DIST_DIR, 'novelai-zh-tags.meta.js'), header.trim().replace(/\n\n[\s\S]*$/, '') + '\n');

  const byCat = {};
  for (const e of entries.values()) byCat[e.category] = (byCat[e.category] || 0) + 1;
  console.log(
    `通用 ${byCat[0] || 0}，作品 ${byCat[3] || 0}，角色 ${byCat[4] || 0}，元标签 ${byCat[5] || 0}；` +
      `补充人工译名 ${stats.manual}，旧标签 ${stats.legacy}，EhTag ${stats.ehtag}，审定 ${stats.curated}，自定义检索词 ${stats.extra}，覆盖 ${stats.override}，改名 ${renamed.size}；共 ${rows.length} 条`,
  );
  console.log(`dist/novelai-zh-tags.user.js ${(Buffer.byteLength(script) / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
