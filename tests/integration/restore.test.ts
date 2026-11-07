import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import archiver from "archiver";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/server/src/app.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { openActiveDataset, databasePath, datasetDir } from "../../apps/server/src/db/datasets.ts";
import { seedDatabase } from "../../apps/server/src/db/seed.ts";
import { createAsset } from "../../apps/server/src/services/assets.ts";
import { createBackup } from "../../apps/server/src/services/backup.ts";
import {
  activateRestore,
  cancelRestore,
  datasetHealth,
  prepareRestore,
  recoverOnStartup,
} from "../../apps/server/src/services/restore.ts";
import {
  commitStagedFile,
  guessMimeType,
  insertFile,
  stageUpload,
} from "../../apps/server/src/storage/files.ts";
import { newId } from "../../apps/server/src/util/id.ts";
import { nowIso } from "../../apps/server/src/util/time.ts";
import { cleanupDirs, tempDataDir } from "../helpers/app.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/demo");

afterEach(cleanupDirs);

async function buildSource(dataDir: string) {
  const dataset = openActiveDataset(dataDir);
  seedDatabase(dataset.db);
  const staged = await stageUpload(
    path.join(dataDir, "staging", "uploads"),
    Readable.from(fs.readFileSync(path.join(fixtures, "测试产品图.png"))),
  );
  const committed = commitStagedFile(
    dataset.dir,
    staged.stagingPath,
    "测试产品图.png",
    guessMimeType("测试产品图.png"),
    staged.sha256,
  );
  const file = insertFile(dataset.db, committed);
  createAsset(dataset.db, { name: "恢复测试图", fileId: file.id, tags: ["恢复"] });
  const draftId = newId();
  dataset.db
    .prepare(
      `INSERT INTO drafts (id, creation_type, name, requirements, parameters, created_at, updated_at)
       VALUES (?, 'video_join', '恢复顺序草稿', '保留顺序', ?, ?, ?)`,
    )
    .run(draftId, JSON.stringify({ clips: ["a", "b"] }), nowIso(), nowIso());
  return { dataset, file, draftId };
}

async function makeBackupFile(dataDir: string) {
  const { dataset } = await buildSource(dataDir);
  const { backup } = await createBackup(dataset.db, dataset.dir, dataDir, {
    datasetId: dataset.datasetId,
  });
  const archive = path.join(dataDir, "backups", backup.file_name);
  const copy = path.join(dataDir, "staging", `upload-${newId()}.zip`);
  fs.copyFileSync(archive, copy);
  dataset.db.close();
  return copy;
}

function freshCtx(dataDir: string) {
  const dataset = openActiveDataset(dataDir);
  seedDatabase(dataset.db);
  return {
    config: { dataDir },
    db: dataset.db,
    datasetId: dataset.datasetId,
    close: () => dataset.db.close(),
  };
}

