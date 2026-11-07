import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import type Database from "better-sqlite3";
import { APP_VERSION } from "@workbench/shared";
import { newId } from "../util/id.ts";
import { nowIso } from "../util/time.ts";
import { absoluteFilePath, filesRoot, quarantineUnregisteredFiles } from "../storage/files.ts";

export const BACKUP_FORMAT_VERSION = 1;

/**
 * Coordinates long-running archive creation with short database writes:
 * writes wait while a backup snapshot is being taken, and the backup takes the
 * snapshot synchronously so database and files always match.
 */
export class WriteBarrier {
  private depth = 0;
  private waiting: Array<() => void> = [];
  private activeWrites = 0;
  private drainWaiters: Array<() => void> = [];

  beginWrite(): void { this.activeWrites += 1; }
  endWrite(): void {
    this.activeWrites -= 1;
    if (!this.activeWrites) for (const resolve of this.drainWaiters.splice(0)) resolve();
  }
  async drain(): Promise<void> {
    if (this.activeWrites) await new Promise<void>((resolve) => this.drainWaiters.push(resolve));
  }

  get locked(): boolean {
    return this.depth > 0;
  }

  acquire(): void {
    this.depth += 1;
  }

  release(): void {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) {
      for (const resolve of this.waiting.splice(0)) resolve();
    }
  }

  async wait(): Promise<void> {
    if (this.depth === 0) return;
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
}

export interface BackupManifestFile {
  fileId: string;
  zipPath: string;
  originalName: string;
  size: number;
  sha256: string;
  relativePath: string;
}

export interface BackupManifest {
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  datasetId: string;
  recordCounts: Record<string, number>;
  files: BackupManifestFile[];
}

export interface BackupRecord {
  id: string;
  status: "running" | "ready" | "failed";
  file_name: string;
  size: number;
  record_counts: string;
  file_count: number;
  message: string;
  created_at: string;
  finished_at: string | null;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function recordCounts(db: Database.Database): Record<string, number> {
  const tables = [
    "agents",
    "skills",
    "products",
    "files",
    "assets",
    "case_collections",
    "collection_items",
    "drafts",
    "draft_clips",
    "team_workflows",
    "connectors",
    "runs",
    "run_items",
    "run_files",
    "settings",
    "activities",
    "recent_items",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
    counts[table] = row.c;
  }
  return counts;
}

function zipPathFor(file: { id: string; relative_path: string }): string {
  return `files/${file.id}/${path.basename(file.relative_path)}`;
}

/**
 * Writes the archive while the dataset is locked for writes. The caller must
 * hold `beginWriteBarrier` so a concurrent edit cannot split database and files.
 */
export async function createBackup(
  db: Database.Database,
  datasetDir: string,
  dataDir: string,
  options: { datasetId: string; barrier?: WriteBarrier },
): Promise<{ backup: BackupRecord; manifest: BackupManifest }> {
  const id = newId();
  const createdAt = nowIso();
  const fileName = `backup-${createdAt.replace(/[:.]/g, "-")}-${id.slice(0, 6)}.zip`;
  const target = path.join(dataDir, "backups", fileName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  db.prepare(
    `INSERT INTO backups (id, status, file_name, created_at) VALUES (?, 'running', ?, ?)`,
  ).run(id, fileName, createdAt);

  const counts = recordCounts(db);
  const fileRows = db
    .prepare("SELECT id, relative_path, original_name, size, sha256 FROM files WHERE state = 'ready'")
    .all() as Array<{
    id: string;
    relative_path: string;
    original_name: string;
    size: number;
    sha256: string;
  }>;
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: createdAt,
    datasetId: options.datasetId,
    recordCounts: counts,
    files: fileRows.map((row) => ({
      fileId: row.id,
      zipPath: zipPathFor(row),
      originalName: row.original_name,
      size: row.size,
      sha256: row.sha256,
      relativePath: row.relative_path,
    })),
  };

  let released = false;
  try {
    const barrier = options.barrier;
    barrier?.acquire();
    quarantineUnregisteredFiles(datasetDir, db);
    const snapshot = path.join(dataDir, "staging", "backups", `snapshot-${id}.sqlite`);
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    await db.backup(snapshot);

    await new Promise<void>((resolve, reject) => {
      for (const row of fileRows) {
        if (!fs.existsSync(absoluteFilePath(datasetDir, row.relative_path))) {
          return reject(new Error(`备份缺少原文件：${row.original_name}`));
        }
      }
      const output = fs.createWriteStream(target);
      const archive = archiver("zip", { zlib: { level: 1 } });
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
      archive.on("warning", (error) => {
        if ((error as { code?: string }).code !== "ENOENT") reject(error);
      });
      archive.pipe(output);
      archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: "manifest.json" });
      archive.file(snapshot, { name: "database.sqlite" });
      for (const row of fileRows) {
        const absolute = absoluteFilePath(datasetDir, row.relative_path);
        archive.file(absolute, { name: zipPathFor(row), stats: fs.statSync(absolute) });
      }
      void archive.finalize();
    });
    fs.rmSync(snapshot, { force: true });

    const size = fs.statSync(target).size;
    db.prepare(
      `UPDATE backups SET status = 'ready', size = ?, record_counts = ?, file_count = ?, finished_at = ? WHERE id = ?`,
    ).run(size, JSON.stringify(counts), fileRows.length, nowIso(), id);
    barrier?.release();
    released = true;
    return {
      backup: db.prepare("SELECT * FROM backups WHERE id = ?").get(id) as BackupRecord,
      manifest,
    };
  } catch (error) {
    if (!released) options.barrier?.release();
    fs.rmSync(target, { force: true });
    const message = (error as Error).message;
    db.prepare(
      `UPDATE backups SET status = 'failed', message = ?, finished_at = ? WHERE id = ?`,
    ).run(message, nowIso(), id);
    throw error;
  }
}

export function backupPath(dataDir: string, fileName: string): string {
  const resolved = path.resolve(dataDir, "backups", fileName);
  const root = path.resolve(dataDir, "backups");
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error("备份路径越界。");
  }
  return resolved;
}

export function listBackups(db: Database.Database): BackupRecord[] {
  return db.prepare("SELECT * FROM backups ORDER BY created_at DESC").all() as BackupRecord[];
}

export function filesDirectory(datasetDir: string): string {
  return filesRoot(datasetDir);
}

export async function verifyArchive(
  manifest: BackupManifest,
  entries: Map<string, Buffer>,
  decompressSha: (name: string) => Promise<string>,
): Promise<string[]> {
  const problems: string[] = [];
  if (!entries.has("database.sqlite")) problems.push("备份缺少数据库文件。");
  for (const file of manifest.files) {
    if (!entries.has(file.zipPath)) {
      problems.push(`备份缺少原文件：${file.originalName}`);
      continue;
    }
    if (entries.get(file.zipPath)!.length !== file.size) {
      problems.push(`文件大小不一致：${file.originalName}`);
      continue;
    }
    if ((await decompressSha(file.zipPath)) !== file.sha256) {
      problems.push(`文件校验值不一致：${file.originalName}`);
    }
  }
  return problems;
}
