# NovelAI Tag Editor

社区标签译名的编辑器，部署在 <https://novelai.000.moe>，仿照 EhTagTranslation 的 [EhTag Editor](https://ehtt.vercel.app)：

- 列表页按类别（通用、角色、作品、元标签）筛选，用普通文字或 `/正则/` 搜索，分页、排序；「显示」里可以只看未翻译或社区修订过的标签。
- 编辑页左边是表单（名称、检索词、修改说明），右边是预览、Danbooru 信息和这个标签的编辑日志。
- 用 GitHub 登录后才能提交。修改先存为待审核，审核员（`wrangler.toml` 的 `REVIEWERS`）在 `/review` 或编辑页上通过后，才由 GitHub App 以提交的人为作者提交到仓库的 [`data/zh-community.tsv`](../data/zh-community.tsv)，提交说明最后用 `Reviewed-by` 注明审核员；驳回时可以写原因。审核员自己的修改直接提交。历史就是 git 历史，改错了再改或回滚提交。
- 待审核的修改公开列在 `/review`，列表页和编辑页也会标出来；每人在右上角菜单的「我的提交」里看自己的修改是否通过。同一个人对同一个标签只留最新的一份待审核修改；还没审核的修改可以在编辑页的「待审核的修改」或「我的提交」里撤回，改回现在的内容再提交也是撤回。通过前这个标签又被改过（比如先通过了别人的修改）时，这份修改不能直接通过，只能驳回让提交的人重新改。
- 脚本和扩展从 GitHub 拉这个文件（`package.json` 的 `nzh.communityData`），不经过编辑器。

只开放标签译名：名称和检索词必须含汉字、长度有限，不能有 `<` `>`、控制字符和网址，编辑器和扩展两边都会检查。界面文案仍随版本打包。扩展给词典里已有的标签换译名、加检索词，也收录审核通过的新标签，包括没有 Danbooru 图片数的描述词（如 `location → 场景`）。图片数只作为可选的排序信息，不是收录条件。新标签点选后原样插入提示词，所以标签名不能含逗号、`|`、大括号、方括号、`#`、`::` 这类 NovelAI 的分隔符和权重语法。

防止滥用：GitHub 账号要注册满 `MIN_ACCOUNT_DAYS` 天（默认 30），每人每小时最多提交 `EDITS_PER_HOUR` 次（默认 30，审核员不限），`BLOCKED_USERS` 里的账号不能编辑。编辑页打开后别人改过同一个标签时，提交会被拒绝，不会覆盖。

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
| `PUT /api/tags/标签` | 修改 `{ label, aliases, note, base }`，需要登录；不是审核员时存为待审核，返回 202 |
| `GET /api/submissions?status=&tag=&user=&user_id=` | 提交的修改，`status` 默认 `pending`，可选 `approved`、`rejected`、`withdrawn`、`all`；`user` 按用户名、`user_id` 按 GitHub 用户 id 筛选 |
| `POST /api/submissions/编号/approve` | 通过并提交到 GitHub，只有审核员能用 |
| `POST /api/submissions/编号/reject` | 驳回 `{ reason }`，只有审核员能用 |
| `POST /api/submissions/编号/withdraw` | 提交的人撤回自己待审核的修改 |
| `GET /api/history?tag=` | 编辑日志（已提交到 GitHub 的修改） |
| `GET /api/tags` | 从 Danbooru 拉来的新标签 |
| `POST /api/admin/tags` | 存入 Danbooru 新标签，凭 `ADMIN_TOKEN` |

## 新标签

「未翻译」里的新标签是 Danbooru 上图片数 50 以上、词典（`dist/zh-tags.tsv`）里还没有的标签（通用、作品、角色、元标签，不含画师）：同步时按 id 翻完全部约 8 万个标签，按扩展查词典的方式（下划线也当空格）去掉词典里已有的，只交剩下的几千个。Danbooru 拒绝来自 Cloudflare Workers 的请求，所以在外面拉、交给 `/api/admin/tags` 存：GitHub Actions 每天跑一次 `scripts/sync-tags.mjs`（`.github/workflows/sync-tags.yml`），需要在仓库的 Secrets 里设置 `NZH_ADMIN_TOKEN`（即 `ADMIN_TOKEN`）。本地也可以跑：`NZH_ADMIN_TOKEN=口令 node scripts/sync-tags.mjs`。

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
4. `wrangler.toml` 的 `[vars]` 里改仓库名、分支、数据文件路径、审核员（`REVIEWERS`，填 GitHub 数字 id，用 `gh api users/用户名 --jq .id` 查）和防滥用设置；`routes` 绑定自定义域名，不用的话删掉，用 `workers.dev` 的地址。
5. 把编辑器地址填进仓库根目录 `package.json` 的 `nzh.editorUrl`（扩展面板的「参与翻译」链接、`scripts/sync-tags.mjs` 用），数据文件的 raw 地址填进 `nzh.communityData`，重新构建发布。

