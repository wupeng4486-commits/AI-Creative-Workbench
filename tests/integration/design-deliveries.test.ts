import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContext, type AppContext } from "../../apps/server/src/context.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { ensureDemoFile, getDemoRun } from "../../apps/server/src/services/demo-runs.ts";
import { createDraft, updateDraft } from "../../apps/server/src/services/drafts.ts";
import { createAsset, deleteAsset } from "../../apps/server/src/services/assets.ts";
import { createDesignDelivery } from "../../apps/server/src/services/design-deliveries.ts";
import { absoluteFilePath, commitStagedFile, insertFile } from "../../apps/server/src/storage/files.ts";
import { makeApp, tempDataDir, cleanupDirs } from "../helpers/app.ts";

const contexts: AppContext[] = [];
const source = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#aaddff"/></svg>';
function setup() {
  const dataDir = tempDataDir();
  const ctx = createContext(createConfig({ APP_DATA_DIR: dataDir }));
  contexts.push(ctx);
  const preview = createAsset(ctx.db, { name: "交付预览.png", fileId: ensureDemoFile(ctx, "image").id });
  const staged = path.join(dataDir, "staging", "design-source");
  fs.writeFileSync(staged, source);
  const file = insertFile(ctx.db, commitStagedFile(ctx.dataset.dir, staged, "设计源文件.svg", "image/svg+xml", crypto.createHash("sha256").update(source).digest("hex")));
  const attachment = createAsset(ctx.db, { name: "设计源文件.svg", fileId: file.id });
  const draft = createDraft(ctx.db, { creationType: "design", requirements: "制作商品主视觉", assetIds: [preview.id, attachment.id], parameters: { designType: "主图", size: "320×200", copy: "清爽主视觉", deliveryRequirements: "含可编辑源文件", deliveryNote: "第一版交付", previewAssetId: preview.id, sourceAssetIds: [attachment.id] } });
  return { ctx, dataDir, draft, preview, attachment, file };
}
afterEach(() => { for (const ctx of contexts.splice(0)) ctx.close(); cleanupDirs(); });

describe("design delivery versions (T18)", () => {
  it("records real preview and source files with manual provenance and download content", () => {
    const { ctx, draft, file } = setup();
    const delivery = createDesignDelivery(ctx, draft.id, 1);
    const result = getDemoRun(ctx, delivery.id);
    expect(result).toMatchObject({ kind: "design_delivery", status: "completed", demo: false, progress: 100 });
    expect(result.items.map((item) => (item.result as { role: string }).role)).toEqual(["preview", "source"]);
    expect(fs.readFileSync(absoluteFilePath(ctx.dataset.dir, file.relative_path), "utf8")).toBe(source);
    expect(ctx.db.prepare("SELECT role FROM run_files WHERE run_id = ? ORDER BY role").all(delivery.id)).toEqual([{ role: "preview" }, { role: "source" }]);
  });

  it("keeps earlier delivery notes, requirements and files when a new version is registered", () => {
    const { ctx, draft } = setup();
    const first = createDesignDelivery(ctx, draft.id, 1);
    const original = getDemoRun(ctx, first.id);
    updateDraft(ctx.db, draft.id, 1, { requirements: "第二版设计需求", parameters: { ...draft.parameters, deliveryNote: "第二版修改版式" } });
    const second = getDemoRun(ctx, createDesignDelivery(ctx, draft.id, 2).id);
    expect(second.result).toMatchObject({ delivery: { version: 2, note: "第二版修改版式" } });
    expect(getDemoRun(ctx, first.id)).toEqual(original);
    expect(original.result).toMatchObject({ delivery: { version: 1, note: "第一版交付" } });
  });

  it("keeps historical source files readable after unlinking and deleting catalog assets", () => {
    const { ctx, draft, preview, attachment, file } = setup();
    const delivery = createDesignDelivery(ctx, draft.id, 1);
    updateDraft(ctx.db, draft.id, 1, { assetIds: [], parameters: { ...draft.parameters, previewAssetId: "", sourceAssetIds: [] } });
    expect(deleteAsset(ctx.db, ctx.dataset.dir, preview.id).retainedFile).toBe(true);
    expect(deleteAsset(ctx.db, ctx.dataset.dir, attachment.id).retainedFile).toBe(true);
    expect(fs.readFileSync(absoluteFilePath(ctx.dataset.dir, file.relative_path), "utf8")).toBe(source);
    expect(getDemoRun(ctx, delivery.id).items).toHaveLength(2);
  });

  it("reports missing design inputs without creating a delivery", () => {
    const { ctx, draft } = setup();
    updateDraft(ctx.db, draft.id, 1, { parameters: {} });
    expect(() => createDesignDelivery(ctx, draft.id, 2)).toThrow(/补充交付/);
    expect(ctx.db.prepare("SELECT id FROM runs").all()).toEqual([]);
  });

  it("rejects stale revisions and missing original files without partial version records", () => {
    const { ctx, draft, file } = setup();
    expect(() => createDesignDelivery(ctx, draft.id, 2)).toThrow(/草稿已变化/);
    fs.unlinkSync(absoluteFilePath(ctx.dataset.dir, file.relative_path));
    expect(() => createDesignDelivery(ctx, draft.id, 1)).toThrow(/原文件无法读取/);
    expect(ctx.db.prepare("SELECT id FROM runs").all()).toEqual([]);
    expect(ctx.db.prepare("SELECT id FROM run_items").all()).toEqual([]);
  });

  it("replays delivery requests and serves the same source after restarting the service", async () => {
    const { ctx, dataDir, draft } = setup();
    const app = await makeApp(dataDir);
    let id: string;
    try {
      const request = { method: "POST" as const, url: `/api/drafts/${draft.id}/deliveries`, headers: { "idempotency-key": "delivery-one" }, payload: { revision: 1 } };
      const first = await app.inject(request);
      const repeated = await app.inject(request);
      expect(first.statusCode).toBe(201);
      expect(repeated.statusCode).toBe(200);
      id = first.json().id;
      expect(repeated.json().id).toBe(id);
      expect(ctx.db.prepare("SELECT id FROM runs").all()).toHaveLength(1);
    } finally { await app.close(); }
    ctx.close();
    const restarted = await makeApp(dataDir);
    try {
      const run = (await restarted.inject({ url: `/api/runs/${id!}` })).json();
      const sourceItem = run.items.find((item: { result: { role: string } }) => item.result.role === "source");
      const downloaded = await restarted.inject({ url: sourceItem.result.downloadUrl });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.body).toBe(source);
      expect(run.result.delivery.note).toBe("第一版交付");
    } finally { await restarted.close(); }
  });
});
