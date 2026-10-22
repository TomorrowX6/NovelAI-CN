# 社区标签译名平台

任何人都可以在这里提交标签的中文译名和检索词，审核通过后，扩展和用户脚本每 3 小时拉一次已采纳的修订，覆盖内置词典里对应标签的显示译名、追加检索词。

只开放标签译名：译名和检索词必须含汉字、长度有限，不能有 `<` `>`、控制字符和网址，Worker 和扩展两边都会检查。界面文案仍随版本打包。

扩展只给词典里已有的标签换译名、加检索词；词典里没有的标签，只有平台从 Danbooru 拉来的新标签（`/api/overrides` 里带 Danbooru 图片数 `count`）才会新增。新标签点选后原样插入提示词，所以标签名不能含逗号、`|`、括号、`#`、`::` 这类 NovelAI 的分隔符和权重语法，平台存的时候和扩展收的时候都会检查。

跑在 Cloudflare Workers 上，数据存在 D1，免费额度足够用。

| 地址 | 用途 |
| --- | --- |
| `/` | 提交页：搜标签、看当前译名、提交新译名或检索词 |
| `/admin` | 审核页，用 `ADMIN_TOKEN` 登录；审核时可以改提交的内容，已采纳的可以撤销 |
| `/api/overrides` | 已采纳的修订（JSON，允许跨域，边缘缓存 5 分钟，审核后立即清掉） |
| `/api/tags` | 从 Danbooru 拉来的新标签（JSON，边缘缓存 1 小时） |
| `/api/pending` | 有待审核提交的标签，提交页用来标出「待审核」 |
| `/api/export.csv` | 已采纳的修订，按 `data/zh-override.csv`、`data/zh-extra.csv` 的格式导出 |
| `/api/admin/tags` | 存入从 Danbooru 拉来的标签，凭 `ADMIN_TOKEN` |

提交只记录加盐哈希后的 IP，用来限制频率（每个 IP 每小时 20 条）。可以再加上 Cloudflare Turnstile 人机验证。

## 新标签

提交页的「未翻译」列出 Danbooru 上最新创建、图片数 50 以上的标签（通用、作品、角色、元标签，不含画师）中词典里还没有的。Danbooru 拒绝来自 Cloudflare Workers 的请求，所以在外面拉、交给 `/api/admin/tags` 存：

- GitHub Actions 每天跑一次 `scripts/sync-tags.mjs`（`.github/workflows/sync-tags.yml`），需要在仓库的 Secrets 里设置 `NZH_ADMIN_TOKEN`（即 `ADMIN_TOKEN`）。本地也可以跑：`NZH_ADMIN_TOKEN=口令 node scripts/sync-tags.mjs`。
- 审核页的「拉取新标签」在管理员自己的浏览器里请求 Danbooru。

## 部署

需要 Node.js 18 或更高版本和一个 Cloudflare 账号。以下命令都在 `worker/` 目录里执行。

```sh
npx wrangler login                     # 浏览器里授权；也可以设置环境变量 CLOUDFLARE_API_TOKEN
npx wrangler d1 create novelai-cn      # 把输出的 database_id 填进 wrangler.toml
npx wrangler d1 execute novelai-cn --remote --file=schema.sql
npx wrangler deploy
npx wrangler secret put ADMIN_TOKEN    # 审核页口令，用一个长的随机串
npx wrangler secret put IP_SALT        # 随机串，给 IP 加盐哈希用
```

`wrangler.toml` 里的 `routes` 把 Worker 绑到自定义域名 `novelai.000.moe`，这个域要在同一个 Cloudflare 账号里。不用自定义域名的话删掉 `routes`，用 `https://novelai-cn.<你的子域>.workers.dev`。

部署好后先跑一次 `scripts/sync-tags.mjs` 拉新标签，再把地址填进仓库根目录 `package.json` 的 `nzh.communityUrl`，重新构建、调高版本号发布，扩展和脚本就会开始拉取。留空则不拉取。

可选：

- Turnstile：在 Cloudflare 后台创建一个 Turnstile 小组件（域名填 Worker 的域名），把站点密钥填进 `wrangler.toml` 的 `TURNSTILE_SITE_KEY`，再 `npx wrangler secret put TURNSTILE_SECRET`。
- `DICT_URL`：提交页用来搜索的词典，默认是 GitHub 上 main 分支的 `dist/zh-tags.tsv`。

## 发版时并入词典

扩展实时用上的修订只存在平台上。发版前打开 `/api/export.csv`，把两段内容分别并进 `data/zh-override.csv`（替换译名）和 `data/zh-extra.csv`（追加检索词），构建发布。词典里原来没有的标签只能这样加进去。

## 测试

```sh
npm run test:worker    # 在仓库根目录执行；用 Node 自带的 SQLite 模拟 D1，需要 Node.js 22.13 或更高版本
```
