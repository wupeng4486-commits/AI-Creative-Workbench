import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/server/src/app.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { validateWebUrl } from "../../apps/server/src/services/settings.ts";
import { cleanupDirs, tempDataDir } from "../helpers/app.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/demo");

afterEach(cleanupDirs);

async function withApp() {
  const dataDir = tempDataDir();
  const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
  return { dataDir, app };
}

async function importImage(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
  const boundary = "----c" + crypto.randomBytes(4).toString("hex");
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    fs.readFileSync(path.join(fixtures, name)),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: "POST",
    url: "/api/assets/import",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  return response.json().asset;
}

describe("case collections (T10)", () => {
  it("lets one original file belong to several collections", async () => {
    const { app } = await withApp();
    const asset = await importImage(app, "测试产品图.png");
    const first = (
      await app.inject({
        method: "POST",
        url: "/api/collections",
        payload: { name: "参考案例", category: "reference", assetIds: [asset.id] },
      })
    ).json().collection;
    const second = (
      await app.inject({
        method: "POST",
        url: "/api/collections",
        payload: { name: "优秀案例", category: "excellent" },
      })
    ).json().collection;
    await app.inject({
      method: "POST",
      url: `/api/collections/${second.id}/items`,
      payload: { assetId: asset.id },
    });

    for (const id of [first.id, second.id]) {
      const detail = await app.inject({ url: `/api/collections/${id}` });
      expect(detail.json().items).toHaveLength(1);
      expect(detail.json().items[0].id).toBe(asset.id);
      expect(detail.json().items[0].mime_type).toBe("image/png");
    }
    const list = await app.inject({ url: "/api/collections" });
    expect(list.json().items.map((item: { name: string }) => item.name)).toEqual(
      expect.arrayContaining(["参考案例", "优秀案例"]),
    );
    const info = await app.inject({ url: "/api/system/info" });
    expect(info.json().counts.assets).toBe(1);
    await app.close();
  });

  it("removes a collection item without deleting the asset or file", async () => {
    const { app } = await withApp();
    const asset = await importImage(app, "测试产品图.png");
    const collection = (
      await app.inject({
        method: "POST",
        url: "/api/collections",
        payload: { name: "临时集合", assetIds: [asset.id] },
      })
    ).json().collection;
    await app.inject({
      method: "DELETE",
      url: `/api/collections/${collection.id}/items/${asset.id}`,
    });
    const detail = await app.inject({ url: `/api/collections/${collection.id}` });
    expect(detail.json().items).toEqual([]);
    const assetAfter = await app.inject({ url: `/api/assets/${asset.id}` });
    expect(assetAfter.statusCode).toBe(200);
    expect(assetAfter.json().asset.id).toBe(asset.id);
    await app.close();
  });

  it("rejects an unknown asset when creating a collection", async () => {
    const { app } = await withApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "坏集合", assetIds: ["missing-asset"] },
    });
    expect(response.statusCode).toBe(404);
    const list = await app.inject({ url: "/api/collections" });
    expect(list.json().items).toEqual([]);
    await app.close();
  });

  it("requires a collection name", async () => {
    const { app } = await withApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: "  " },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().fieldErrors.name).toBeTruthy();
    await app.close();
  });
});

describe("NAS and shared integrations (T10)", () => {
  it("accepts web and Windows path entries and returns them from one source", async () => {
    const { app } = await withApp();
    const web = await app.inject({
      method: "POST",
      url: "/api/settings/nas",
      payload: { name: "团队 NAS 网页", type: "web", address: "http://192.168.1.10:5000", note: "只读" },
    });
    expect(web.statusCode).toBe(201);
    const win = await app.inject({
      method: "POST",
      url: "/api/settings/nas",
      payload: { name: "共享盘", type: "windows_path", address: "\\\\192.168.1.10\\素材\\产品" },
    });
    expect(win.statusCode).toBe(201);

    const settings = await app.inject({ url: "/api/system/settings" });
    const nas = settings.json().integrations.nas;
    expect(nas).toHaveLength(2);
    expect(nas[1].address).toBe("\\\\192.168.1.10\\素材\\产品");
    const info = await app.inject({ url: "/api/system/info" });
    expect(info.json().counts.assets).toBe(0);
    await app.close();
  });

  it("rejects invalid web addresses but keeps existing entries", async () => {
    const { app } = await withApp();
    await app.inject({
      method: "POST",
      url: "/api/settings/nas",
      payload: { name: "有效", type: "web", address: "https://nas.example.com" },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/settings/nas",
      payload: { name: "无效", type: "web", address: "ftp://nas.example.com" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().fieldErrors.address).toContain("http");
    const settings = await app.inject({ url: "/api/system/settings" });
    expect(settings.json().integrations.nas).toHaveLength(1);
    await app.close();
  });

  it("shares LibTV and Jianying config across endpoints and survives restart", async () => {
    const { dataDir, app } = await withApp();
    await app.inject({
      method: "PATCH",
      url: "/api/settings/integrations/libtv",
      payload: { url: "https://libtv.example.com/workbench", note: "团队入口" },
    });
    await app.inject({
      method: "PATCH",
      url: "/api/settings/integrations/jianying",
      payload: { url: "https://example.com/jianying", note: "剪映网页" },
    });
    const settings = await app.inject({ url: "/api/system/settings" });
    expect(settings.json().integrations.libtv.url).toBe("https://libtv.example.com/workbench");
    expect(settings.json().integrations.jianying.note).toBe("剪映网页");
    await app.close();

    const reopened = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
    const again = await reopened.inject({ url: "/api/settings" });
    expect(again.json().integrations.libtv.url).toBe("https://libtv.example.com/workbench");
    await reopened.close();
  });

  it("validates web entry protocols", () => {
    expect(validateWebUrl("")).toBeNull();
    expect(validateWebUrl("http://127.0.0.1:8080")).toBeNull();
    expect(validateWebUrl("https://nas.example.com/path")).toBeNull();
    expect(validateWebUrl("file:///C:/share")).toContain("http");
    expect(validateWebUrl("not a url")).toContain("有效");
  });

  it("saves sidebar and list preferences", async () => {
    const { app } = await withApp();
    const patched = await app.inject({
      method: "PATCH",
      url: "/api/settings/preferences",
      payload: { sidebarCollapsed: true, assetView: "grid" },
    });
    expect(patched.json().preferences).toEqual({ sidebarCollapsed: true, assetView: "grid" });
    await app.close();
  });
});
