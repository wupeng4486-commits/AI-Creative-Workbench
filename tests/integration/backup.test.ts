import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/server/src/app.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { createBackup, WriteBarrier } from "../../apps/server/src/services/backup.ts";
import { createAsset } from "../../apps/server/src/services/assets.ts";
import { openActiveDataset } from "../../apps/server/src/db/datasets.ts";
import { seedDatabase } from "../../apps/server/src/db/seed.ts";
import { Readable as R } from "node:stream";
import {
  commitStagedFile,
  guessMimeType,
  insertFile,
  stageUpload,
} from "../../apps/server/src/storage/files.ts";
import { listZipEntries, readZipEntry, assertSafeZipEntry } from "../../apps/server/src/storage/zip.ts";
import { newId } from "../../apps/server/src/util/id.ts";
import { nowIso } from "../../apps/server/src/util/time.ts";
import { cleanupDirs, tempDataDir } from "../helpers/app.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/demo");

afterEach(cleanupDirs);

async function seedDataset(dataDir: string) {
  const dataset = openActiveDataset(dataDir);
  seedDatabase(dataset.db);
  let fileId: string | null = null;
  for (const name of ["测试产品图.png", "测试视频A-4秒.mp4", "测试产品图.png"]) {
    const staged = await stageUpload(
      path.join(dataDir, "staging", "uploads"),
      R.from(fs.readFileSync(path.join(fixtures, name))),
    );
    const committed = commitStagedFile(
      dataset.dir,
      staged.stagingPath,
      name,
      guessMimeType(name),
      staged.sha256,
    );
    const file = insertFile(dataset.db, committed);
    createAsset(dataset.db, { name, fileId: file.id, tags: ["测试"] });
    fileId = file.id;
  }
  const draftId = newId();
  dataset.db
    .prepare(
      `INSERT INTO drafts (id, creation_type, name, requirements, parameters, created_at, updated_at)
       VALUES (?, 'ai_video', '备份草稿', '要求', ?, ?, ?)`,
    )
    .run(draftId, JSON.stringify({ duration: 15 }), nowIso(), nowIso());
  dataset.db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('ui.preferences', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify({ sidebarCollapsed: true, assetView: "grid" }), nowIso());
  return { dataset, fileId };
}

