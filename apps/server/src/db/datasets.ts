import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { nowIso } from "../util/time.ts";
import { runMigrations } from "./migrations.ts";

export interface ActivePointer {
  datasetId: string;
  activatedAt: string;
  previousDatasetId: string | null;
}

export interface DatasetPaths {
  root: string;
  datasetsRoot: string;
  staging: string;
  backups: string;
  logs: string;
}

export function datasetPaths(dataDir: string): DatasetPaths {
  return {
    root: dataDir,
    datasetsRoot: path.join(dataDir, "datasets"),
    staging: path.join(dataDir, "staging"),
    backups: path.join(dataDir, "backups"),
    logs: path.join(dataDir, "logs"),
  };
}

export function ensureDataDirs(dataDir: string): DatasetPaths {
  const paths = datasetPaths(dataDir);
  for (const dir of [
    paths.datasetsRoot,
    path.join(paths.staging, "uploads"),
    path.join(paths.staging, "backups"),
    path.join(paths.staging, "restores"),
    paths.backups,
    paths.logs,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

export function datasetDir(dataDir: string, datasetId: string): string {
  return path.join(dataDir, "datasets", datasetId);
}

export function databasePath(dataDir: string, datasetId: string): string {
  return path.join(datasetDir(dataDir, datasetId), "database.sqlite");
}

export function readActivePointer(dataDir: string): ActivePointer | null {
  const file = path.join(dataDir, "active.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ActivePointer>;
    if (!parsed.datasetId || !/^[a-zA-Z0-9_-]+$/.test(parsed.datasetId)) return null;
    return {
      datasetId: parsed.datasetId,
      activatedAt: parsed.activatedAt ?? nowIso(),
      previousDatasetId: parsed.previousDatasetId ?? null,
    };
  } catch {
    return null;
  }
}

export function writeActivePointer(dataDir: string, pointer: ActivePointer): void {
  const file = path.join(dataDir, "active.json");
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

export function newDatasetId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `ds-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface OpenedDataset {
  datasetId: string;
  db: Database.Database;
  dir: string;
}

export function openDatabase(dataDir: string, datasetId: string): Database.Database {
  const file = databasePath(dataDir, datasetId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(path.dirname(file), "files"), { recursive: true });
  fs.mkdirSync(path.join(path.dirname(file), "previews"), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/** Opens the active dataset, creating and migrating a first dataset when needed. */
export function openActiveDataset(dataDir: string): OpenedDataset {
  ensureDataDirs(dataDir);
  let pointer = readActivePointer(dataDir);
  if (!pointer) {
    const datasetId = newDatasetId();
    pointer = { datasetId, activatedAt: nowIso(), previousDatasetId: null };
    fs.mkdirSync(datasetDir(dataDir, datasetId), { recursive: true });
    writeActivePointer(dataDir, pointer);
  }
  const dir = datasetDir(dataDir, pointer.datasetId);
  if (!fs.existsSync(dir)) {
    throw new Error(`激活的数据集目录不存在：${pointer.datasetId}`);
  }
  const db = openDatabase(dataDir, pointer.datasetId);
  runMigrations(db);
  return { datasetId: pointer.datasetId, db, dir };
}
