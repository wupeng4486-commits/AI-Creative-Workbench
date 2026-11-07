import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/server/src/app.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { filterAssets } from "../../apps/server/src/routes/assets.ts";
import { cleanupDirs, tempDataDir } from "../helpers/app.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/demo");

afterEach(cleanupDirs);

async function withApp() {
  const dataDir = tempDataDir();
  const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
  return { dataDir, app };
}

function uploadPayload(name: string, content: Buffer, fields: Record<string, string> = {}) {
  const boundary = "----assets" + crypto.randomBytes(5).toString("hex");
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
  );
  parts.push(content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

describe("asset filters (T09)", () => {
  const rows = [
    {
      id: "a1",
      name: "测试产品图",
      asset_type: "image",
      file_id: null,
      origin: "owned",
      provenance: "user_import",
      tags: ["产品", "主图"],
      notes: "蓝色产品",
      catalog: "file",
      created_at: "",
      updated_at: "",
    },
    {
      id: "a2",
      name: "共享参考视频",
      asset_type: "video",
      file_id: null,
      origin: "shared",
      provenance: "seed",
      tags: ["参考"],
      notes: "",
      catalog: "file",
      created_at: "",
      updated_at: "",
    },
  ] as never[];

  it("matches name, notes and tags", () => {
    expect(filterAssets(rows, { search: "蓝色" }).map((row) => row.id)).toEqual(["a1"]);
    expect(filterAssets(rows, { search: "参考" }).map((row) => row.id)).toEqual(["a2"]);
  });

  it("combines type, origin and tag filters", () => {
    expect(filterAssets(rows, { type: "video,image" }).length).toBe(2);
    expect(filterAssets(rows, { origin: "shared" }).map((row) => row.id)).toEqual(["a2"]);
    expect(filterAssets(rows, { tag: "主图" }).map((row) => row.id)).toEqual(["a1"]);
    expect(filterAssets(rows, { type: "image", origin: "shared" })).toEqual([]);
  });
});

describe("asset API (T09)", () => {
  it("imports an image with real metadata and keeps it after restart", async () => {
    const { dataDir, app } = await withApp();
    const { boundary, body } = uploadPayload(
      "测试产品图.png",
      fs.readFileSync(path.join(fixtures, "测试产品图.png")),
      { tags: "产品,主图", origin: "owned", notes: "蓝色产品图" },
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/assets/import",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    const asset = created.json().asset;
    expect(asset.name).toBe("测试产品图.png");
    expect(asset.tags).toEqual(["产品", "主图"]);
    expect(asset.file.width).toBe(320);
    expect(asset.file.height).toBe(200);
    expect(asset.previewKind).toBe("image");
    expect(asset.thumbUrl).toContain("/thumb");

    const content = await app.inject({ url: asset.contentUrl });
    expect(content.statusCode).toBe(200);
    expect(
      crypto.createHash("sha256").update(content.rawPayload).digest("hex"),
    ).toBe(asset.file.sha256);
    await app.close();

    const reopened = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
    const list = await reopened.inject({ url: "/api/assets" });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].name).toBe("测试产品图.png");
    await reopened.close();
  });

  it("stores video duration and supports search, tag and source filters", async () => {
    const { app } = await withApp();
    const { boundary, body } = uploadPayload(
      "测试视频B-6秒.mp4",
      fs.readFileSync(path.join(fixtures, "测试视频B-6秒.mp4")),
      { tags: "贴贴片", origin: "shared" },
    );
    const upload = await app.inject({
      method: "POST",
      url: "/api/assets/import",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json().asset.file.duration).toBeCloseTo(6, 1);

    const byTag = await app.inject({ url: "/api/assets?tag=" + encodeURIComponent("贴贴片") });
    expect(byTag.json().items).toHaveLength(1);
    const byOrigin = await app.inject({ url: "/api/assets?origin=shared" });
    expect(byOrigin.json().items).toHaveLength(1);
    const bySearch = await app.inject({ url: "/api/assets?search=" + encodeURIComponent("视频") });
    expect(bySearch.json().items).toHaveLength(1);
    const none = await app.inject({ url: "/api/assets?search=不存在" });
    expect(none.json().items).toEqual([]);
    expect(none.json().tags).toContain("贴贴片");
    await app.close();
  });

  it("edits name, tags and notes and records the activity", async () => {
    const { app } = await withApp();
    const { boundary, body } = uploadPayload("a.txt", Buffer.from("hello"));
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/assets/import",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
    ).json().asset;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/assets/${created.id}`,
      payload: { name: "改名后的附件", tags: ["整理"], notes: "备注" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().asset).toMatchObject({ name: "改名后的附件", tags: ["整理"], notes: "备注" });
    const info = await app.inject({ url: "/api/system/info" });
    expect(info.json().counts.assets).toBe(1);
    await app.close();
  });

  it("does not create an asset when the upload has no file", async () => {
    const { app } = await withApp();
    const boundary = "----empty";
    const response = await app.inject({
      method: "POST",
      url: "/api/assets/import",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\nx\r\n--${boundary}--\r\n`),
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const list = await app.inject({ url: "/api/assets" });
    expect(list.json().items).toEqual([]);
    await app.close();
  });

  it("creates product knowledge linked to an asset record", async () => {
    const { app } = await withApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: {
        name: "测试商品",
        sku: "T-001",
        description: "用于测试",
        sellingPoints: ["卖点一", "卖点二"],
        packageVersion: "v1",
        notes: "注意",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().asset.catalog).toBe("product");
    const products = await app.inject({ url: "/api/products" });
    expect(products.json().items[0].sellingPoints).toEqual(["卖点一", "卖点二"]);
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/products/${created.json().asset.id}`,
      payload: { sellingPoints: ["新卖点"] },
    });
    expect(patched.json().asset).toBeTruthy();
    const updated = await app.inject({ url: "/api/products" });
    expect(updated.json().items[0].selling_points).toContain("新卖点");
    await app.close();
  });

  it("rejects an empty product name and an unknown asset id", async () => {
    const { app } = await withApp();
    const invalid = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: { name: "" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().fieldErrors.name).toBeTruthy();
    const missing = await app.inject({ url: "/api/assets/nope" });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("blocks deleting an asset used by a draft and lists the reference", async () => {
    const { app } = await withApp();
    const { boundary, body } = uploadPayload("used.png", fs.readFileSync(path.join(fixtures, "测试产品图.png")));
    const asset = (
      await app.inject({
        method: "POST",
        url: "/api/assets/import",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
    ).json().asset;
    const info = (await app.inject({ url: "/api/system/info" })).json();
    const draftId = "draft-ref-1";
    // Draft APIs arrive in T16; insert the reference directly for now.
    const dataset = (await import("../../apps/server/src/db/datasets.ts")).openDatabase(
      info.dataDir,
      info.datasetId,
    );
    dataset
      .prepare(
        `INSERT INTO drafts (id, creation_type, name, created_at, updated_at) VALUES (?, 'ai_image', '引用草稿', ?, ?)`,
      )
      .run(draftId, new Date().toISOString(), new Date().toISOString());
    dataset.prepare("INSERT INTO draft_assets (draft_id, asset_id) VALUES (?, ?)").run(draftId, asset.id);
    dataset.close();

    const blocked = await app.inject({ method: "DELETE", url: `/api/assets/${asset.id}` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("RESOURCE_REFERENCED");
    expect(blocked.json().references[0].label).toBe("引用草稿");
    await app.close();
  });
});
