import fs from "node:fs";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeApp, tempDataDir, cleanupDirs } from "../helpers/app.ts";
import { createContext } from "../../apps/server/src/context.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { createAsset, deleteAsset } from "../../apps/server/src/services/assets.ts";
import { ensureDemoFile } from "../../apps/server/src/services/demo-runs.ts";
import { createBackup } from "../../apps/server/src/services/backup.ts";
import { prepareRestore } from "../../apps/server/src/services/restore.ts";
import { listZipEntries, readZipEntry } from "../../apps/server/src/storage/zip.ts";
import { absoluteFilePath, stageUpload } from "../../apps/server/src/storage/files.ts";
import * as seedService from "../../apps/server/src/db/seed.ts";

afterEach(() => { vi.restoreAllMocks(); cleanupDirs(); });
describe("acceptance regressions (T23)", () => {
  it("keeps the current connection usable when opening the activated restore fails", async () => {
    const dir = tempDataDir(); const app = await makeApp(dir);
    try {
      const before = (await app.inject("/api/system/info")).json();
      const backup = (await app.inject({ method: "POST", url: "/api/backups" })).json();
      const bytes = (await app.inject(backup.downloadUrl)).rawPayload;
      const payload = Buffer.concat([Buffer.from('--restorefault\r\nContent-Disposition: form-data; name="file"; filename="restore.zip"\r\nContent-Type: application/zip\r\n\r\n'), bytes, Buffer.from('\r\n--restorefault--\r\n')]);
      const upload = await app.inject({ method: "POST", url: "/api/restores/upload", headers: { "content-type": "multipart/form-data; boundary=restorefault" }, payload });
      expect(upload.statusCode).toBe(201);
      vi.spyOn(seedService, "seedDatabase").mockImplementationOnce(() => { throw new Error("injected new dataset initialization failure"); });
      const confirm = await app.inject({ method: "POST", url: `/api/restores/${upload.json().preview.id}/confirm`, payload: { datasetId: before.datasetId } });
      expect(confirm.statusCode).toBe(500);
      const after = await app.inject("/api/system/info");
      expect(after.statusCode).toBe(200);
      expect(after.json().datasetId).toBe(before.datasetId);
      expect(after.json().counts).toEqual(before.counts);
      expect(JSON.parse(fs.readFileSync(path.join(dir, "active.json"), "utf8")).datasetId).toBe(before.datasetId);
    } finally { await app.close(); }
  });

  it("preserves files shared by assets and rolls back metadata before touching originals", () => {
    const ctx = createContext(createConfig({ APP_DATA_DIR: tempDataDir() }));
    try {
      const file = ensureDemoFile(ctx, "image");
      const first = createAsset(ctx.db, { name: "第一份引用", fileId: file.id });
      const second = createAsset(ctx.db, { name: "第二份引用", fileId: file.id });
      expect(deleteAsset(ctx.db, ctx.dataset.dir, first.id).retainedFile).toBe(true);
      const original = absoluteFilePath(ctx.dataset.dir, file.relative_path);
      expect(fs.existsSync(original)).toBe(true);
      ctx.db.exec("CREATE TRIGGER fail_asset_delete BEFORE DELETE ON assets BEGIN SELECT RAISE(ABORT, 'injected deletion failure'); END;");
      expect(() => deleteAsset(ctx.db, ctx.dataset.dir, second.id)).toThrow("injected deletion failure");
      expect(fs.existsSync(original)).toBe(true);
      expect(ctx.db.prepare("SELECT id FROM assets WHERE id = ?").get(second.id)).toBeTruthy();
      ctx.db.exec("DROP TRIGGER fail_asset_delete");
      expect(deleteAsset(ctx.db, ctx.dataset.dir, second.id).retainedFile).toBe(false);
      expect(fs.existsSync(original)).toBe(false);
    } finally { ctx.close(); }
  });

  it("reports ENOSPC, leaves no successful asset or partial upload and permits retry", async () => {
    const dir = tempDataDir(); const app = await makeApp(dir);
    try {
      const before = (await app.inject("/api/system/info")).json().counts;
      vi.spyOn(fs, "writeSync").mockImplementationOnce(() => { throw Object.assign(new Error("injected full disk"), { code: "ENOSPC" }); });
      const payload = Buffer.from('--fault\r\nContent-Disposition: form-data; name="file"; filename="retry.txt"\r\nContent-Type: text/plain\r\n\r\nretry content\r\n--fault--\r\n');
      const failed = await app.inject({ method: "POST", url: "/api/assets/import", headers: { "content-type": "multipart/form-data; boundary=fault" }, payload });
      expect(failed.statusCode).toBe(507); expect(failed.json().code).toBe("DISK_FULL");
      expect((await app.inject("/api/system/info")).json().counts.assets).toBe(before.assets);
      expect(fs.readdirSync(path.join(dir, "staging", "uploads"))).toEqual([]);
      const retry = await app.inject({ method: "POST", url: "/api/assets/import", headers: { "content-type": "multipart/form-data; boundary=fault" }, payload });
      expect(retry.statusCode).toBe(201);
      await expect(stageUpload(path.join(dir, "staging", "uploads"), Readable.from((async function* () { yield Buffer.from("partial"); throw new Error("broken stream"); })()))).rejects.toThrow("broken stream");
      expect(fs.readdirSync(path.join(dir, "staging", "uploads"))).toEqual([]);
    } finally { await app.close(); }
  });

  it("rejects an archive that silently omits a database file from its manifest", async () => {
    const dir = tempDataDir(); const ctx = createContext(createConfig({ APP_DATA_DIR: dir }));
    try {
      const file = ensureDemoFile(ctx, "image"); createAsset(ctx.db, { name: "不可遗漏", fileId: file.id });
      const { backup } = await createBackup(ctx.db, ctx.dataset.dir, dir, { datasetId: ctx.datasetId });
      const source = path.join(dir, "backups", backup.file_name);
      const { entries } = await listZipEntries(source);
      const contents = await Promise.all(entries.map(async (entry) => ({ name: entry.name, bytes: await readZipEntry(source, entry.name) })));
      const manifest = JSON.parse(contents.find((entry) => entry.name === "manifest.json")!.bytes.toString());
      manifest.files = [];
      const corrupt = path.join(dir, "staging", "omitted.zip");
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(corrupt); const archive = archiver("zip");
        output.on("close", resolve); output.on("error", reject); archive.on("error", reject); archive.pipe(output);
        for (const entry of contents) archive.append(entry.name === "manifest.json" ? JSON.stringify(manifest) : entry.bytes, { name: entry.name });
        void archive.finalize();
      });
      await expect(prepareRestore(ctx, corrupt, "遗漏.zip")).rejects.toThrow(/数量不一致|信息不一致/);
      expect(ctx.db.prepare("SELECT id FROM assets").all()).toHaveLength(1);
    } finally { ctx.close(); }
  });

  it("drains an accepted streaming import before switching datasets", async () => {
    const dir = tempDataDir(); const app = await makeApp(dir);
    const stream = new PassThrough();
    try {
      const before = (await app.inject("/api/system/info")).json();
      const upload = app.inject({ method: "POST", url: "/api/assets/import", headers: { "content-type": "multipart/form-data; boundary=slow" }, payload: stream }).then((response) => response);
      stream.write('--slow\r\nContent-Disposition: form-data; name="file"; filename="accepted.txt"\r\nContent-Type: text/plain\r\n\r\nfirst half');
      await vi.waitFor(() => expect(fs.readdirSync(path.join(dir, "staging", "uploads"))).toHaveLength(1));
      let switched = false;
      const reset = app.inject({ method: "POST", url: "/api/system/reset", payload: { datasetId: before.datasetId, confirmation: "清空本机数据" } }).then((result) => { switched = true; return result; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(switched).toBe(false);
      stream.end(' second half\r\n--slow--\r\n');
      const accepted = await upload;
      expect(accepted.statusCode).toBe(201); expect((await reset).statusCode).toBe(200);
      expect(fs.readFileSync(absoluteFilePath(path.join(dir, "datasets", before.datasetId), accepted.json().asset.file.relative_path), "utf8")).toBe("first half second half");
      expect((await app.inject("/api/assets")).json().items).toEqual([]);
    } finally { stream.destroy(); await app.close(); }
  });
});
