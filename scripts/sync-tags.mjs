// 从 Danbooru 拉最新创建的标签，交给社区标签编辑器（worker/）存起来，编辑器的「未翻译」据此列出词典里还没有的新标签。
// Danbooru 拒绝来自 Cloudflare Workers 的请求，所以在这里拉；GitHub Actions 每天跑一次（.github/workflows/sync-tags.yml）。
// NZH_ADMIN_TOKEN=口令 node scripts/sync-tags.mjs [编辑器地址，默认取 package.json 的 nzh.editorUrl]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { danbooruTagsUrl, DANBOORU_PAGES } from '../worker/src/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const base = (process.argv[2] || pkg.nzh?.editorUrl || '').replace(/\/+$/, '');
const token = process.env.NZH_ADMIN_TOKEN;
if (!base || !token) {
  console.error('需要编辑器地址（package.json 的 nzh.editorUrl 或命令行参数）和环境变量 NZH_ADMIN_TOKEN');
  process.exit(1);
}

const tags = [];
for (let page = 1; page <= DANBOORU_PAGES; page++) {
  const res = await fetch(danbooruTagsUrl(page), { headers: { 'User-Agent': `NovelAI-CN tag sync (+${pkg.homepage || 'https://github.com/TomorrowX6/NovelAI-CN'})` } });
  if (!res.ok) throw new Error(`Danbooru 第 ${page} 页：HTTP ${res.status}`);
  const list = await res.json();
  tags.push(...list);
  if (list.length < 1000) break;
}

const res = await fetch(`${base}/api/admin/tags`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tags }),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(`编辑器：HTTP ${res.status} ${data.error || ''}`);
console.log(`从 Danbooru 拉到 ${tags.length} 个标签，编辑器存下 ${data.stored} 个（不含画师和不安全的标签名）`);
