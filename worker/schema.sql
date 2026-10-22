-- 社区标签译名的提交记录。初始化：npx wrangler d1 execute novelai-cn --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL,                       -- 英文标签（已规范化）
  label TEXT NOT NULL DEFAULT '',          -- 新译名，留空表示只加检索词
  aliases TEXT NOT NULL DEFAULT '[]',      -- 检索词，JSON 数组
  note TEXT NOT NULL DEFAULT '',           -- 提交者的说明，只给审核看
  status TEXT NOT NULL DEFAULT 'pending',  -- pending 待审核 / approved 已采纳 / rejected 已驳回 / reverted 已撤销
  ip_hash TEXT NOT NULL DEFAULT '',        -- 加盐哈希后的 IP，只用来限制提交频率
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS suggestions_status ON suggestions (status, reviewed_at);
CREATE INDEX IF NOT EXISTS suggestions_ip ON suggestions (ip_hash, created_at);

-- 定时从 Danbooru 拉来的新标签（最新创建、图片数够多的），提交页的「未翻译」从这里找词典里还没有的
CREATE TABLE IF NOT EXISTS tags (
  tag TEXT PRIMARY KEY,                    -- 已规范化
  category INTEGER NOT NULL,               -- 0 通用 / 3 作品 / 4 角色 / 5 元标签
  count INTEGER NOT NULL,                  -- Danbooru 图片数
  created_at INTEGER NOT NULL,             -- 在 Danbooru 上创建的时间
  synced_at INTEGER NOT NULL
);
