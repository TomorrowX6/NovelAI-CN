-- Idempotent upgrade: run only after the old Worker has stopped serving writes.
CREATE TABLE IF NOT EXISTS publication_operations (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL,
  submission_id INTEGER,
  phase TEXT NOT NULL,
  owner TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  details TEXT NOT NULL,
  candidate TEXT,
  outcome TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS publication_active_key ON publication_operations(request_key)
  WHERE phase IN ('preparing', 'publishing');
CREATE INDEX IF NOT EXISTS publication_submission ON publication_operations(submission_id);

-- Keep the newest active submission; preserve superseded rows as withdrawn history.
-- Prefer an approving record over a pending record. Legacy approvals need the
-- quiescence/reconciliation procedure in README before this upgrade.
UPDATE submissions SET status = 'withdrawn'
WHERE status IN ('pending', 'approving') AND id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY tag, user_id ORDER BY (status = 'approving') DESC, created_at DESC, id DESC
    ) AS position FROM submissions WHERE status IN ('pending', 'approving')
  ) WHERE position > 1
);
CREATE UNIQUE INDEX IF NOT EXISTS submissions_one_active ON submissions(tag, user_id)
  WHERE status IN ('pending', 'approving');
