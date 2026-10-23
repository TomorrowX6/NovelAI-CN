// 社区标签译名的规则：数据格式、校验和编辑。Worker 用，scripts/test-worker.mjs 直接测，
// 扩展端（src/community.js）读同一份数据时再按同样的规则检查一遍。

// 与 src/core.js 的 HAN_RE 相同：扩展 A、基本区、兼容汉字
export const HAN_RE = new RegExp('[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]');
// 译名和检索词只当纯文字显示，仍然拒绝 < >、控制字符（含 Tab 和换行，数据文件用它们分隔）和网址
const UNSAFE = /[<>\u0000-\u001f\u007f]|[a-z][\w+.-]*:\/\/|javascript:|www\./i;
export const LIMITS = { tag: 100, label: 60, alias: 30, aliases: 8, note: 200 };

// 英文标签：可打印 ASCII，转小写、合并空白；含单词的标签把下划线换成空格（^_^ 这类表情保留下划线）
export function normalizeTag(tag) {
  if (typeof tag !== 'string') return null;
  let t = tag.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/[a-z]{2}/.test(t)) t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t && t.length <= LIMITS.tag && /^[\x20-\x7e]+$/.test(t) ? t : null;
}

// 词典里没有的标签点选后会原样插入提示词，不能含 NovelAI 的分隔符和权重语法
export function isSafeNewTag(tag) {
  return typeof tag === 'string' && /^[\x20-\x7e]{1,100}$/.test(tag) && !/[,|{}[\]#<>\\]|::/.test(tag);
}

// Danbooru /tags.json 的结果：只要通用、作品、角色、元标签（NovelAI 不认画师），图片数够多的
export const NEW_TAG_CATEGORIES = [0, 3, 4, 5];
export const NEW_TAG_MIN_COUNT = 50;
// 每次拉最新创建的 DANBOORU_PAGES × 1000 个；一页不满 1000 个就不用再翻
export const DANBOORU_PAGES = 3;
export function danbooruTagsUrl(page) {
  const u = new URL('https://danbooru.donmai.us/tags.json');
  u.searchParams.set('search[post_count]', `>=${NEW_TAG_MIN_COUNT}`);
  u.searchParams.set('search[category]', NEW_TAG_CATEGORIES.join(','));
  u.searchParams.set('search[is_deprecated]', 'false');
  u.searchParams.set('search[order]', 'date');
  u.searchParams.set('only', 'name,category,post_count,created_at');
  u.searchParams.set('limit', '1000');
  u.searchParams.set('page', String(page));
  return u.href;
}
export function parseDanbooruTags(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!t || !NEW_TAG_CATEGORIES.includes(t.category) || !(t.post_count >= NEW_TAG_MIN_COUNT)) continue;
    const tag = normalizeTag(t.name);
    if (!tag || !isSafeNewTag(tag)) continue;
    out.push({ tag, category: t.category, count: t.post_count, created_at: Date.parse(t.created_at) || 0 });
  }
  return out;
}

// 译名、检索词：必须含汉字
export function cleanZh(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/\s+/g, ' ');
  return t && t.length <= max && HAN_RE.test(t) && !UNSAFE.test(t) ? t : null;
}

// 检索词可以是数组，也可以是用 / 、，分隔的字符串；有一个不合格就整体不合格
export function parseAliases(input) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[/／、，,]/) : [];
  const out = [];
  for (const raw of list) {
    if (typeof raw === 'string' && !raw.trim()) continue;
    const a = cleanZh(raw, LIMITS.alias);
    if (!a) return null;
    if (!out.includes(a)) out.push(a);
  }
  return out.length <= LIMITS.aliases ? out : null;
}

// ---- 数据文件 data/zh-community.tsv ----
// 一个标签一行，按标签排序，方便看 diff 和逐行追溯：英文标签 \t 译名 \t 检索词（/ 分隔）\t Danbooru 图片数（只有词典里没有的新标签才有）
// # 开头的是说明。译名留空表示不改词典译名，只加检索词
export const COMMUNITY_HEADER = [
  '# 社区标签译名。在 https://novelai.000.moe 用 GitHub 登录后编辑，每次修改都会提交到这里；脚本和扩展默认每天从 GitHub 拉取一次。',
  '# 每行用 Tab 分隔：英文标签、译名、检索词（/ 分隔）、Danbooru 图片数（只有词典里没有的新标签才填）。译名留空表示只加检索词。',
];

// # 开头的说明行不保留，写回时换成当前的 COMMUNITY_HEADER，改了说明下次提交就会更新
export function parseCommunity(text) {
  const entries = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [tag, label = '', aliases = '', count = ''] = line.split('\t');
    if (!tag) continue;
    entries.set(tag, { tag, label, aliases: aliases ? aliases.split('/') : [], count: +count || 0 });
  }
  return { header: COMMUNITY_HEADER, entries };
}

export function serializeCommunity({ header, entries }) {
  const rows = [...entries.values()]
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .map((e) => [e.tag, e.label, e.aliases.join('/'), e.count || ''].join('\t').replace(/\t+$/, ''));
  return [...header, ...rows].join('\n') + '\n';
}

// 编辑页提交的内容：{ label, aliases, note }，返回 { value } 或 { error }
export function validateEdit(body) {
  if (!body || typeof body !== 'object') return { error: '提交的内容格式不对' };
  let label = '';
  if (typeof body.label === 'string' && body.label.trim()) {
    label = cleanZh(body.label, LIMITS.label);
    if (!label) return { error: `名称必须含汉字，最多 ${LIMITS.label} 个字，不能有 < > 或网址` };
  }
  const aliases = parseAliases(body.aliases ?? []);
  if (!aliases) return { error: `检索词最多 ${LIMITS.aliases} 个，每个必须含汉字、最多 ${LIMITS.alias} 个字，不能有 < > 或网址` };
  const note = typeof body.note === 'string' ? body.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.note) : '';
  return { value: { label, aliases, note } };
}

// 把一次编辑应用到数据上。译名和检索词都为空表示删除这一条
// 返回 { action: 'add' | 'update' | 'delete' | 'none', before, after }
export function applyEdit(data, tag, { label, aliases }, count = 0) {
  const before = data.entries.get(tag) || null;
  if (!label && !aliases.length) {
    if (!before) return { action: 'none', before, after: null };
    data.entries.delete(tag);
    return { action: 'delete', before, after: null };
  }
  const after = { tag, label, aliases, count: count || before?.count || 0 };
  if (before && before.label === after.label && before.aliases.join('/') === after.aliases.join('/') && before.count === after.count) {
    return { action: 'none', before, after: before };
  }
  data.entries.set(tag, after);
  return { action: before ? 'update' : 'add', before, after };
}

const ACTION_NAMES = { add: '新增', update: '修改', delete: '删除' };

// 提交说明第一行固定为「动作 标签」，编辑日志和 git log 都靠它找某个标签的修改
export function commitMessage(action, tag, after, note, user) {
  const lines = [`${ACTION_NAMES[action]} ${tag}`, ''];
  if (after) {
    if (after.label) lines.push(`名称：${after.label}`);
    if (after.aliases.length) lines.push(`检索词：${after.aliases.join('/')}`);
  }
  if (note) lines.push(`说明：${note}`);
  if (user) lines.push('', `Co-authored-by: ${user.login} <${user.id}+${user.login}@users.noreply.github.com>`);
  return lines.join('\n').replace(/\n+$/, '');
}
