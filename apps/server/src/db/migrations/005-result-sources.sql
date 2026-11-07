ALTER TABLE assets ADD COLUMN source_snapshot TEXT NOT NULL DEFAULT 'null';
ALTER TABLE team_workflows ADD COLUMN source_snapshot TEXT NOT NULL DEFAULT 'null';
