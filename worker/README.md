# NovelAI Tag Editor

社区标签译名的编辑器，部署在 <https://novelai.000.moe>，仿照 EhTagTranslation 的 [EhTag Editor](https://ehtt.vercel.app)：

- 列表页按类别（通用、角色、作品、元标签）筛选，用普通文字或 `/正则/` 搜索，分页、排序；「显示」里可以只看未翻译或社区修订过的标签。
- 编辑页左边是表单（名称、检索词、修改说明），右边是预览、Danbooru 信息和这个标签的编辑日志。
- 用 GitHub 登录后才能提交。修改由 GitHub App 以登录用户为作者提交到仓库的 [`data/zh-community.tsv`](../data/zh-community.tsv)，立即生效，不经审核；历史就是 git 历史，改错了再改或回滚提交。
- 脚本和扩展从 GitHub 拉这个文件（`package.json` 的 `nzh.communityData`），不经过编辑器。

只开放标签译名：名称和检索词必须含汉字、长度有限，不能有 `<` `>`、控制字符和网址，编辑器和扩展两边都会检查。界面文案仍随版本打包。扩展只给词典里已有的标签换译名、加检索词；词典里没有的标签，只有编辑器从 Danbooru 拉来的新标签（数据文件里带图片数）才会新增。新标签点选后原样插入提示词，所以标签名不能含逗号、`|`、括号、`#`、`::` 这类 NovelAI 的分隔符和权重语法。

防止滥用：GitHub 账号要注册满 `MIN_ACCOUNT_DAYS` 天（默认 30），每人每小时最多 `EDITS_PER_HOUR` 次（默认 30），`BLOCKED_USERS` 里的账号不能编辑。编辑页打开后别人改过同一个标签时，提交会被拒绝，不会覆盖。

## 数据文件

`data/zh-community.tsv` 一个标签一行，按标签排序，`#` 开头是说明：

```
英文标签<Tab>名称<Tab>检索词（/ 分隔）<Tab>Danbooru 图片数（只有编辑器拉来的新标签有）
```

名称留空表示沿用词典译名、只加检索词。文件由编辑器第一次提交时创建。也可以直接改这个文件提 PR。CI 不会因为只改了这个文件而运行。

## 接口

| 地址 | 用途 |
| --- | --- |
| `/`、`/list/类别`、`/edit/标签` | 编辑器页面 |
| `/zh-tags.tsv` | 带类别的词典（`wrangler.toml` 的 `[assets]` 把 `dist/` 一起部署） |
| `/auth/login`、`/auth/callback`、`/auth/logout` | GitHub 登录。登录状态是签名的 Cookie，只存用户名、id 和头像，不存 GitHub 令牌 |
| `GET /api/community` | 数据文件的当前内容（从 GitHub 读，缓存 30 秒） |
| `PUT /api/tags/标签` | 修改 `{ label, aliases, note, base }`，需要登录 |
| `GET /api/history?tag=` | 编辑日志 |
| `GET /api/tags` | 从 Danbooru 拉来的新标签 |
| `POST /api/admin/tags` | 存入 Danbooru 新标签，凭 `ADMIN_TOKEN` |

## 新标签

「未翻译」里的新标签是 Danbooru 上最新创建、图片数 50 以上的标签（通用、作品、角色、元标签，不含画师）。Danbooru 拒绝来自 Cloudflare Workers 的请求，所以在外面拉、交给 `/api/admin/tags` 存：GitHub Actions 每天跑一次 `scripts/sync-tags.mjs`（`.github/workflows/sync-tags.yml`），需要在仓库的 Secrets 里设置 `NZH_ADMIN_TOKEN`（即 `ADMIN_TOKEN`）。本地也可以跑：`NZH_ADMIN_TOKEN=口令 node scripts/sync-tags.mjs`。

## 部署

需要 Node.js 18 或更高版本、一个 Cloudflare 账号和一个 GitHub App。以下命令都在 `worker/` 目录里执行。

1. **GitHub App**：在 GitHub 的 Settings → Developer settings → GitHub Apps 新建一个：
   - Callback URL 填 `https://你的域名/auth/callback`，不要勾选 Webhook 的 Active；
   - Repository permissions 里 Contents 选 Read and write，其他都不要；
   - 选 Any account（公开），其他 GitHub 用户才能用它登录；
   - 创建后生成一个 private key，再把 App 安装到仓库（Only select repositories）。
2. **Cloudflare**：

   ```sh
   npx wrangler login
   npx wrangler d1 create novelai-cn      # 把输出的 database_id 填进 wrangler.toml
   npx wrangler d1 execute novelai-cn --remote --file=schema.sql
   cd .. && npm run build && cd worker    # [assets] 部署 dist/
   npx wrangler deploy
   ```

3. **机密**（`npx wrangler secret put 名字`）：`GH_APP_ID`、`GH_APP_KEY`（App 的私钥，先转成 PKCS#8：`openssl pkcs8 -topk8 -nocrypt -in key.pem`）、`GH_CLIENT_ID`、`GH_CLIENT_SECRET`、`GH_INSTALLATION_ID`（可选）、`SESSION_SECRET`（随机串）、`ADMIN_TOKEN`（随机串）。
4. `wrangler.toml` 的 `[vars]` 里改仓库名、分支、数据文件路径和防滥用设置；`routes` 绑定自定义域名，不用的话删掉，用 `workers.dev` 的地址。
5. 把编辑器地址填进仓库根目录 `package.json` 的 `nzh.editorUrl`（扩展面板的「参与翻译」链接、`scripts/sync-tags.mjs` 用），数据文件的 raw 地址填进 `nzh.communityData`，重新构建发布。

## 测试

```sh
npm run test:worker    # 在仓库根目录执行；用 Node 自带的 SQLite 模拟 D1、用假的 GitHub 代替网络，需要 Node.js 22.13 或更高版本
```
