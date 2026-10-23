-- 初始化：npx wrangler d1 execute novelai-cn --remote --file=schema.sql
-- 社区译名本身存在 GitHub 仓库的 data/zh-community.tsv 里，这里只放辅助数据。

-- 编辑日志：编辑页的「编辑日志」和每人每小时的修改次数限制都看这里；完整的历史是 git 历史
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
