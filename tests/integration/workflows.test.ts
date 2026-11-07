import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { makeApp, tempDataDir, cleanupDirs } from "../helpers/app.ts";
import { openActiveDataset } from "../../apps/server/src/db/datasets.ts";

const apps: FastifyInstance[] = [];
async function start(dataDir = tempDataDir()) {
  const app = await makeApp(dataDir);
  apps.push(app);
  return app;
}
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  cleanupDirs();
});

describe("team workflows (T13)", () => {
  it("lists team data with source and purpose filters and searches steps", async () => {
    const app = await start();
    const all = (await app.inject({ url: "/api/workflows" })).json();
    expect(all.items).toHaveLength(4);
    const shared = (await app.inject({ url: "/api/workflows?origin=shared" })).json().items;
    expect(shared).toHaveLength(2);
    expect(shared.every((item: { origin: string }) => item.origin === "shared")).toBe(true);
    const purpose = all.items[0].purpose;
    const filtered = (await app.inject({ url: "/api/workflows?purpose=" + encodeURIComponent(purpose) })).json().items;
    expect(filtered.every((item: { purpose: string }) => item.purpose === purpose)).toBe(true);
    expect((await app.inject({ url: "/api/workflows?search=" + encodeURIComponent("标记区域") })).json().items[0].id).toBe("seed-workflow-desubtitle");
  });

  it("persists references, default parameters, steps and real attachments across restart", async () => {
    const dataDir = tempDataDir();
    const app = await start(dataDir);
    const payload = '--flow\r\nContent-Disposition: form-data; name="file"; filename="workflow.json"\r\nContent-Type: application/json\r\n\r\n{"flow":"demo"}\r\n--flow--\r\n';
    const imported = await app.inject({ method: "POST", url: "/api/assets/import", headers: { "content-type": "multipart/form-data; boundary=flow" }, payload });
    expect(imported.statusCode).toBe(201);
    const asset = imported.json().asset;
    const created = await app.inject({ method: "POST", url: "/api/workflows", payload: {
      name: "交付工作流", purpose: "交付检查", libtvRef: "libtv://workflow/check", inputSpec: "成片和源文件",
      defaultParameters: { ratio: "9:16", nested: { count: 2 } }, steps: ["检查", "交付"],
      skillIds: ["seed-skill-delivery-check"], assetIds: [asset.id],
    } });
    expect(created.statusCode).toBe(201);
    const id = created.json().workflow.id;
    await app.close();
    const restarted = await start(dataDir);
    const detail = (await restarted.inject({ url: `/api/workflows/${id}` })).json().workflow;
    expect(detail).toMatchObject({ name: "交付工作流", libtv_ref: "libtv://workflow/check", default_parameters: { ratio: "9:16", nested: { count: 2 } }, steps: ["检查", "交付"] });
    expect(detail.skills[0].id).toBe("seed-skill-delivery-check");
    expect(detail.assets[0].id).toBe(asset.id);
    expect((await restarted.inject({ url: detail.assets[0].downloadUrl })).body).toBe('{"flow":"demo"}');
    expect((await restarted.inject({ method: "DELETE", url: `/api/assets/${asset.id}` })).statusCode).toBe(409);
  });

  it("copies a shared workflow independently and prevents direct shared writes", async () => {
    const app = await start();
    const url = "/api/workflows/seed-workflow-product-show";
    const original = (await app.inject({ url })).json().workflow;
    expect((await app.inject({ method: "PATCH", url, payload: { name: "覆盖" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(403);
    const copied = (await app.inject({ method: "POST", url: `${url}/copy` })).json().workflow;
    expect(copied.origin).toBe("owned");
    expect(copied.id).not.toBe(original.id);
    expect(copied.default_parameters).toEqual(original.default_parameters);
    await app.inject({ method: "PATCH", url: `/api/workflows/${copied.id}`, payload: { steps: ["独立新步骤"], defaultParameters: { count: 7 } } });
    expect((await app.inject({ url })).json().workflow).toEqual(original);
  });

  it("validates names, parameter objects and cover images", async () => {
    const app = await start();
    for (const payload of [{ name: " " }, { name: "错误参数", defaultParameters: [] }, { name: "错误封面", coverFileId: "absent" }]) {
      expect((await app.inject({ method: "POST", url: "/api/workflows", payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ url: "/api/workflows" })).json().items).toHaveLength(4);
  });

  it("rolls back metadata and relations when an update fails", async () => {
    const app = await start();
    const url = "/api/workflows/seed-workflow-tietie";
    const before = (await app.inject({ url })).json().workflow;
    const failed = await app.inject({ method: "PATCH", url, payload: { name: "不应保存", skillIds: [], assetIds: ["missing"] } });
    expect(failed.statusCode).toBe(404);
    expect((await app.inject({ url })).json().workflow).toEqual(before);
  });

  it("previewing a flow never starts a run or changes metadata", async () => {
    const app = await start();
    const before = (await app.inject({ url: "/api/system/info" })).json().counts;
    const first = (await app.inject({ url: "/api/workflows/seed-workflow-tietie" })).json();
    expect((await app.inject({ url: "/api/workflows/seed-workflow-tietie" })).json()).toEqual(first);
    expect((await app.inject({ url: "/api/system/info" })).json().counts).toEqual(before);
  });

  it("protects draft references and keeps deletion across restart", async () => {
    const dataDir = tempDataDir();
    const app = await start(dataDir);
    const dataset = openActiveDataset(dataDir);
    dataset.db.prepare("INSERT INTO drafts (id, creation_type, name, workflow_id, created_at, updated_at) VALUES ('flow-draft', 'ai_video', '流程草稿', 'seed-workflow-tietie', 't', 't')").run();
    dataset.db.close();
    const blocked = await app.inject({ method: "DELETE", url: "/api/workflows/seed-workflow-tietie" });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().references[0].label).toBe("流程草稿");
    const next = openActiveDataset(dataDir);
    next.db.prepare("UPDATE drafts SET workflow_id = NULL WHERE id = 'flow-draft'").run();
    next.db.close();
    expect((await app.inject({ method: "DELETE", url: "/api/workflows/seed-workflow-tietie" })).statusCode).toBe(200);
    await app.close();
    expect((await (await start(dataDir)).inject({ url: "/api/workflows/seed-workflow-tietie" })).statusCode).toBe(404);
  });
});