更新到含持久发布操作的版本时，先按下面的升级步骤处理，再部署。此后重新执行 `schema.sql` 或迁移文件均可重复运行。

### 已有数据库升级

1. 暂停旧 Worker 的写入，并等待旧版本所有审核请求结束。不要让旧、新版本同时处理写入；旧版本不知道新的发布身份和唯一约束。备份 D1 数据库。
2. 检查旧数据里的 `status = 'approving'`：旧版没有保存发布操作身份，不能用“超过两分钟”推断 GitHub 请求已经停止。确认旧请求全部结束后，核对 GitHub 文件提交、作者和审核说明；已经发布的记录补齐对应 `edits` 和 `approved`/`sha`，确实未发布的记录才改回 `pending`。不能确认的记录保留并人工核查，不要直接驳回或批量重置。
3. 在 `worker/` 目录执行 `npx wrangler d1 execute novelai-cn --remote --file=migrations/0001-publication-operations.sql`，再部署新 Worker、恢复写入。首次安装仍运行 `schema.sql`。这些命令由维护者在实际部署时运行；本次代码修复没有执行线上迁移。

迁移只新增表和索引，不要求重建已有表或添加已有列。若历史数据有同一用户、同一标签的多份活跃修改，迁移保留最新一份（已有 `approving` 优先），其余改为 `withdrawn`，保留内容和历史。部分唯一索引覆盖 `pending` 和 `approving`；新版本的替换和撤回旧记录/插入新记录在同一个 D1 `batch()` 事务内完成，失败会整体回滚。迁移和完整初始化 SQL 都有重复执行测试。

### 发布中断与恢复

发布前将操作 UUID、提交人/审核员、内容、固定父提交和时间戳写入 `publication_operations`。Git Data API 用这些固定字段生成相同的树与提交对象；提交说明含 `NovelAI-Operation: UUID`。提交 SHA 持久化后才以 `force: false` 更新分支。重试通过提交祖先关系识别该操作是否已经发布，不会把后来其他人的同值修改当成本次发布，也不会重复提交或重复写编辑历史。分支出现不相关的新提交时，旧候选提交已无法快进，才会基于新版本重新准备并重新检查 `base`。

只有尚未准备发布内容的 `preparing` 操作可以超时接管或驳回，接管会改变所有权令牌，旧请求不能再发布或更改状态。`publishing` 永不按时间释放：网络错误、Worker 中断或 D1 记账失败后，审核列表仍显示“正在提交”，审核员点“继续提交”即可恢复；提交人不能撤回，审核员不能驳回。默认待审核列表仍包含这类记录，但单条 API 状态为 `publishing`。审核员直接修改失败时，用同样内容和 `base` 重试原请求。GitHub 已发布后，编辑历史、审核状态和操作完成状态在同一个 D1 事务中提交。

目标分支应禁止强制推送/删除，审核发布期间不要重写其历史；重试的安全依据是分支只能快进。若外部强制回退了分支，操作会保持“正在提交”而不会自动恢复被移除的历史，维护者应先核对分支。GitHub/D1 持续不可用时重试会继续报错，保留操作供服务恢复后继续。候选 Git 对象在分支竞争时可能成为不可达对象，它们不是额外的分支提交。

实现依据：[D1 batch 事务与回滚](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)、[创建固定 Git 提交](https://docs.github.com/en/rest/git/commits#create-a-commit)、[非强制更新分支](https://docs.github.com/en/rest/git/refs#update-a-reference)。

## 测试

```sh
npm run test:worker    # 在仓库根目录执行；用 Node 自带的 SQLite 模拟 D1、用假的 GitHub 代替网络，需要 Node.js 22.13 或更高版本
```
