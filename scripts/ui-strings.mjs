// 从 NovelAI 网页抓取当前的英文界面文案，与 data/ui-zh.json 对比
// 用法: node scripts/ui-strings.mjs                报告新增、删除、英文有改动的条目
//       node scripts/ui-strings.mjs --write        同步到 data/ui-zh.json：新增条目中文留空，删掉 NovelAI 已去掉的条目，
//                                                  英文改了的条目更新英文、保留旧译文（需要人工复核，见输出）
//       node scripts/ui-strings.mjs --untranslated 列出中文还空着的条目
import vm from 'node:vm';
import { flattenLocale, readUiData, writeUiData, uiDataStats } from './ui-data.mjs';

const ORIGIN = 'https://novelai.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  return res.text();
}

// 从 { 开始找到配对的 }，跳过字符串和模板字符串里的括号
function matchBracket(s, start) {
  let depth = 0;
  let i = start;
  const skipQuoted = (q) => {
    for (i++; s[i] !== q; i++) if (s[i] === '\\') i++;
  };
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") skipQuoted(c);
    else if (c === '`') {
      for (i++; s[i] !== '`'; i++) {
        if (s[i] === '\\') i++;
        else if (s[i] === '$' && s[i + 1] === '{') i = matchBracket(s, i + 1) - 1;
      }
    } else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') {
      if (--depth === 0) return i + 1;
    }
  }
  throw new Error('括号不配对');
}

// 英文文案是打包进某个分块里的对象字面量 {lang:"en",tier:{...},general:{...},...}
async function fetchEnglishLocale() {
  const html = await get(`${ORIGIN}/image`);
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"?]+\.js/g) || [])];
  if (!chunks.length) throw new Error('页面里没有找到脚本分块，NovelAI 可能改了打包方式');
  for (let i = 0; i < chunks.length; i += 8) {
    const texts = await Promise.all(chunks.slice(i, i + 8).map((c) => get(ORIGIN + c)));
    for (const s of texts) {
      const at = s.indexOf('{lang:"en",');
      if (at < 0) continue;
      return vm.runInNewContext(`(${s.slice(at, matchBracket(s, at))})`);
    }
  }
  throw new Error('没有找到英文界面文案');
}

const args = process.argv.slice(2);
const data = readUiData();

if (args.includes('--untranslated')) {
  for (const [key, [en, zh]] of Object.entries(data)) if (en && !zh) console.log(`${key}\t${JSON.stringify(en)}`);
  process.exit(0);
}

const live = flattenLocale(await fetchEnglishLocale());
const added = Object.keys(live).filter((k) => !(k in data));
const removed = Object.keys(data).filter((k) => !(k in live));
const changed = Object.keys(live).filter((k) => k in data && data[k][0] !== live[k]);

for (const k of added) console.log(`+ ${k}\t${JSON.stringify(live[k])}`);
for (const k of removed) console.log(`- ${k}\t${JSON.stringify(data[k][0])}`);
for (const k of changed) console.log(`~ ${k}\t${JSON.stringify(data[k][0])} → ${JSON.stringify(live[k])}\t译文：${JSON.stringify(data[k][1])}`);
console.log(`NovelAI 当前 ${Object.keys(live).length} 条：新增 ${added.length}，删除 ${removed.length}，英文改动 ${changed.length}`);

if (args.includes('--write')) {
  // 按 NovelAI 文案对象的顺序重排，空英文不需要翻译
  const next = {};
  for (const [k, en] of Object.entries(live)) next[k] = [en, data[k] ? data[k][1] : en ? '' : en];
  writeUiData(next);
  const s = uiDataStats(next);
  console.log(`已写入 data/ui-zh.json：共 ${s.total} 条，已翻译 ${s.translated}，待翻译 ${s.untranslated}`);
  if (changed.length) console.log('英文有改动的条目保留了旧译文，请对照上面标 ~ 的行复核');
}
