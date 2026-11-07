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

describe("agents (T12)", () => {
  it("lists six examples with source, purpose, related counts and filters", async () => {
    const app = await start();
    const list = (await app.inject({ url: "/api/agents" })).json();
    expect(list.items).toHaveLength(6);
    expect(list.items.find((agent: { id: string }) => agent.id === "seed-agent-director").skills.map((skill: { id: string }) => skill.id).sort())
      .toEqual(["seed-skill-delivery-check", "seed-skill-video-breakdown"]);
    const shared = (await app.inject({ url: "/api/agents?origin=shared" })).json();
    expect(shared.items.length).toBeGreaterThan(0);
    expect(shared.items.every((agent: { origin: string }) => agent.origin === "shared")).toBe(true);
    const filtered = (await app.inject({ url: "/api/agents?domain=" + encodeURIComponent("美工") })).json();
    expect(filtered.items.map((agent: { name: string }) => agent.name)).toContain("美工设计助手");
    expect((await app.inject({ url: "/api/agents?search=absent-agent" })).json().items).toEqual([]);
  });

  it("validates required fields and malformed dialogue", async () => {
    const app = await start();
    const missing = await app.inject({ method: "POST", url: "/api/agents", payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().fieldErrors).toMatchObject({ name: expect.any(String), purpose: expect.any(String) });
    const invalid = await app.inject({ method: "POST", url: "/api/agents", payload: { name: "错误", purpose: "验证", exampleDialog: [{ question: "问题" }] } });
    expect(invalid.statusCode).toBe(400);
  });

  it("saves instructions, dialogue and knowledge references across restart", async () => {
    const dataDir = tempDataDir();
    const app = await start(dataDir);
    const created = await app.inject({ method: "POST", url: "/api/agents", payload: {
      name: "测试导演", purpose: "制作广告", domain: "AI 视频", skillIds: ["seed-skill-video-breakdown"], productIds: ["seed-product-sunscreen"],
    } });
    expect(created.statusCode).toBe(201);
    const id = created.json().agent.id;
    const patched = await app.inject({ method: "PATCH", url: `/api/agents/${id}`, payload: {
      name: "更新导演", instructions: "逐镜头输出", outputRequirements: "分镜表", cautions: "核对商品信息",
      exampleDialog: [{ question: "如何开场", answer: "先展示商品" }],
    } });
    expect(patched.statusCode).toBe(200);
    await app.close();
    const reopened = await start(dataDir);
    const agent = (await reopened.inject({ url: `/api/agents/${id}` })).json().agent;
    expect(agent).toMatchObject({ name: "更新导演", instructions: "逐镜头输出", output_requirements: "分镜表", cautions: "核对商品信息", example_dialog: [{ question: "如何开场", answer: "先展示商品" }] });
    expect(agent.skills.map((item: { id: string }) => item.id)).toEqual(["seed-skill-video-breakdown"]);
    expect(agent.products.map((item: { id: string }) => item.id)).toEqual(["seed-product-sunscreen"]);
    expect((await reopened.inject({ url: "/api/skills/seed-skill-video-breakdown" })).json().skill.agents.map((item: { id: string }) => item.id)).toContain(id);
  });

  it("copies shared data and references into an independent owned record", async () => {
    const app = await start();
    const source = (await app.inject({ url: "/api/agents/seed-agent-visual" })).json().agent;
    const copied = (await app.inject({ method: "POST", url: "/api/agents/seed-agent-visual/copy" })).json().agent;
    expect(copied.id).not.toBe(source.id);
    expect(copied.origin).toBe("owned");
    expect(copied.skills).toEqual(source.skills);
    expect(copied.example_dialog).toEqual(source.example_dialog);
    await app.inject({ method: "PATCH", url: `/api/agents/${copied.id}`, payload: { instructions: "副本的新指令", skillIds: [] } });
    expect((await app.inject({ url: `/api/agents/${source.id}` })).json().agent).toEqual(source);
  });

  it("protects shared agents from direct writes and deletion", async () => {
    const app = await start();
    const url = "/api/agents/seed-agent-visual";
    expect((await app.inject({ method: "PATCH", url, payload: { name: "覆盖" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(403);
  });

  it("rolls back body edits and all references when an association fails", async () => {
    const app = await start();
    const url = "/api/agents/seed-agent-director";
    const before = (await app.inject({ url })).json().agent;
    const failed = await app.inject({ method: "PATCH", url, payload: { name: "不应提交", skillIds: [], productIds: ["missing-product"] } });
    expect(failed.statusCode).toBe(404);
    expect((await app.inject({ url })).json().agent).toEqual(before);
    const failedCreate = await app.inject({ method: "POST", url: "/api/agents", payload: { name: "失败创建", purpose: "验证原子性", assetIds: ["missing-asset"] } });
    expect(failedCreate.statusCode).toBe(404);
    expect((await app.inject({ url: "/api/agents?search=" + encodeURIComponent("失败创建") })).json().items).toEqual([]);
  });

  it("reports draft references and permits deletion after unlinking", async () => {
    const dataDir = tempDataDir();
    const app = await start(dataDir);
    const dataset = openActiveDataset(dataDir);
    dataset.db.prepare("INSERT INTO drafts (id, creation_type, name, agent_id, created_at, updated_at) VALUES ('agent-draft', 'ai_video', '引用草稿', 'seed-agent-director', 't', 't')").run();
    dataset.db.close();
    const blocked = await app.inject({ method: "DELETE", url: "/api/agents/seed-agent-director" });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().references[0].label).toBe("引用草稿");
    const reopened = openActiveDataset(dataDir);
    reopened.db.prepare("UPDATE drafts SET agent_id = NULL WHERE id = 'agent-draft'").run();
    reopened.db.close();
    expect((await app.inject({ method: "DELETE", url: "/api/agents/seed-agent-director" })).statusCode).toBe(200);
    await app.close();
    const restarted = await start(dataDir);
    expect((await restarted.inject({ url: "/api/agents/seed-agent-director" })).statusCode).toBe(404);
  });
});
