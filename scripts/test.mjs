// 检索质量回归测试；先 npm run build。
// node scripts/test.mjs            运行断言
// node scripts/test.mjs 黑丝 猫耳   打印这些词的联想结果
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = fs.readFileSync(path.join(ROOT, 'src', 'core.js'), 'utf8');
const data = fs.readFileSync(path.join(ROOT, 'dist', 'zh-tags.tsv'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(`${core}\nthis.createZhDict = createZhDict;`, ctx);

let t = performance.now();
const dict = ctx.createZhDict(data);
console.log(`解析 ${dict.size} 条，用时 ${(performance.now() - t).toFixed(1)} ms`);

const queries = process.argv.slice(2);
if (queries.length) {
  for (const q of queries) {
    t = performance.now();
    const res = dict.search(q, 15);
    console.log(`\n${q}  (${(performance.now() - t).toFixed(1)} ms)`);
    for (const r of res) console.log(`  ${r.tag.padEnd(32)} ${String(r.count).padStart(8)}  ${r.zh}`);
  }
  process.exit(0);
}

// [查询, 期望出现在前 N 条的标签, N]
const CASES = [
  ['长发', 'long hair', 1],
  ['猫耳', 'cat ears', 1],
  ['双马尾', 'twintails', 1],
  ['过膝袜', 'thighhighs', 1],
  ['黑丝', 'black pantyhose', 3],
  ['白丝', 'white thighhighs', 3],
  ['呆毛', 'ahoge', 1],
  ['女仆', 'maid', 1],
  ['旗袍', 'china dress', 1],
  ['水手服', 'serafuku', 1],
  ['眼镜', 'glasses', 1],
  ['微笑', 'smile', 1],
  ['脸红', 'blush', 1],
  ['金发', 'blonde hair', 1],
  ['银发', 'grey hair', 3],
  ['白发', 'white hair', 1],
  ['异色瞳', 'heterochromia', 1],
  ['初音', 'hatsune miku', 1],
  ['原神', 'genshin impact', 1],
  ['东方', 'touhou', 1],
  ['碧蓝档案', 'blue archive', 1],
  ['兽耳', 'animal ears', 1],
  ['狐耳', 'fox ears', 1],
  ['全身', 'full body', 1],
  ['上半身', 'upper body', 1],
  ['看着观众', 'looking at viewer', 1],
  ['白色背景', 'white background', 1],
  ['樱花', 'cherry blossoms', 1],
  ['和服', 'kimono', 1],
  ['汉服', 'hanfu', 1],
  ['jk制服', 'school uniform', 3],
  ['旗袍', 'china dress', 1],
  ['二小姐', 'flandre scarlet', 1],
  ['伪娘', 'trap', 2],
  ['伪娘', 'otoko no ko', 2],
  ['鸭子坐', 'wariza', 1],
  ['死鱼眼', 'jitome', 1],
  ['刘海', 'blunt bangs', 3],
  ['洛天依', 'luo tianyi', 1],
  ['芙莉莲', 'frieren', 1],
];

let failed = 0;
for (const [q, tag, n] of CASES) {
  const res = dict.search(q, 15);
  const rank = res.findIndex((r) => r.tag === tag);
  if (rank < 0 || rank >= n) {
    failed++;
    console.log(`✗ ${q} → 期望 ${tag} 在前 ${n}，实际 ${rank < 0 ? '未出现' : `第 ${rank + 1}`}: ${res.slice(0, 5).map((r) => r.tag).join(', ')}`);
  }
}

const LOOKUPS = [
  ['cat ears', '猫耳'],
  ['lolita fashion', '洛丽塔'],
  ['china dress', '旗袍'],
  // NovelAI 英文联想里会出现的 Danbooru 旧标签名
  ['black footwear', '鞋'],
  ['otoko no ko', '伪娘'],
  ['^_^', null],
];
for (const [tag, expect] of LOOKUPS) {
  const zh = dict.lookup(tag);
  if (expect && !(zh || '').includes(expect)) {
    failed++;
    console.log(`✗ lookup(${tag}) = ${zh}，期望包含 ${expect}`);
  }
}

t = performance.now();
for (const [q] of CASES) dict.search(q, 15);
console.log(`${CASES.length} 次检索平均 ${((performance.now() - t) / CASES.length).toFixed(2)} ms`);
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
