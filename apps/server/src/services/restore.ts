import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { APP_VERSION } from "@workbench/shared";
import { absoluteFilePath } from "../storage/files.ts";
import {
  datasetDir,
  databasePath,
  newDatasetId,
  writeActivePointer,
} from "../db/datasets.ts";
import { appError } from "../http/errors.ts";
import { newId } from "../util/id.ts";
import { nowIso } from "../util/time.ts";
import {
  assertSafeZipEntry,
  extractZip,
  listZipEntries,
  readZipEntry,
} from "../storage/zip.ts";
import { BACKUP_FORMAT_VERSION, type BackupManifest } from "./backup.ts";
import {
  clearJournal,
  recoverInterruptedActivation,
  writeJournal,
} from "./activation.ts";

export interface RestorePreview {
  id: string;
  sourceName: string;
  exportedAt: string;
  recordCounts: Record<string, number>;
  fileCount: number;
  totalBytes: number;
  problems: string[];
  status: "preview" | "confirmed" | "cancelled" | "failed";
  createdAt: string;
}

const REQUIRED_TABLES = [
  "agents",
  "skills",
  "products",
  "files",
  "assets",
  "drafts",
  "team_workflows",
  "settings",
  "schema_migrations",
];

function validateManifest(value: unknown): BackupManifest {
  const manifest = value as Partial<BackupManifest>;
  if (!manifest || typeof manifest !== "object") {
    throw appError("RESTORE_INVALID", "备份清单缺失或格式错误。");
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw appError(
      "RESTORE_VERSION_UNSUPPORTED",
      `备份格式版本不受支持：${String(manifest.formatVersion)}。`,
    );
  }
  if (!Array.isArray(manifest.files)) {
    throw appError("RESTORE_INVALID", "备份清单未包含文件列表。");
  }
  return manifest as BackupManifest;
}

function openAndCheck(databaseFile: string): {
  problems: string[];
  counts: Record<string, number>;
} {
  const problems: string[] = [];
  const counts: Record<string, number> = {};
  let db: Database.Database | null = null;
  try {
    db = new Database(databaseFile, { readonly: true, fileMustExist: true });
    const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    if (!integrity.every((row) => row.integrity_check === "ok")) {
      problems.push("数据库完整性检查未通过。");
    }
    const foreign = db.pragma("foreign_key_check") as Array<Record<string, unknown>>;
    if (foreign.length > 0) problems.push(`外键引用不一致（${foreign.length} 处）。`);
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>).map((row) => row.name),
    );
    for (const table of REQUIRED_TABLES) {
      if (!tables.has(table)) problems.push(`备份数据库缺少表：${table}。`);
    }
    if (problems.length === 0) {
      for (const table of ["agents", "skills", "assets", "files", "drafts", "team_workflows"]) {
        counts[table] = (
          db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
        ).c;
      }
    }
  } catch (error) {
    problems.push(`无法打开备份数据库：${(error as Error).message}`);
  } finally {
    db?.close();
  }
  return { problems, counts };
}

