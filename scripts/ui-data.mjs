// 界面汉化数据 data/ui-zh.json 的读写，scripts/build.mjs、test.mjs、ui-strings.mjs 共用。
// 文件是扁平的 { "路径": [英文, 中文] }，路径用 . 连接 NovelAI 文案对象的键；
// [记号, 说明] 形式的列表（文件名模板说明）每行一条，写成 "路径[记号]"。
// 中文留空表示还没翻译，和英文相同表示有意保留英文（品牌名、模型名等），这两种都不会打包进脚本。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UI_DATA_FILE = path.join(ROOT, 'data', 'ui-zh.json');

export function readUiData(file = UI_DATA_FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

// 一行一条，方便 diff 和逐条审阅
export function writeUiData(data, file = UI_DATA_FILE) {
  const lines = Object.entries(data).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  fs.writeFileSync(file, `{\n${lines.join(',\n')}\n}\n`);
}

const isRowList = (v) => Array.isArray(v) && v.every((r) => Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'string'));

// NovelAI 的文案对象 -> { 路径: 英文 }
export function flattenLocale(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (/[.[\]]/.test(k)) throw new Error(`文案键里有 . 或 []，扁平化后无法还原: ${prefix}${k}`);
    const key = prefix + k;
    if (typeof v === 'string') out[key] = v;
    else if (isRowList(v)) for (const [token, text] of v) out[`${key}[${token}]`] = text;
    else if (v && typeof v === 'object' && !Array.isArray(v)) flattenLocale(v, key + '.', out);
    else throw new Error(`无法处理的文案值类型: ${key}`);
  }
  return out;
}

const translated = ([en, zh]) => zh && zh !== en;

// { 路径: [英文, 中文] } -> 结构与 NovelAI 文案对象一致的嵌套对象，pick 返回 undefined 的条目不放进去
export function buildLocale(data, pick) {
  const root = {};
  for (const [key, pair] of Object.entries(data)) {
    const value = pick(pair);
    if (value === undefined) continue;
    const m = key.match(/^([^[]*)(?:\[(.*)\])?$/);
    const parts = m[1].split('.');
    let node = root;
    for (const p of parts.slice(0, -1)) node = node[p] ??= {};
    const last = parts.at(-1);
    if (m[2] === undefined) node[last] = value;
    else (node[last] ??= []).push([m[2], value]);
  }
  return root;
}

// 打包进脚本的中文：只含已翻译的条目
export const buildZhLocale = (data) => buildLocale(data, (pair) => (translated(pair) ? pair[1] : undefined));

// [0] 这类占位符和 <em> 标签在译文里必须原样保留
const MARKERS = /\[\d+\]|<\/?[a-z]+>/g;
const markers = (s) => (s.match(MARKERS) || []).sort().join(' ');

export function uiDataProblems(data) {
  const problems = [];
  for (const [key, pair] of Object.entries(data)) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((x) => typeof x !== 'string')) {
      problems.push(`${key}: 格式应为 [英文, 中文]`);
      continue;
    }
    if (translated(pair) && markers(pair[0]) !== markers(pair[1])) {
      problems.push(`${key}: 占位符不一致，英文「${markers(pair[0])}」，中文「${markers(pair[1])}」`);
    }
  }
  return problems;
}

export function uiDataStats(data) {
  const pairs = Object.values(data);
  return {
    total: pairs.length,
    translated: pairs.filter(translated).length,
    untranslated: pairs.filter(([en, zh]) => en && !zh).length,
  };
}