describe("restore validation and dataset activation (T07)", () => {
  it("restores a full backup into a new dataset with identical data and files", async () => {
    const sourceDir = tempDataDir();
    const upload = await makeBackupFile(sourceDir);

    const targetDir = tempDataDir();
    const ctx = freshCtx(targetDir);
    const before = ctx.datasetId;
    const preview = await prepareRestore(ctx, upload, "完整备份.zip");
    expect(preview.status).toBe("preview");
    expect(preview.fileCount).toBe(1);
    expect(preview.problems).toEqual([]);
    expect(preview.recordCounts.assets).toBe(1);
    ctx.close();

    const target = freshCtx(targetDir);
    // Keep the preview row from the previous dataset by pointing at the same
    // database file: the preview was stored in the active dataset.
    const result = activateRestore(
      targetDir,
      preview.id,
      target.datasetId,
      (datasetId) => datasetHealth(targetDir, datasetId),
    );
    target.close();
    expect(result.datasetId).not.toBe(result.previousDatasetId);

    const restored = openActiveDataset(targetDir);
    expect(restored.datasetId).toBe(result.datasetId);
    const asset = restored.db
      .prepare("SELECT name, tags, file_id FROM assets WHERE name = ?")
      .get("恢复测试图") as { name: string; tags: string; file_id: string };
    expect(JSON.parse(asset.tags)).toEqual(["恢复"]);
    const file = restored.db
      .prepare("SELECT relative_path, sha256 FROM files WHERE id = ?")
      .get(asset.file_id) as { relative_path: string; sha256: string };
    const bytes = fs.readFileSync(path.join(restored.dir, "files", file.relative_path));
    expect(crypto.createHash("sha256").update(bytes).digest("hex")).toBe(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(fixtures, "测试产品图.png")))
        .digest("hex"),
    );
    const draft = restored.db
      .prepare("SELECT requirements, parameters FROM drafts WHERE name = ?")
      .get("恢复顺序草稿") as { requirements: string; parameters: string };
    expect(draft.requirements).toBe("保留顺序");
    expect(JSON.parse(draft.parameters).clips).toEqual(["a", "b"]);
    const pointer = JSON.parse(fs.readFileSync(path.join(targetDir, "active.json"), "utf8"));
    expect(pointer.datasetId).toBe(result.datasetId);
    expect(pointer.previousDatasetId).toBe(result.previousDatasetId);
    restored.db.close();
  });

  it("works end to end through upload and confirm endpoints", async () => {
    const sourceDir = tempDataDir();
    const upload = await makeBackupFile(sourceDir);
    const targetDir = tempDataDir();
    const app = await buildApp({ config: createConfig({ APP_DATA_DIR: targetDir }) });
    const before = (await app.inject({ url: "/api/system/info" })).json();

    const boundary = "----restore" + crypto.randomBytes(5).toString("hex");
    const fileBytes = fs.readFileSync(upload);
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="完整备份.zip"\r\nContent-Type: application/zip\r\n\r\n`,
      ),
      fileBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const restoredPreview = await app.inject({
      method: "POST",
      url: "/api/restores/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(restoredPreview.statusCode).toBe(201);
    const preview = restoredPreview.json().preview;
    expect(preview.status).toBe("preview");

    const stale = await app.inject({
      method: "POST",
      url: `/api/restores/${preview.id}/confirm`,
      payload: { datasetId: "stale-dataset" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("DATASET_CHANGED");

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/restores/${preview.id}/confirm`,
      payload: { datasetId: before.datasetId },
    });
    expect(confirmed.statusCode).toBe(200);
    const body = confirmed.json();
    expect(body.datasetId).not.toBe(before.datasetId);

    const info = await app.inject({ url: "/api/system/info" });
    expect(info.json().datasetId).toBe(body.datasetId);
    expect(info.json().counts.assets).toBe(1);
    await app.close();
    expect(fs.existsSync(path.join(targetDir, "activation-journal.json"))).toBe(false);
  });

  it("cancels without touching current data", async () => {
    const sourceDir = tempDataDir();
    const upload = await makeBackupFile(sourceDir);
    const targetDir = tempDataDir();
    const ctx = freshCtx(targetDir);
    const preview = await prepareRestore(ctx, upload, "备份.zip");
    const beforePointer = fs.readFileSync(path.join(targetDir, "active.json"), "utf8");
    cancelRestore(ctx, preview.id);
    expect(fs.readFileSync(path.join(targetDir, "active.json"), "utf8")).toBe(beforePointer);
    const row = ctx.db
      .prepare("SELECT status FROM restores WHERE id = ?")
      .get(preview.id) as { status: string };
    expect(row.status).toBe("cancelled");
    expect(fs.existsSync(path.join(targetDir, "staging", "restores", preview.id))).toBe(false);
    ctx.close();
  });

  it("rejects a corrupt archive and keeps existing data", async () => {
    const targetDir = tempDataDir();
    const ctx = freshCtx(targetDir);
    const corrupt = path.join(targetDir, "staging", "corrupt.zip");
    fs.mkdirSync(path.dirname(corrupt), { recursive: true });
    fs.writeFileSync(corrupt, "this is not a zip");
    await expect(prepareRestore(ctx, corrupt, "损坏.zip")).rejects.toThrow(/格式错误|无法读取/);
    const info = ctx.db.prepare("SELECT COUNT(*) AS c FROM restores WHERE status = 'failed'").get() as {
      c: number;
    };
    expect(info.c).toBe(1);
    expect(fs.existsSync(path.join(targetDir, "active.json"))).toBe(true);
    ctx.close();
  });

  it("rejects an unsupported format version", async () => {
    const targetDir = tempDataDir();
    const ctx = freshCtx(targetDir);
    const archive = path.join(targetDir, "staging", "version.zip");
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(archive);
      const zip = archiver("zip");
      output.on("close", resolve);
      zip.on("error", reject);
      zip.pipe(output);
      zip.append(JSON.stringify({ formatVersion: 99, files: [] }), { name: "manifest.json" });
      zip.append("not-a-db", { name: "database.sqlite" });
      void zip.finalize();
    });
    await expect(prepareRestore(ctx, archive, "未来版本.zip")).rejects.toThrow(/版本/);
    ctx.close();
  });

  it("rejects a backup whose original file hash does not match", async () => {
    const sourceDir = tempDataDir();
    const upload = await makeBackupFile(sourceDir);
    const sourceDb = databasePath(sourceDir, JSON.parse(fs.readFileSync(path.join(sourceDir, "active.json"), "utf8")).datasetId);
    const targetDir = tempDataDir();
    const ctx = freshCtx(targetDir);
    const tampered = path.join(targetDir, "staging", "tampered.zip");
    fs.mkdirSync(path.dirname(tampered), { recursive: true });
    const { listZipEntries, readZipEntry } = await import("../../apps/server/src/storage/zip.ts");
    const entries = await listZipEntries(upload);
    const manifest = JSON.parse(
      (await readZipEntry(upload, "manifest.json")).toString("utf8"),
    ) as { files: Array<{ zipPath: string }> };
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(tampered);
      const zip = archiver("zip");
      output.on("close", resolve);
      zip.on("error", reject);
      zip.pipe(output);
      zip.append(JSON.stringify(manifest), { name: "manifest.json" });
      zip.append(fs.readFileSync(sourceDb), { name: "database.sqlite" });
      for (const file of manifest.files) {
        zip.append("tampered-bytes", { name: file.zipPath });
      }
      void zip.finalize();
    });
    await expect(prepareRestore(ctx, tampered, "被篡改.zip")).rejects.toThrow(/校验值|大小/);
    expect(entries.entries.length).toBeGreaterThan(0);
    ctx.close();
  });

  it("rolls back an interrupted activation when the new dataset is unhealthy", () => {
    const dataDir = tempDataDir();
    const dataset = openActiveDataset(dataDir);
    seedDatabase(dataset.db);
    const from = dataset.datasetId;
    dataset.db.close();
    fs.writeFileSync(
      path.join(dataDir, "activation-journal.json"),
      JSON.stringify({ id: "j1", phase: "swapped", fromDatasetId: from, toDatasetId: "ds-missing", updatedAt: nowIso() }),
    );
    fs.writeFileSync(
      path.join(dataDir, "active.json"),
      JSON.stringify({ datasetId: "ds-missing", activatedAt: nowIso(), previousDatasetId: from }),
    );
    const result = recoverOnStartup(dataDir);
    expect(result.action).toBe("rolled_back");
    expect(result.datasetId).toBe(from);
    const pointer = JSON.parse(fs.readFileSync(path.join(dataDir, "active.json"), "utf8"));
    expect(pointer.datasetId).toBe(from);
    expect(fs.existsSync(path.join(dataDir, "activation-journal.json"))).toBe(false);
  });

  it("completes an interrupted activation when the new dataset is healthy", async () => {
    const sourceDir = tempDataDir();
    const upload = await makeBackupFile(sourceDir);
    const targetDir = tempDataDir();
    const ctx = freshCtx(targetDir);
    const preview = await prepareRestore(ctx, upload, "备份.zip");
    const to = newId();
    fs.mkdirSync(datasetDir(targetDir, to), { recursive: true });
    fs.copyFileSync(
      databasePath(targetDir, preview.id ? ctx.datasetId : ctx.datasetId),
      databasePath(targetDir, to),
    );
    fs.writeFileSync(
      path.join(targetDir, "activation-journal.json"),
      JSON.stringify({ id: "j2", phase: "prepared", fromDatasetId: ctx.datasetId, toDatasetId: to, updatedAt: nowIso() }),
    );
    ctx.close();
    const result = recoverOnStartup(targetDir);
    expect(result.action).toBe("completed");
    expect(result.datasetId).toBe(to);
    expect(datasetHealth(targetDir, to)).toBe(true);
  });

  it("refuses to activate a preview from another dataset", async () => {
    const sourceDir = tempDataDir();
    const upload = await makeBackupFile(sourceDir);
    const targetDir = tempDataDir();
    const ctx = freshCtx(targetDir);
    const preview = await prepareRestore(ctx, upload, "备份.zip");
    ctx.close();
    expect(() =>
      activateRestore(targetDir, preview.id, "another-dataset", (id) =>
        datasetHealth(targetDir, id),
      ),
    ).toThrow(/数据集已变化/);
  });

  it("keeps the previous dataset intact when the new one fails the health check", async () => {
    const dataDir = tempDataDir();
    const ds = openActiveDataset(dataDir);
    seedDatabase(ds.db);
    const staging = path.join(dataDir, "staging", "restores", "unhealthy");
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, "database.sqlite"), "not a database");
    ds.db
      .prepare(
        `INSERT INTO restores (id, status, source_name, staged_dir, previous_dataset_id, exported_at, record_counts, file_count, created_at)
         VALUES ('unhealthy', 'preview', 'bad.zip', ?, ?, '', '{}', 0, ?)`,
      )
      .run(staging, ds.datasetId, nowIso());
    ds.db.close();
    expect(() =>
      activateRestore(dataDir, "unhealthy", ds.datasetId, () => false),
    ).toThrow(/健康检查/);
    const pointer = JSON.parse(fs.readFileSync(path.join(dataDir, "active.json"), "utf8"));
    expect(pointer.datasetId).toBe(ds.datasetId);
    expect(fs.existsSync(path.join(dataDir, "activation-journal.json"))).toBe(false);
    const check = openActiveDataset(dataDir);
    expect(check.datasetId).toBe(ds.datasetId);
    check.db.close();
  });

  it("restores data across a full service restart after confirmation", async () => {
    const sourceDir = tempDataDir();
    const upload = await makeBackupFile(sourceDir);
    const targetDir = tempDataDir();
    const first = await buildApp({ config: createConfig({ APP_DATA_DIR: targetDir }) });
    const before = (await first.inject({ url: "/api/system/info" })).json();
    const boundary = "----restart" + crypto.randomBytes(4).toString("hex");
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="r.zip"\r\nContent-Type: application/zip\r\n\r\n`,
      ),
      fs.readFileSync(upload),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const preview = (
      await first.inject({
        method: "POST",
        url: "/api/restores/upload",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload,
      })
    ).json().preview;
    const confirmed = await first.inject({
      method: "POST",
      url: `/api/restores/${preview.id}/confirm`,
      payload: { datasetId: before.datasetId },
    });
    const newDataset = confirmed.json().datasetId;
    await first.close();

    const second = await buildApp({ config: createConfig({ APP_DATA_DIR: targetDir }) });
    const info = (await second.inject({ url: "/api/system/info" })).json();
    expect(info.datasetId).toBe(newDataset);
    expect(info.counts.assets).toBe(1);
    await second.close();
  });
});