describe("backup service (T06)", () => {
  it("creates a ZIP with manifest, database snapshot and every original file", async () => {
    const dataDir = tempDataDir();
    const { dataset, fileId } = await seedDataset(dataDir);
    const { backup, manifest } = await createBackup(dataset.db, dataset.dir, dataDir, {
      datasetId: dataset.datasetId,
      barrier: new WriteBarrier(),
    });
    expect(backup.status).toBe("ready");
    expect(backup.size).toBeGreaterThan(0);
    expect(manifest.files.length).toBe(3);
    expect(manifest.recordCounts.assets).toBe(3);
    expect(manifest.recordCounts.drafts).toBe(1);

    const archive = path.join(dataDir, "backups", backup.file_name);
    const { entries } = await listZipEntries(archive);
    const names = entries.map((entry) => entry.name).sort();
    expect(names).toContain("manifest.json");
    expect(names).toContain("database.sqlite");
    for (const file of manifest.files) expect(names).toContain(file.zipPath);
    expect(entries.some((entry) => !assertSafeZipEntrySafe(entry.name))).toBe(false);

    const manifestBuffer = await readZipEntry(archive, "manifest.json");
    const parsed = JSON.parse(manifestBuffer.toString("utf8"));
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.files.length).toBe(3);

    const database = await readZipEntry(archive, "database.sqlite", 64 * 1024 * 1024);
    expect(database.subarray(0, 15).toString("latin1")).toBe("SQLite format 3");

    const original = fs.readFileSync(path.join(fixtures, "测试产品图.png"));
    for (const file of manifest.files.filter((item) => item.originalName === "测试产品图.png")) {
      const stored = await readZipEntry(archive, file.zipPath);
      expect(crypto.createHash("sha256").update(stored).digest("hex")).toBe(file.sha256);
      expect(stored.equals(original)).toBe(true);
    }
    expect(fileId).toBeTruthy();

    const counts = dataset.db
      .prepare("SELECT record_counts, file_count FROM backups WHERE id = ?")
      .get(backup.id) as { record_counts: string; file_count: number };
    expect(JSON.parse(counts.record_counts).files).toBe(3);
    expect(counts.file_count).toBe(3);
    dataset.db.close();
  });

  it("serves the archive through the API and lists its record", async () => {
    const dataDir = tempDataDir();
    const { dataset } = await seedDataset(dataDir);
    dataset.db.close();
    const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
    const created = await app.inject({ method: "POST", url: "/api/backups" });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.manifest.fileCount).toBe(3);
    expect(body.manifest.recordCounts.agents).toBeGreaterThan(0);

    const list = await app.inject({ url: "/api/backups" });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().datasetId).toBe(body.datasetId);

    const download = await app.inject({ url: `/api/backups/${body.backup.id}/download` });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("zip");
    expect(download.rawPayload.subarray(0, 2).toString()).toBe("PK");
    await app.close();
  });

  it("records a failed export when an original file is missing", async () => {
    const dataDir = tempDataDir();
    const { dataset } = await seedDataset(dataDir);
    const file = dataset.db.prepare("SELECT id, relative_path FROM files LIMIT 1").get() as {
      id: string;
      relative_path: string;
    };
    fs.rmSync(path.join(dataset.dir, "files", file.relative_path));
    await expect(
      createBackup(dataset.db, dataset.dir, dataDir, {
        datasetId: dataset.datasetId,
        barrier: new WriteBarrier(),
      }),
    ).rejects.toThrow(/缺少原文件/);
    const row = dataset.db.prepare("SELECT status, message FROM backups").get() as {
      status: string;
      message: string;
    };
    expect(row.status).toBe("failed");
    expect(row.message).toContain("缺少原文件");
    const archives = fs
      .readdirSync(path.join(dataDir, "backups"))
      .filter((name) => name.endsWith(".zip"));
    expect(archives).toHaveLength(0);
    dataset.db.close();
  });

  it("rejects unsafe zip entry names before extraction", () => {
    expect(() => assertSafeZipEntry("files/a/original.png")).not.toThrow();
    expect(() => assertSafeZipEntry("../escape.txt")).toThrow(/不安全/);
    expect(() => assertSafeZipEntry("C:/Windows/x.txt")).toThrow(/不安全/);
    expect(() => assertSafeZipEntry("/etc/passwd")).toThrow(/不安全/);
  });

  it("lets writes proceed after the backup releases its barrier", async () => {
    const dataDir = tempDataDir();
    const { dataset } = await seedDataset(dataDir);
    const barrier = new WriteBarrier();
    barrier.acquire();
    let acquired = false;
    const waiting = barrier.wait().then(() => {
      acquired = true;
    });
    expect(acquired).toBe(false);
    barrier.release();
    await waiting;
    expect(acquired).toBe(true);
    expect(barrier.locked).toBe(false);
    dataset.db.close();
  });

  it("keeps a same-named duplicate as a distinct archive entry", async () => {
    const dataDir = tempDataDir();
    const { dataset } = await seedDataset(dataDir);
    const { manifest, backup } = await createBackup(dataset.db, dataset.dir, dataDir, {
      datasetId: dataset.datasetId,
    });
    const duplicates = manifest.files.filter((file) => file.originalName === "测试产品图.png");
    expect(duplicates).toHaveLength(2);
    expect(new Set(duplicates.map((file) => file.zipPath)).size).toBe(2);
    const { entries } = await listZipEntries(path.join(dataDir, "backups", backup.file_name));
    expect(entries.filter((entry) => entry.name.startsWith("files/")).length).toBe(
      manifest.files.length,
    );
    dataset.db.close();
  });
});

function assertSafeZipEntrySafe(name: string): boolean {
  try {
    assertSafeZipEntry(name);
    return true;
  } catch {
    return false;
  }
}

