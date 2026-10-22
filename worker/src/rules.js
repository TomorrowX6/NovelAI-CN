// 提交内容的规则：Worker 收提交、出数据时用，scripts/test-worker.mjs 也直接测这里。
// 扩展端（src/community.js）会再按同样的规则检查一遍。

// 与 src/core.js 的 HAN_RE 相同：扩展 A、基本区、兼容汉字（U+F900 起，写成转义免得和普通的「豈」混淆）
export const HAN_RE = /[㐀-䶿一-鿿豈-﫿]/;
// 译名和检索词只在页面上当纯文字显示，仍然拒绝 < >、控制字符和网址，免得被拿去做引导或拼接
const UNSAFE = /[<>\u0000-\u001f\u007f]|[a-z][\w+.-]*:\/\/|javascript:|www\./i;
export const LIMITS = { tag: 100, label: 60, alias: 30, aliases: 8, note: 300 };

// 英文标签：可打印 ASCII，转小写、合并空白；含单词的标签把下划线换成空格（^_^ 这类表情保留下划线）
export function normalizeTag(tag) {
  if (typeof tag !== 'string') return null;
  let t = tag.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/[a-z]{2}/.test(t)) t = t.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t && t.length <= LIMITS.tag && /^[\x20-\x7e]+$/.test(t) ? t : null;
}

// 新标签点选后会原样插入提示词，不能含 NovelAI 的分隔符和权重语法
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

// 返回 { value } 或 { error }
export function validateSuggestion(body) {
  if (!body || typeof body !== 'object') return { error: '提交的内容格式不对' };
  const tag = normalizeTag(body.tag);
  if (!tag) return { error: '英文标签格式不对：只能用英文字母、数字和符号，最多 100 个字符' };
  let label = '';
  if (typeof body.label === 'string' && body.label.trim()) {
    label = cleanZh(body.label, LIMITS.label);
    if (!label) return { error: `译名必须含汉字，最多 ${LIMITS.label} 个字，不能有 < > 或网址` };
  }
  const aliases = parseAliases(body.aliases ?? []);
  if (!aliases) return { error: `检索词最多 ${LIMITS.aliases} 个，每个必须含汉字、最多 ${LIMITS.alias} 个字，不能有 < > 或网址` };
  if (!label && !aliases.length) return { error: '请填写新译名或检索词' };
  const note = typeof body.note === 'string' ? body.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.note) : '';
  return { value: { tag, label, aliases, note } };
}

// 已采纳的提交（按采纳时间先后）合成每个标签的最终修订：译名取最后采纳的，检索词合并、保留最新的若干个。
// 自动拉取的新标签带上 Danbooru 图片数（count），扩展据此把词典里没有的新标签加进去
export function aggregate(rows) {
  const byTag = new Map();
  for (const r of rows) {
    const e = byTag.get(r.tag) || { tag: r.tag, label: '', aliases: [] };
    if (r.count > 0) e.count = r.count;
    if (r.label) e.label = r.label;
    let aliases = [];
    try {
      aliases = JSON.parse(r.aliases || '[]');
    } catch {}
    for (const a of aliases) {
      e.aliases = e.aliases.filter((x) => x !== a);
      e.aliases.push(a);
    }
    e.aliases = e.aliases.slice(-LIMITS.aliases);
    byTag.set(r.tag, e);
  }
  return [...byTag.values()];
}

const csvField = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// 导出成仓库里 data/zh-override.csv（译名）和 data/zh-extra.csv（检索词）的格式，发版时并进词典
export function toCsv(entries) {
  const override = entries.filter((e) => e.label).map((e) => `${csvField(e.tag)},${csvField(e.label)}`);
  const extra = entries.filter((e) => e.aliases.length).map((e) => `${csvField(e.tag)},${csvField(e.aliases.join('/'))}`);
  return `# zh-override.csv\n${override.join('\n')}\n\n# zh-extra.csv\n${extra.join('\n')}\n`;
}
