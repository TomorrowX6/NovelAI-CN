// 从 Danbooru 拉全部图片数够多的标签，把词典（dist/zh-tags.tsv）里还没有的交给社区标签编辑器（worker/）存起来，
// 编辑器的「未翻译」据此列出它们。
// Danbooru 拒绝来自 Cloudflare Workers 的请求，所以在这里拉；GitHub Actions 每天跑一次（.github/workflows/sync-tags.yml）。
// NZH_ADMIN_TOKEN=口令 node scripts/sync-tags.mjs [编辑器地址，默认取 package.json 的 nzh.editorUrl]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { danbooruTagsUrl, DANBOORU_PAGE_SIZE, dictionaryLookup, MAX_TAGS_PER_POST } from '../worker/src/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const base = (process.argv[2] || pkg.nzh?.editorUrl || '').replace(/\/+$/, '');
const token = process.env.NZH_ADMIN_TOKEN;
if (!base || !token) {
  console.error('需要编辑器地址（package.json 的 nzh.editorUrl 或命令行参数）和环境变量 NZH_ADMIN_TOKEN');
  process.exit(1);
}
const inDict = dictionaryLookup(fs.readFileSync(path.join(ROOT, 'dist', 'zh-tags.tsv'), 'utf8'));

// 要翻八十来页，偶尔的限流和 5xx 重试几次，不让整次同步失败
async function danbooru(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': `NovelAI-CN tag sync (+${pkg.homepage || 'https://github.com/TomorrowX6/NovelAI-CN'})` } });
    if (res.ok) return res.json();
    if (attempt >= 4 || !(res.status === 429 || res.status >= 500)) throw new Error(`Danbooru：HTTP ${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

let total = 0;
let before = 0;
const tags = [];
for (;;) {
  const list = await danbooru(danbooruTagsUrl(before));
  total += list.length;
  tags.push(...list.filter((t) => !inDict(t.name)));
  if (list.length < DANBOORU_PAGE_SIZE) break;
  const next = Math.min(...list.map((t) => t.id));
  if (before && next >= before) throw new Error(`Danbooru 翻页没有往前走：${before} → ${next}`);
  before = next;
}

let stored = 0;
for (let i = 0; i < tags.length; i += MAX_TAGS_PER_POST) {
  const res = await fetch(`${base}/api/admin/tags`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: tags.slice(i, i + MAX_TAGS_PER_POST) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`编辑器：HTTP ${res.status} ${data.error || ''}`);
  stored += data.stored;
}
console.log(`从 Danbooru 拉到 ${total} 个标签，词典里没有的 ${tags.length} 个，编辑器存下 ${stored} 个（不含不安全的标签名）`);