export async function prepareRestore(
  ctx: { config: { dataDir: string }; db: Database.Database; datasetId: string },
  uploadFile: string,
  sourceName: string,
): Promise<RestorePreview> {
  const id = newId();
  const staging = path.join(ctx.config.dataDir, "staging", "restores", id);
  fs.mkdirSync(staging, { recursive: true });
  const problems: string[] = [];
  let manifest: BackupManifest | null = null;
  let fileCount = 0;
  let totalBytes = 0;
  try {
    const { entries } = await listZipEntries(uploadFile);
    for (const entry of entries) assertSafeZipEntry(entry.name);
    if (!entries.some((entry) => entry.name === "manifest.json")) {
      throw appError("RESTORE_INVALID", "备份包缺少 manifest.json。");
    }
    const manifestBuffer = await readZipEntry(uploadFile, "manifest.json");
    manifest = validateManifest(JSON.parse(manifestBuffer.toString("utf8")));
    totalBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
    fileCount = manifest.files.length;

    const sha = new Map<string, string>();
    await extractZip(uploadFile, staging, (name, hash) => sha.set(name, hash));
    for (const file of manifest.files) {
      const hash = sha.get(file.zipPath);
      if (!hash) problems.push(`缺少原文件：${file.originalName}`);
      else if (hash !== file.sha256) problems.push(`校验值不一致：${file.originalName}`);
    }
    const databaseFile = path.join(staging, "database.sqlite");
    if (!fs.existsSync(databaseFile)) {
      problems.push("备份包缺少 database.sqlite。");
    } else {
      const check = openAndCheck(databaseFile);
      problems.push(...check.problems);
      if (!check.problems.length) {
        const db = new Database(databaseFile, { readonly: true });
        try {
          const rows = db.prepare("SELECT id, relative_path, size, sha256 FROM files WHERE state = 'ready'").all() as Array<{ id: string; relative_path: string; size: number; sha256: string }>;
          const listed = new Map(manifest.files.map((file) => [file.fileId, file]));
          if (listed.size !== manifest.files.length || listed.size !== rows.length) problems.push("数据库与清单的原文件数量不一致。");
          for (const row of rows) {
            const file = listed.get(row.id);
            const zipPath = `files/${row.id}/${path.basename(row.relative_path)}`;
            if (!file || file.relativePath !== row.relative_path || file.zipPath !== zipPath || file.size !== row.size || file.sha256 !== row.sha256) {
              problems.push(`数据库与清单的原文件信息不一致：${row.id}`);
              continue;
            }
            const absolute = absoluteFilePath(staging, row.relative_path);
            if (!fs.existsSync(absolute) || fs.statSync(absolute).size !== row.size || sha.get(zipPath) !== row.sha256) problems.push(`原文件内容不完整：${row.id}`);
          }
        } finally { db.close(); }
      }
    }
  } catch (error) {
    const typed = error as { code?: string; message: string };
    const raw = typed.message || "";
    problems.push(
      /signature not found|invalid|zip/i.test(raw)
        ? `备份包格式错误，无法读取：${raw}`
        : raw || "备份包无法读取。",
    );
    if (!typed.code) typed.code = "RESTORE_INVALID";
  }

  const preview: RestorePreview = {
    id,
    sourceName,
    exportedAt: manifest?.exportedAt ?? "",
    recordCounts: manifest?.recordCounts ?? {},
    fileCount,
    totalBytes,
    problems,
    status: problems.length > 0 ? "failed" : "preview",
    createdAt: nowIso(),
  };
  ctx.db
    .prepare(
      `INSERT INTO restores (id, status, source_name, staged_dir, previous_dataset_id, exported_at, record_counts, file_count, message, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      preview.status,
      sourceName,
      staging,
      ctx.datasetId,
      preview.exportedAt,
      JSON.stringify(preview.recordCounts),
      fileCount,
      problems.join("\n"),
      preview.createdAt,
      preview.status === "failed" ? nowIso() : null,
    );
  if (preview.status === "failed") {
    throw appError("RESTORE_INVALID", problems.join(" "), { restoreId: id } as never);
  }
  return preview;
}

export interface ActivateResult {
  datasetId: string;
  previousDatasetId: string;
}

/**
 * Switches the active pointer to a verified dataset. Each step is journaled so
 * an interrupted activation can be completed or rolled back on next start.
 */
export function activateRestore(
  dataDir: string,
  restoreId: string,
  expectedDatasetId: string,
  healthCheck: (datasetId: string) => boolean,
): ActivateResult {
  const row = readRestoreRow(dataDir, restoreId);
  if (!row) throw appError("NOT_FOUND", "恢复记录不存在。");
  if (row.status !== "preview") throw appError("RESTORE_STATE", "该恢复记录不能再次确认。");
  if (row.previous_dataset_id !== expectedDatasetId) {
    throw appError("DATASET_CHANGED", "当前数据集已变化，请重新选择备份。", {
      datasetId: expectedDatasetId,
    });
  }
  const newIdValue = newDatasetId();
  const targetDir = datasetDir(dataDir, newIdValue);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(row.staged_dir)) {
    fs.renameSync(path.join(row.staged_dir, entry), path.join(targetDir, entry));
  }
  const databaseFile = databasePath(dataDir, newIdValue);
  if (!fs.existsSync(databaseFile)) {
    throw appError("RESTORE_INVALID", "备份缺少数据库文件。");
  }
  writeJournal(dataDir, {
    id: restoreId,
    phase: "prepared",
    fromDatasetId: expectedDatasetId,
    toDatasetId: newIdValue,
    updatedAt: nowIso(),
  });
  try {
    writeActivePointer(dataDir, {
      datasetId: newIdValue,
      activatedAt: nowIso(),
      previousDatasetId: expectedDatasetId,
    });
  } catch (error) {
    writeJournal(dataDir, {
      id: restoreId,
      phase: "rolled_back",
      fromDatasetId: expectedDatasetId,
      toDatasetId: newIdValue,
      updatedAt: nowIso(),
    });
    clearJournal(dataDir);
    throw error;
  }
  writeJournal(dataDir, {
    id: restoreId,
    phase: "swapped",
    fromDatasetId: expectedDatasetId,
    toDatasetId: newIdValue,
    updatedAt: nowIso(),
  });
  if (!healthCheck(newIdValue)) {
    writeActivePointer(dataDir, {
      datasetId: expectedDatasetId,
      activatedAt: nowIso(),
      previousDatasetId: null,
    });
    clearJournal(dataDir);
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw appError("RESTORE_HEALTH_FAILED", "恢复后的数据集未通过健康检查，已回到原数据。");
  }
  writeJournal(dataDir, {
    id: restoreId,
    phase: "active",
    fromDatasetId: expectedDatasetId,
    toDatasetId: newIdValue,
    updatedAt: nowIso(),
  });
  clearJournal(dataDir);
  updateRestore(dataDir, restoreId, {
    status: "confirmed",
    newDatasetId: newIdValue,
    finishedAt: nowIso(),
  });
  fs.rmSync(row.staged_dir, { recursive: true, force: true });
  return { datasetId: newIdValue, previousDatasetId: expectedDatasetId };
}

function restoreDb(dataDir: string): Database.Database {
  const active = JSON.parse(fs.readFileSync(path.join(dataDir, "active.json"), "utf8")) as {
    datasetId: string;
  };
  return new Database(databasePath(dataDir, active.datasetId));
}

function readRestoreRow(
  dataDir: string,
  id: string,
): {
  status: string;
  staged_dir: string;
  previous_dataset_id: string | null;
} | null {
  const db = restoreDb(dataDir);
  try {
    const row = db
      .prepare("SELECT status, staged_dir, previous_dataset_id FROM restores WHERE id = ?")
      .get(id) as
      | { status: string; staged_dir: string; previous_dataset_id: string | null }
      | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

function updateRestore(
  dataDir: string,
  id: string,
  patch: { status?: string; newDatasetId?: string; finishedAt?: string; message?: string },
): void {
  const db = restoreDb(dataDir);
  try {
    const current = db.prepare("SELECT * FROM restores WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!current) return;
    db.prepare(
      "UPDATE restores SET status = ?, new_dataset_id = ?, finished_at = ?, message = ? WHERE id = ?",
    ).run(
      patch.status ?? current.status,
      patch.newDatasetId ?? current.new_dataset_id,
      patch.finishedAt ?? current.finished_at,
      patch.message ?? current.message,
      id,
    );
  } finally {
    db.close();
  }
}

export function cancelRestore(
  ctx: { config: { dataDir: string }; db: Database.Database },
  restoreId: string,
): void {
  const row = ctx.db
    .prepare("SELECT staged_dir, status FROM restores WHERE id = ?")
    .get(restoreId) as { staged_dir: string; status: string } | undefined;
  if (!row) throw appError("NOT_FOUND", "恢复记录不存在。");
  if (row.status === "confirmed") {
    throw appError("RESTORE_STATE", "数据已恢复，不能取消。");
  }
  ctx.db
    .prepare("UPDATE restores SET status = 'cancelled', finished_at = ? WHERE id = ?")
    .run(nowIso(), restoreId);
  fs.rmSync(row.staged_dir, { recursive: true, force: true });
}

export function datasetHealth(dataDir: string, datasetId: string): boolean {
  const file = databasePath(dataDir, datasetId);
  if (!fs.existsSync(file)) return false;
  try {
    const db = new Database(file, { readonly: true });
    const result = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    db.close();
    return result.every((row) => row.integrity_check === "ok");
  } catch {
    return false;
  }
}

export function recoverOnStartup(dataDir: string) {
  return recoverInterruptedActivation(dataDir, (datasetId) => datasetHealth(dataDir, datasetId));
}

export function hashFile(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export const APP_VERSION_FALLBACK = APP_VERSION;
