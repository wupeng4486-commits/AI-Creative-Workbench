import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { nowIso } from "../util/time.ts";
import { newId } from "../util/id.ts";

export interface Migration {
  id: string;
  file: string;
}

export const MIGRATIONS: Migration[] = [{ id: "001-initial", file: "001-initial.sql" }];

export function migrationsDir(): string {
  return path.join(import.meta.dirname, "migrations");
}

export function currentSchemaVersion(db: Database.Database): number {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!table) return 0;
  const row = db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as {
    count: number;
  };
  return row.count;
}

export function runMigrations(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  for (const migration of MIGRATIONS) {
    const applied = db
      .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
      .get(migration.id);
    if (applied) continue;
    const sql = fs.readFileSync(path.join(migrationsDir(), migration.file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)",
      ).run(migration.id, nowIso());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function recordMigration(db: Database.Database, id: string): void {
  db.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
    id,
    nowIso(),
  );
}

export function migrationId(prefix: string): string {
  return `${prefix}-${newId().slice(0, 8)}`;
}
