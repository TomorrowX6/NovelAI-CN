// 检索质量回归测试；先 npm run build。
// node scripts/test.mjs            运行断言
// node scripts/test.mjs 黑丝 猫耳   打印这些词的联想结果
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { readUiData, uiDataProblems, flattenLocale, buildLocale, buildZhLocale, readHardData, hardDataProblems } from './ui-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = fs.readFileSync(path.join(ROOT, 'src', 'core.js'), 'utf8');
const data = fs.readFileSync(path.join(ROOT, 'dist', 'zh-tags.tsv'), 'utf8');
const t2s = fs.readFileSync(path.join(ROOT, 'dist', 'zh-t2s.txt'), 'utf8').trim();
const ctx = vm.createContext({});
vm.runInContext(`${core}\nthis.createZhDict = createZhDict;`, ctx);

let t = performance.now();
const dict = ctx.createZhDict(data, t2s);
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

// scripts/search-cases.tsv 每行用 Tab 分隔：查询、期望标签、期望排在前几名
const CASES = fs
  .readFileSync(path.join(ROOT, 'scripts', 'search-cases.tsv'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [q, tag, n] = l.split('\t');
    return [q, tag, +n || 1];
  });

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

// 社区修订：换显示译名、追加检索词，原译名仍能搜到；词典里没有的标签不收
{
  const d = ctx.createZhDict(data, t2s);
  const before = d.lookup('cat ears');
  const top = (q) => d.search(q, 15).slice(0, 3).map((r) => r.tag);
  if (!d.amend('cat_ears', '猫耳朵/兽耳', ['喵喵耳'])) {
    failed++;
    console.log('✗ amend(cat_ears) 没找到标签');
  }
  if (d.lookup('cat ears') !== '猫耳朵/兽耳') {
    failed++;
    console.log(`✗ amend 后 lookup(cat ears) = ${d.lookup('cat ears')}`);
  }
  for (const q of ['喵喵耳', '猫耳朵', before.split('/')[0]]) {
    if (!top(q).includes('cat ears')) {
      failed++;
      console.log(`✗ amend 后搜 ${q} 前 3 没有 cat ears：${top(q)}`);
    }
  }
  if (d.amend('no such tag zzz', '不存在', []) || d.lookup('no such tag zzz') !== null || d.size !== dict.size) {
    failed++;
    console.log('✗ 没有图片数的新标签不应收录');
  }
  // 平台从 Danbooru 拉来的新标签带图片数，词典里没有时新增（用虚构的标签，免得哪天词典收录了它）
  if (!d.amend('nzh test tag (zzz)', '测试新标签（虚构）', ['虚构测试标签'], 160) || d.size !== dict.size + 1) {
    failed++;
    console.log('✗ 带图片数的新标签应当收录');
  }
  const hit = d.search('虚构测试标签', 15)[0];
  if (!hit || hit.tag !== 'nzh test tag (zzz)' || hit.count !== 160 || d.lookup('nzh_test_tag_(zzz)') !== '测试新标签（虚构）') {
    failed++;
    console.log(`✗ 新增的标签搜不到：${JSON.stringify(hit)}`);
  }
}

// 界面汉化：译文的占位符要与英文一致；把打包的中文合并回英文文案后，每条都应是译文（没翻译的保持英文）
const uiData = readUiData();
for (const p of uiDataProblems(uiData)) {
  failed++;
  console.log(`✗ 界面译文 ${p}`);
}
// 写死文字的译文：片段个数要和原文一致，原文不能重复
for (const p of hardDataProblems(readHardData())) {
  failed++;
  console.log(`✗ 写死文字的译文 ${p}`);
}
const uiCtx = vm.createContext({});
vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8')}\nthis.mergeLocale = mergeLocale;`, uiCtx);
const merged = flattenLocale(uiCtx.mergeLocale(buildLocale(uiData, ([en]) => en), buildZhLocale(uiData)));
for (const [key, [en, zh]] of Object.entries(uiData)) {
  if (merged[key] !== (zh || en)) {
    failed++;
    console.log(`✗ 界面文案合并后 ${key} = ${JSON.stringify(merged[key])}，期望 ${JSON.stringify(zh || en)}`);
  }
}

// 界面语言的设置边界：读账号数据时 en 换成 zh；账号是日文时只有扩展面板强制打开中文才换；保存时 zh 换成 en
{
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  let sent = null;
  const nativeFetch = async (url, init) => ((sent = init), new Response('{}'));
  const c = vm.createContext({ localStorage, nativeFetch, window: {}, location: { href: 'https://novelai.net/image' }, URL, Response });
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8')}\nthis.uiSettingsFetch = uiSettingsFetch;`, c);
  const userData = (lang) => async () => new Response(JSON.stringify({ settings: JSON.stringify({ uiLanguage: lang, other: 1 }) }));
  const shownLang = async (lang) => {
    const res = c.uiSettingsFetch('https://api.novelai.net/user/data', { method: 'GET' }, userData(lang));
    return res ? JSON.parse((await (await res).json()).settings).uiLanguage : '（未处理）';
  };
  const cases = [];
  cases.push(['没选中文，账号 en', await shownLang('en'), '（未处理）']);
  store.set('nzh-ui-lang', 'zh');
  cases.push(['选了中文，账号 en', await shownLang('en'), 'zh']);
  cases.push(['选了中文，账号在别处改成 jp', await shownLang('jp'), 'jp']);
  store.set('nzh-ui-force', '1');
  cases.push(['面板强制中文，账号 jp', await shownLang('jp'), 'zh']);
  await c.uiSettingsFetch('https://api.novelai.net/user/clientsettings', { method: 'PUT', body: JSON.stringify({ uiLanguage: 'zh', other: 1 }) });
  cases.push(['保存设置时 zh 存成 en', JSON.parse(sent.body).uiLanguage, 'en']);
  cases.push(['保存后不再强制', String(store.has('nzh-ui-force')), 'false']);
  cases.push(['保存后仍是中文', store.get('nzh-ui-lang'), 'zh']);
  store.set('nzh-ui-force', '1');
  c.uiSettingsFetch('https://api.novelai.net/user/clientsettings', { method: 'PUT', body: JSON.stringify({ uiLanguage: 'jp' }) });
  cases.push(['在选单里改成日文后不再是中文', String(store.has('nzh-ui-lang')) + String(store.has('nzh-ui-force')), 'falsefalse']);
  for (const [name, got, want] of cases) {
    if (got !== want) {
      failed++;
      console.log(`✗ 界面语言：${name}，得到 ${got}，期望 ${want}`);
    }
  }
}

t = performance.now();
for (const [q] of CASES) dict.search(q, 15);
console.log(`${CASES.length} 次检索平均 ${((performance.now() - t) / CASES.length).toFixed(2)} ms`);
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
