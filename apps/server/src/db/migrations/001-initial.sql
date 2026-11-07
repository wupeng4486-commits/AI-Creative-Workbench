PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'owned' CHECK (origin IN ('owned', 'shared')),
  author TEXT NOT NULL DEFAULT '本机用户',
  instructions TEXT NOT NULL DEFAULT '',
  output_requirements TEXT NOT NULL DEFAULT '',
  cautions TEXT NOT NULL DEFAULT '',
  example_dialog TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scenario TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'owned' CHECK (origin IN ('owned', 'shared')),
  author TEXT NOT NULL DEFAULT '本机用户',
  skill_type TEXT NOT NULL DEFAULT 'platform' CHECK (skill_type IN ('platform', 'libtv_reference')),
  tags TEXT NOT NULL DEFAULT '[]',
  input_spec TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '',
  output_spec TEXT NOT NULL DEFAULT '',
  examples TEXT NOT NULL DEFAULT '',
  external_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  selling_points TEXT NOT NULL DEFAULT '[]',
  package_version TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  relative_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  duration REAL,
  width INTEGER,
  height INTEGER,
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'quarantined')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  file_id TEXT REFERENCES files(id) ON DELETE RESTRICT,
  origin TEXT NOT NULL DEFAULT 'owned' CHECK (origin IN ('owned', 'shared')),
  provenance TEXT NOT NULL DEFAULT 'seed' CHECK (provenance IN ('seed', 'user_import', 'demo_result')),
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  catalog TEXT NOT NULL DEFAULT 'file',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'reference',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL REFERENCES case_collections(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'reference',
  PRIMARY KEY (collection_id, asset_id)
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  creation_type TEXT NOT NULL,
  name TEXT NOT NULL,
  requirements TEXT NOT NULL DEFAULT '',
  parameters TEXT NOT NULL DEFAULT '{}',
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  workflow_id TEXT REFERENCES team_workflows(id) ON DELETE SET NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  save_state TEXT NOT NULL DEFAULT 'saved',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_clips (
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  PRIMARY KEY (draft_id, position)
);

CREATE TABLE IF NOT EXISTS team_workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'owned' CHECK (origin IN ('owned', 'shared')),
  author TEXT NOT NULL DEFAULT '本机用户',
  libtv_ref TEXT NOT NULL DEFAULT '',
  input_spec TEXT NOT NULL DEFAULT '',
  default_parameters TEXT NOT NULL DEFAULT '{}',
  cover_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  steps TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  service_type TEXT NOT NULL,
  name TEXT NOT NULL,
  demo_config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  simulation_status TEXT NOT NULL DEFAULT 'unconfigured',
  last_simulated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  owner_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'stopped', 'interrupted')),
  input_snapshot TEXT NOT NULL DEFAULT '{}',
  parameters TEXT NOT NULL DEFAULT '{}',
  demo INTEGER NOT NULL DEFAULT 1,
  result TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS run_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  item_status TEXT NOT NULL DEFAULT 'queued',
  result TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS run_files (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  PRIMARY KEY (run_id, file_id, role)
);

CREATE TABLE IF NOT EXISTS archives (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  result_item_id TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, result_item_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  display_snapshot TEXT NOT NULL DEFAULT '{}',
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recent_items (
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  display_snapshot TEXT NOT NULL DEFAULT '{}',
  visited_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS seed_state (
  seed_key TEXT PRIMARY KEY,
  seed_version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_tombstones (
  seed_id TEXT PRIMARY KEY,
  removed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  batch_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source, batch_key)
);

CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS agent_assets (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (agent_id, asset_id)
);

CREATE TABLE IF NOT EXISTS agent_products (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  PRIMARY KEY (agent_id, product_id)
);

CREATE TABLE IF NOT EXISTS draft_assets (
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (draft_id, asset_id)
);

CREATE TABLE IF NOT EXISTS draft_skills (
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  PRIMARY KEY (draft_id, skill_id)
);

CREATE TABLE IF NOT EXISTS workflow_skills (
  workflow_id TEXT NOT NULL REFERENCES team_workflows(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  PRIMARY KEY (workflow_id, skill_id)
);

CREATE TABLE IF NOT EXISTS workflow_assets (
  workflow_id TEXT NOT NULL REFERENCES team_workflows(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'sample',
  PRIMARY KEY (workflow_id, asset_id, role)
);

CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_origin ON assets(origin);
CREATE INDEX IF NOT EXISTS idx_agents_origin ON agents(origin);
CREATE INDEX IF NOT EXISTS idx_skills_origin ON skills(origin);
CREATE INDEX IF NOT EXISTS idx_workflows_origin ON team_workflows(origin);
CREATE INDEX IF NOT EXISTS idx_drafts_updated ON drafts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_owner ON runs(kind, owner_id);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);
