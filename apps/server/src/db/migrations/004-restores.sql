CREATE TABLE IF NOT EXISTS restores (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('preview', 'confirmed', 'cancelled', 'failed')),
  source_name TEXT NOT NULL,
  staged_dir TEXT NOT NULL,
  new_dataset_id TEXT,
  previous_dataset_id TEXT,
  exported_at TEXT,
  record_counts TEXT NOT NULL DEFAULT '{}',
  file_count INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  finished_at TEXT
);
