import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/server/src/app.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { openActiveDataset } from "../../apps/server/src/db/datasets.ts";
import { seedDatabase } from "../../apps/server/src/db/seed.ts";
import {
  absoluteFilePath,
  commitStagedFile,
  describeFile,
  getFile,
  guessMimeType,
  insertFile,
  previewKind,
  quarantineUnregisteredFiles,
  stageUpload,
} from "../../apps/server/src/storage/files.ts";
import { readMediaMetadata } from "../../apps/server/src/storage/media.ts";
import { cleanupDirs, tempDataDir } from "../helpers/app.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/demo");

afterEach(cleanupDirs);

function multipartBody(fileName: string, content: Buffer) {
  const boundary = "----aiwtest" + crypto.randomBytes(6).toString("hex");
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${guessMimeType(fileName)}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat([head, content, tail]) };
}

async function importFixture(dataDir: string, name: string) {
  const dataset = openActiveDataset(dataDir);
  seedDatabase(dataset.db);
  const staged = await stageUpload(
    path.join(dataDir, "staging", "uploads"),
    Readable.from(fs.readFileSync(path.join(fixtures, name))),
  );
  const committed = commitStagedFile(
    dataset.dir,
    staged.stagingPath,
    name,
    guessMimeType(name),
    staged.sha256,
  );
  const record = insertFile(dataset.db, committed);
  dataset.db.close();
  return record;
}

