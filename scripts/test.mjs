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
vm.runInContext(`${core}\nthis.createZhDict = createZhDict;\nthis.promptTags = promptTags;`, ctx);

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
  // 提示词里常直接写的 Danbooru 别名
  ['peace sign', 'V字'],
  ['sparkles', '闪光'],
  ['watercolor', '水彩'],
  ['stockings', '过膝袜'],
  ['miku', '初音'],
  ['kiss mark', '口红印'],
  ['wuwa', '鸣潮'],
  // Danbooru 改了名、词典里还是旧名的标签，新名字也能查到
  ['grid watermark', '水印'],
  // NovelAI 自己的质量词和年份标签
  ['amazing quality', '质量'],
  ['very displeasing', '不美观'],
  ['year 2025', '2025年画风'],
  ['year_2014', '2014年画风'],
  // 不是标签的常用英文词（data/zh-words.csv），也盖过来源数据里把普通词当成角色名的别名（grim → 碧蓝航线的格里姆）
  ['dramatic', '戏剧'],
  ['beam of light', '光束'],
  ['battle-worn', '战损'],
  ['grim', '冷峻'],
  ['dramatic sky', '天空'],
  ['anime', '动漫'],
  ['1 girl', '一个女孩'],
  ['look at viewer', '看向观众'],
  // 单复数写错
  ['cat ear', '猫耳'],
  ['freckle', '雀斑'],
  ['high heel', '高跟鞋'],
  ['denim short', '牛仔短裤'],
  ['^_^', null],
];
for (const [tag, expect] of LOOKUPS) {
  const zh = dict.lookup(tag);
  if (expect && !(zh || '').includes(expect)) {
    failed++;
    console.log(`✗ lookup(${tag}) = ${zh}，期望包含 ${expect}`);
  }
}
// 名字带 | 的别名（||_||）写进以 | 分隔的旧名列，会拆出 _ 和空串这样的碎片别名
for (const tag of ['_', '']) {
  if (dict.lookup(tag) !== null) {
    failed++;
    console.log(`✗ lookup(${JSON.stringify(tag)}) = ${dict.lookup(tag)}，期望查不到`);
  }
}
// 不是标签的写法按规则说明；「角色 from 作品」先按「角色 (作品)」查，单个词的角色名不单查（yuri 是「百合」）
for (const [tag, expect] of [['artist:wlop', '画师'], ['negative prompt', '负面提示词'], ['k dpmpp sde', '生成参数'], ['-seed=229821', '生成参数'], ['break', '分段']]) {
  if (!(dict.lookup(tag) || '').includes(expect)) {
    failed++;
    console.log(`✗ lookup(${tag}) = ${dict.lookup(tag)}，期望包含 ${expect}`);
  }
}
for (const [phrase, same] of [['ryuuguu rena from higurashi no naku koro ni', 'ryuuguu rena'], ['yuri from doki doki literature club', 'yuri (doki doki literature club)'], ['plaid skirt 103945', 'plaid skirt']]) {
  if (!dict.lookup(same) || dict.lookup(phrase) !== dict.lookup(same)) {
    failed++;
    console.log(`✗ lookup(${phrase}) = ${dict.lookup(phrase)}，期望和 ${same}（${dict.lookup(same)}）相同`);
  }
}
// 常见的拼写错误：lookup 查不到（不能当别名，免得掩盖写错），typo 给出正确的标签
for (const [wrong, right] of [['worth quality', 'worst quality'], ['absurdes', 'absurdres'], ['missing fngers', 'missing finger']]) {
  const hint = dict.typo(wrong);
  if (dict.lookup(wrong) !== null || !hint || hint.tag !== right || hint.zh !== dict.lookup(right)) {
    failed++;
    console.log(`✗ ${wrong}：lookup = ${dict.lookup(wrong)}，typo = ${JSON.stringify(hint)}，期望提示 ${right}`);
  }
}
if (dict.typo('worst quality') !== null) {
  failed++;
  console.log('✗ 写对的标签不应该提示拼错');
}
// 词典里没有的词组按词拼译名：只用通用标签和常用词（neon 是人物「尼恩」，不能拼进去），本身就是标签的不拼
{
  const cases = [
    ['dog plushie', (g) => g === '狗·毛绒动物玩具'],
    ['bed of roses', (g) => g === '玫瑰的床'],
    ['neon window', (g) => !(g || '').includes('尼恩')],
    ['long hair', (g) => g === null],
    ['qwerty zzz', (g) => g === null],
  ];
  for (const [phrase, ok] of cases) {
    if (!ok(dict.gloss(phrase))) {
      failed++;
      console.log(`✗ gloss(${phrase}) = ${dict.gloss(phrase)}`);
    }
  }
}
// 单复数变体不能把常用词变成别的意思：shorts → short、人物作品名 minis → mini
for (const [tag, wrong] of [['short', '短裤'], ['sweet', '甜食'], ['flat', '平底鞋'], ['mini', '米妮'], ['loves', '中二病']]) {
  if ((dict.lookup(tag) || '').includes(wrong)) {
    failed++;
    console.log(`✗ lookup(${tag}) = ${dict.lookup(tag)}，不应该是「${wrong}」`);
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

// 中文对照：按 NovelAI 的分隔符和权重写法切出标签，位置要能对回原文
{
  const s =
    '1girl, {{cat girl}}, 1.2::smile, looking at viewer::, [blush]|source#hugging, artist:foo, -1::bad hands::、 .5::x::\nnext line, ' +
    '(big hair:1.5), ((masterpiece)), (albedo (overlord):1.2), (best quality, open mouth), albedo (overlord), 16:9';
  const got = ctx.promptTags(s);
  const want = [
    ['1girl', '1girl'],
    ['cat girl', 'cat girl'],
    ['smile', 'smile'],
    ['looking at viewer', 'looking at viewer'],
    ['blush', 'blush'],
    ['source#hugging', 'hugging'],
    ['artist:foo', 'artist:foo'],
    ['bad hands', 'bad hands'],
    ['x', 'x'],
    ['next line', 'next line'],
    // Stable Diffusion 的括号和权重：查词典时去掉，标签名自带的括号保留
    ['(big hair:1.5)', 'big hair'],
    ['((masterpiece))', 'masterpiece'],
    ['(albedo (overlord):1.2)', 'albedo (overlord)'],
    ['(best quality', 'best quality'],
    ['open mouth)', 'open mouth'],
    ['albedo (overlord)', 'albedo (overlord)'],
    ['16:9', '16:9'],
  ];
  // 别处抄来的写法：Negative prompt: 标题、Danbooru 网页侧栏、标注工具的置信度、全角括号逗号、零宽空格、括号连写、character: 前缀
  const zwsp = String.fromCharCode(0x200b);
  const s2 = `negative prompt:lowres, ? blue eyes 1.3m, long hair 0.845, （artist:hiten）, bad feet${zwsp}lowres, (artist:a)[[artist:b]], character:yazawa nico, smile;, ( , 1girl，solo`;
  const want2 = [
    ['negative prompt:lowres', 'lowres'],
    ['? blue eyes 1.3m', 'blue eyes'],
    ['long hair 0.845', 'long hair'],
    ['（artist:hiten）', 'artist:hiten'],
    ['bad feet', 'bad feet'],
    ['lowres', 'lowres'],
    ['(artist:a)', 'artist:a'],
    ['artist:b', 'artist:b'],
    ['character:yazawa nico', 'yazawa nico'],
    ['smile;', 'smile'],
    ['1girl', '1girl'],
    ['solo', 'solo'],
  ];
  const got2 = ctx.promptTags(s2);
  if (JSON.stringify(got2.map((t) => [t.text, t.tag])) !== JSON.stringify(want2) || got2.some((t) => s2.slice(t.start, t.end) !== t.text)) {
    failed++;
    console.log(`✗ promptTags 整理抄来的写法不对：${JSON.stringify(got2)}`);
  }
  // 句号隔开的、括号后面紧跟着的再切开；缩写后面的句号不切
  const s3 =
    'vibrant. happy. large breasts, (wlop)year 2023, st. louis (azur lane), mr. game & watch, ' +
    'saber (fate) (cosplay), (curly) hair, absurdly (long hair:1.5), purple ribbon in ((black twintails))';
  const want3 = [
    ['vibrant.', 'vibrant'],
    ['happy.', 'happy'],
    ['large breasts', 'large breasts'],
    ['(wlop)', 'wlop'],
    ['year 2023', 'year 2023'],
    ['st. louis (azur lane)', 'st. louis (azur lane)'],
    ['mr. game & watch', 'mr. game & watch'],
    // 两层出处括号不切开；夹在中间的 Stable Diffusion 括号查词典时去掉
    ['saber (fate) (cosplay)', 'saber (fate) (cosplay)'],
    ['(curly) hair', 'curly hair'],
    ['absurdly (long hair:1.5)', 'absurdly long hair'],
    ['purple ribbon in ((black twintails))', 'purple ribbon in black twintails'],
  ];
  const got3 = ctx.promptTags(s3);
  if (JSON.stringify(got3.map((t) => [t.text, t.tag])) !== JSON.stringify(want3) || got3.some((t) => s3.slice(t.start, t.end) !== t.text)) {
    failed++;
    console.log(`✗ promptTags 句号、括号连写切分不对：${JSON.stringify(got3)}`);
  }
  if (JSON.stringify(got.map((t) => [t.text, t.tag])) !== JSON.stringify(want) || got.some((t) => s.slice(t.start, t.end) !== t.text)) {
    failed++;
    console.log(`✗ promptTags 切分不对：${JSON.stringify(got)}`);
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
