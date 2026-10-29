-- 初始化：npx wrangler d1 execute novelai-cn --remote --file=schema.sql
-- 社区译名本身存在 GitHub 仓库的 data/zh-community.tsv 里，这里只放辅助数据。

-- 待审核的修改：不是审核员（wrangler.toml 的 REVIEWERS）的人提交的修改先存在这里，审核员通过后才提交到 GitHub。
-- 每人每小时的提交次数限制也看这里
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL,
  user_id INTEGER NOT NULL,                -- 提交的人的 GitHub 用户 id
  login TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,                    -- 提交时算出的 add 新增 / update 修改 / delete 删除
  label TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '',        -- / 分隔
  note TEXT NOT NULL DEFAULT '',
  base TEXT NOT NULL DEFAULT 'null',       -- 提交时这个标签的社区修订 { label, aliases }（JSON），通过时据此判断后来有没有被改过
  status TEXT NOT NULL DEFAULT 'pending',  -- pending 待审核 / approving 审核员正在通过（提交到 GitHub 期间）/ approved 已通过 / rejected 已驳回 / withdrawn 已撤回（或被同一个人的新修改替换）
  reviewer TEXT NOT NULL DEFAULT '',       -- 审核员的 GitHub 用户名
  reason TEXT NOT NULL DEFAULT '',         -- 驳回原因
  sha TEXT NOT NULL DEFAULT '',            -- 通过后提交的 sha
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER                      -- 审核或撤回的时间；approving 时是开始通过的时间
);
CREATE INDEX IF NOT EXISTS submissions_status ON submissions (status, created_at);
CREATE INDEX IF NOT EXISTS submissions_tag ON submissions (tag, status);
CREATE INDEX IF NOT EXISTS submissions_user ON submissions (user_id, created_at);

-- 编辑日志：已提交到 GitHub 的修改，编辑页的「编辑日志」看这里；完整的历史是 git 历史
CREATE TABLE IF NOT EXISTS edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL,
  user_id INTEGER NOT NULL,                -- GitHub 用户 id
  login TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,                    -- add 新增 / update 修改 / delete 删除
  label TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '',        -- / 分隔
  note TEXT NOT NULL DEFAULT '',
  sha TEXT NOT NULL DEFAULT '',            -- 提交的 sha
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS edits_tag ON edits (tag, created_at);
CREATE INDEX IF NOT EXISTS edits_user ON edits (user_id, created_at);

-- 从 Danbooru 拉来的、词典里没有的标签（图片数够多的），编辑器的「未翻译」从这里找词典里还没有的
CREATE TABLE IF NOT EXISTS tags (
  tag TEXT PRIMARY KEY,                    -- 已规范化
  category INTEGER NOT NULL,               -- 0 通用 / 3 作品 / 4 角色 / 5 元标签
  count INTEGER NOT NULL,                  -- Danbooru 图片数
  created_at INTEGER NOT NULL,             -- 在 Danbooru 上创建的时间
  synced_at INTEGER NOT NULL
);