describe("file storage and media metadata (T04)", () => {
  it("reads duration and size from MP4 fixtures without ffmpeg", () => {
    const a = readMediaMetadata(path.join(fixtures, "测试视频A-4秒.mp4"), "video/mp4");
    expect(a.duration).toBeCloseTo(4, 1);
    expect(a.width).toBe(640);
    expect(a.height).toBe(360);
    const b = readMediaMetadata(path.join(fixtures, "测试视频B-6秒.mp4"), "video/mp4");
    expect(b.duration).toBeCloseTo(6, 1);
  });

  it("reads PNG dimensions and classifies preview kinds", () => {
    const meta = readMediaMetadata(path.join(fixtures, "测试产品图.png"), "image/png");
    expect(meta).toEqual({ duration: null, width: 320, height: 200 });
    expect(previewKind("image/png")).toBe("image");
    expect(previewKind("video/mp4")).toBe("video");
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("application/octet-stream")).toBe("none");
  });

  it("stores the original file with a stable hash and metadata", async () => {
    const dataDir = tempDataDir();
    const record = await importFixture(dataDir, "测试视频C-5秒.mp4");
    const source = fs.readFileSync(path.join(fixtures, "测试视频C-5秒.mp4"));
    const stored = fs.readFileSync(
      absoluteFilePath(path.join(dataDir, "datasets", JSON.parse(fs.readFileSync(path.join(dataDir, "active.json"), "utf8")).datasetId), record.relative_path),
    );
    expect(stored.equals(source)).toBe(true);
    expect(record.sha256).toBe(crypto.createHash("sha256").update(source).digest("hex"));
    expect(record.duration).toBeCloseTo(5, 1);
    expect(fs.existsSync(path.join(dataDir, "datasets", JSON.parse(fs.readFileSync(path.join(dataDir, "active.json"), "utf8")).datasetId, "previews", record.id, "thumb.png"))).toBe(true);
  });

  it("does not create a record when the write is incomplete or stream fails", async () => {
    const dataDir = tempDataDir();
    const dataset = openActiveDataset(dataDir);
    seedDatabase(dataset.db);
    const stream = Readable.from(
      (function* () {
        yield Buffer.from("partial");
        throw new Error("network reset");
      })(),
    );
    await expect(
      stageUpload(path.join(dataDir, "staging", "uploads"), stream),
    ).rejects.toThrow("network reset");
    const count = dataset.db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number };
    expect(count.c).toBe(0);
    dataset.db.close();
  });

  it("quarantines unregistered files instead of deleting them", () => {
    const dataDir = tempDataDir();
    const dataset = openActiveDataset(dataDir);
    seedDatabase(dataset.db);
    const stray = path.join(dataset.dir, "files", "orphan-id");
    fs.mkdirSync(stray, { recursive: true });
    fs.writeFileSync(path.join(stray, "original.txt"), "orphan");
    const moved = quarantineUnregisteredFiles(dataset.dir, dataset.db);
    expect(moved).toEqual(["orphan-id"]);
    expect(fs.existsSync(path.join(dataset.dir, "quarantine", "orphan-id", "original.txt"))).toBe(
      true,
    );
    dataset.db.close();
  });

  it("accepts a multipart upload through the HTTP route", async () => {
    const dataDir = tempDataDir();
    const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
    const content = fs.readFileSync(path.join(fixtures, "测试附件.txt"));
    const { boundary, body } = multipartBody("测试附件 中文 名.txt", content);
    const response = await app.inject({
      method: "POST",
      url: "/api/files/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    const json = response.json();
    expect(json.file.original_name).toBe("测试附件 中文 名.txt");
    expect(json.file.size).toBe(content.length);
    expect(json.downloadUrl).toContain("/download");
    await app.close();
  });

  it("serves full content, byte ranges and downloads with a matching hash", async () => {
    const dataDir = tempDataDir();
    const record = await importFixture(dataDir, "测试视频A-4秒.mp4");
    const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });

    const full = await app.inject({ url: `/api/files/${record.id}/content` });
    expect(full.statusCode).toBe(200);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.rawPayload.length).toBe(record.size);

    const partial = await app.inject({
      url: `/api/files/${record.id}/content`,
      headers: { range: "bytes=100-199" },
    });
    expect(partial.statusCode).toBe(206);
    expect(partial.headers["content-range"]).toBe(`bytes 100-199/${record.size}`);
    expect(partial.rawPayload.length).toBe(100);
    expect(partial.rawPayload.equals(full.rawPayload.subarray(100, 200))).toBe(true);

    const invalid = await app.inject({
      url: `/api/files/${record.id}/content`,
      headers: { range: `bytes=${record.size + 10}-` },
    });
    expect(invalid.statusCode).toBe(416);

    const download = await app.inject({ url: `/api/files/${record.id}/download` });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-disposition"]).toContain(
      encodeURIComponent("测试视频A-4秒.mp4"),
    );
    const expectedHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(fixtures, "测试视频A-4秒.mp4")))
      .digest("hex");
    expect(crypto.createHash("sha256").update(download.rawPayload).digest("hex")).toBe(
      expectedHash,
    );
    await app.close();
  });

  it("returns text previews and rejects unknown files", async () => {
    const dataDir = tempDataDir();
    const record = await importFixture(dataDir, "测试附件.txt");
    const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
    const text = await app.inject({ url: `/api/files/${record.id}/text` });
    expect(text.statusCode).toBe(200);
    expect(text.json().text).toContain("测试附件");
    const missing = await app.inject({ url: "/api/files/does-not-exist" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("FILE_NOT_FOUND");
    await app.close();
  });

  it("describes unsupported previews with download only", async () => {
    const dataDir = tempDataDir();
    const dataset = openActiveDataset(dataDir);
    seedDatabase(dataset.db);
    const staged = await stageUpload(
      path.join(dataDir, "staging", "uploads"),
      Readable.from(Buffer.from("binary")),
    );
    const committed = commitStagedFile(
      dataset.dir,
      staged.stagingPath,
      "测试附件.zip",
      "application/zip",
      staged.sha256,
    );
    const record = insertFile(dataset.db, committed);
    const described = describeFile(getFile(dataset.db, record.id)!);
    expect(described.previewKind).toBe("none");
    expect(described.previewUrl).toBeNull();
    expect(described.downloadUrl).toBe(`/api/files/${record.id}/download`);
    dataset.db.close();
  });

  it("keeps same-named files as distinct records", async () => {
    const dataDir = tempDataDir();
    const first = await importFixture(dataDir, "测试产品图.png");
    const second = await importFixture(dataDir, "测试产品图.png");
    expect(first.id).not.toBe(second.id);
    expect(first.relative_path).not.toBe(second.relative_path);
    expect(first.sha256).toBe(second.sha256);
  });
});
