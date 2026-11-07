import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { makeApp, tempDataDir, cleanupDirs } from "../helpers/app.ts";
import { openActiveDataset } from "../../apps/server/src/db/datasets.ts";
import { createAsset } from "../../apps/server/src/services/assets.ts";

const apps: FastifyInstance[] = [];
async function start(dataDir = tempDataDir()) { const app = await makeApp(dataDir); apps.push(app); return app; }
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); cleanupDirs(); });

describe("studio drafts (T16)", () => {
  it("creates all four types and replays a repeated creation key", async () => {
    const app = await start();
    for (const creationType of ["ai_video", "ai_image", "design", "video_join"]) {
      const request = { method: "POST" as const, url: "/api/drafts", headers: { "idempotency-key": `draft-${creationType}` }, payload: { creationType } };
      const created = await app.inject(request);
      const repeated = await app.inject(request);
      expect(created.statusCode).toBe(201);
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().draft.id).toBe(created.json().draft.id);
      expect(created.json().draft).toMatchObject({ creationType, revision: 1, assetIds: [], skillIds: [] });
    }
    expect((await app.inject({ url: "/api/drafts" })).json().items).toHaveLength(4);
  });

  it("carries agent knowledge and workflow defaults as adjustable references", async () => {
    const app = await start();
    const created = await app.inject({ method: "POST", url: "/api/drafts", payload: { creationType: "ai_video", agentId: "seed-agent-director", workflowId: "seed-workflow-tietie", parameters: { duration: 24 } } });
    expect(created.statusCode).toBe(201);
    const draft = created.json().draft;
    expect(draft.agentId).toBe("seed-agent-director");
    expect(draft.skillIds.sort()).toEqual(["seed-skill-delivery-check", "seed-skill-video-breakdown"]);
    expect(draft.parameters).toEqual({ duration: 24, ratio: "9:16", shotRequirements: "" });
    const adjusted = await app.inject({ method: "PATCH", url: `/api/drafts/${draft.id}`, payload: { revision: 1, agentId: null, skillIds: [], productId: "seed-product-sunscreen" } });
    expect(adjusted.json().draft).toMatchObject({ agentId: null, skillIds: [], productId: "seed-product-sunscreen", revision: 2 });
  });

  it("returns the current revision without overwriting a newer save", async () => {
    const app = await start();
    const draft = (await app.inject({ method: "POST", url: "/api/drafts", payload: { creationType: "ai_image" } })).json().draft;
    await app.inject({ method: "PATCH", url: `/api/drafts/${draft.id}`, payload: { revision: 1, requirements: "最新输入" } });
    const stale = await app.inject({ method: "PATCH", url: `/api/drafts/${draft.id}`, payload: { revision: 1, requirements: "陈旧输入" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "REVISION_CONFLICT", currentRevision: 2 });
    expect((await app.inject({ url: `/api/drafts/${draft.id}` })).json().draft.requirements).toBe("最新输入");
  });

  it("serializes competing revision writes so only one succeeds", async () => {
    const app = await start();
    const draft = (await app.inject({ method: "POST", url: "/api/drafts", payload: { creationType: "design" } })).json().draft;
    const responses = await Promise.all(["页面一", "页面二"].map((requirements) => app.inject({ method: "PATCH", url: `/api/drafts/${draft.id}`, payload: { revision: 1, requirements } })));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect((await app.inject({ url: `/api/drafts/${draft.id}` })).json().draft.revision).toBe(2);
  });

  it("rolls back metadata, references and revision when a save fails", async () => {
    const app = await start();
    const draft = (await app.inject({ method: "POST", url: "/api/drafts", payload: { creationType: "ai_video", skillIds: ["seed-skill-ai-image"] } })).json().draft;
    const failed = await app.inject({ method: "PATCH", url: `/api/drafts/${draft.id}`, payload: { revision: 1, name: "不应保存", skillIds: [], assetIds: ["missing-asset"] } });
    expect(failed.statusCode).toBe(404);
    expect((await app.inject({ url: `/api/drafts/${draft.id}` })).json().draft).toEqual(draft);
  });

  it("rejects old-dataset writes without modifying the current dataset", async () => {
    const app = await start();
    const draft = (await app.inject({ method: "POST", url: "/api/drafts", payload: { creationType: "ai_video" } })).json().draft;
    const stale = await app.inject({ method: "PATCH", url: `/api/drafts/${draft.id}`, headers: { "x-dataset-id": "old-dataset" }, payload: { revision: 1, requirements: "旧页面输入" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("DATASET_CHANGED");
    expect(stale.json().datasetId).toBeTruthy();
    expect((await app.inject({ url: `/api/drafts/${draft.id}` })).json().draft.revision).toBe(1);
  });

  it("joins carried assets and skills while retaining existing draft input", async () => {
    const dataDir = tempDataDir();
    const app = await start(dataDir);
    const dataset = openActiveDataset(dataDir);
    const first = createAsset(dataset.db, { name: "现有素材" });
    const second = createAsset(dataset.db, { name: "新带入素材" });
    dataset.db.close();
    const draft = (await app.inject({ method: "POST", url: "/api/drafts", payload: { creationType: "ai_video", name: "当前草稿", requirements: "已有要求", assetIds: [first.id], parameters: { duration: 12 } } })).json().draft;
    const joined = await app.inject({ method: "POST", url: `/api/drafts/${draft.id}/carry`, payload: { revision: 1, assetIds: [second.id], skillIds: ["seed-skill-ai-image"], workflowId: "seed-workflow-tietie" } });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().draft.assetIds).toEqual([first.id, second.id]);
    expect(joined.json().draft.requirements).toBe("已有要求");
    expect(joined.json().draft.parameters).toEqual({ duration: 12, ratio: "9:16", shotRequirements: "" });
    expect((await app.inject({ url: "/api/assets" })).json().items).toHaveLength(2);
    expect((await app.inject({ method: "DELETE", url: `/api/assets/${second.id}` })).statusCode).toBe(409);
  });

  it("restores saved draft requirements, parameters and choices after service restart", async () => {
    const dataDir = tempDataDir();
    const app = await start(dataDir);
    const draft = (await app.inject({ method: "POST", url: "/api/drafts", payload: { creationType: "design", name: "重开设计稿" } })).json().draft;
    await app.inject({ method: "PATCH", url: `/api/drafts/${draft.id}`, payload: { revision: 1, requirements: "源文件与预览", parameters: { size: "1200x1600", copies: 2 }, productId: "seed-product-sunscreen", skillIds: ["seed-skill-design-spec"] } });
    await app.close();
    const restarted = await start(dataDir);
    const restored = (await restarted.inject({ url: `/api/drafts/${draft.id}` })).json().draft;
    expect(restored).toMatchObject({ revision: 2, requirements: "源文件与预览", parameters: { size: "1200x1600", copies: 2 }, productId: "seed-product-sunscreen", skillIds: ["seed-skill-design-spec"] });
  });

  it("handles pre-existing drafts and rejects unsupported types", async () => {
    const dataDir = tempDataDir();
    const app = await start(dataDir);
    const dataset = openActiveDataset(dataDir);
    dataset.db.prepare("INSERT INTO drafts (id, creation_type, name, created_at, updated_at) VALUES ('legacy-draft', 'ai_video', '已有草稿', 't', 't')").run();
    dataset.db.close();
    expect((await app.inject({ url: "/api/drafts/legacy-draft" })).json().draft).toMatchObject({ parameters: {}, assetIds: [], skillIds: [], revision: 1 });
    expect((await app.inject({ method: "POST", url: "/api/drafts", payload: { creationType: "unknown" } })).statusCode).toBe(400);
  });
});
