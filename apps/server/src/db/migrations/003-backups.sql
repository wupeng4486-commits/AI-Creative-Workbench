CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'ready', 'failed')),
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  record_counts TEXT NOT NULL DEFAULT '{}',
  file_count INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  finished_at TEXT
);
