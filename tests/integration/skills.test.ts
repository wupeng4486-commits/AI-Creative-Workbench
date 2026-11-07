import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/server/src/app.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { cleanupDirs, tempDataDir } from "../helpers/app.ts";

afterEach(cleanupDirs);

async function withApp() {
  const dataDir = tempDataDir();
  const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
  return { dataDir, app };
}

describe("skills (T11)", () => {
  it("lists seeded skills with body, type and source", async () => {
    const { app } = await withApp();
    const list = await app.inject({ url: "/api/skills" });
    const items = list.json().items;
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.some((skill: { skill_type: string }) => skill.skill_type === "libtv_reference")).toBe(true);
    expect(items.some((skill: { origin: string }) => skill.origin === "shared")).toBe(true);
    expect(list.json().scenarios).toContain("AI 视频");
    const detail = await app.inject({ url: "/api/skills/seed-skill-video-breakdown" });
    expect(detail.json().skill.steps).toContain("镜头");
    expect(detail.json().skill.agents[0].name).toBe("电商广告导演");
    await app.close();
  });

  it("creates a skill with required field validation", async () => {
    const { app } = await withApp();
    const invalid = await app.inject({ method: "POST", url: "/api/skills", payload: { name: "" } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().fieldErrors.name).toBeTruthy();
    expect(invalid.json().fieldErrors.scenario).toBeTruthy();

    const created = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "测试视频方法",
        scenario: "AI 视频",
        tags: ["测试"],
        inputSpec: "商品图",
        steps: "1. 拆分镜\n2. 写提示",
        outputSpec: "分镜表",
        examples: "示例",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().skill.steps).toContain("拆分镜");
    await app.close();
  });

  it("saves body edits and restores them after restart", async () => {
    const { dataDir, app } = await withApp();
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/skills",
        payload: { name: "可编辑技能", scenario: "美工", steps: "旧正文" },
      })
    ).json().skill;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/skills/${created.id}`,
      payload: {
        steps: "新正文",
        tags: ["版式"],
        inputSpec: "预览图和源文件",
        outputSpec: "交付清单",
        examples: "尺寸和授权检查示例",
        skillType: "libtv_reference",
        externalRef: "libtv://delivery/check",
      },
    });
    expect(patched.json().skill.steps).toBe("新正文");
    await app.close();

    const reopened = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
    const detail = await reopened.inject({ url: `/api/skills/${created.id}` });
    expect(detail.json().skill.steps).toBe("新正文");
    expect(detail.json().skill.tags).toEqual(["版式"]);
    expect(detail.json().skill.input_spec).toBe("预览图和源文件");
    expect(detail.json().skill.output_spec).toBe("交付清单");
    expect(detail.json().skill.examples).toBe("尺寸和授权检查示例");
    expect(detail.json().skill.skill_type).toBe("libtv_reference");
    expect(detail.json().skill.external_ref).toBe("libtv://delivery/check");
    const search = await reopened.inject({ url: "/api/skills?search=" + encodeURIComponent("授权检查") });
    expect(search.json().items.map((skill: { id: string }) => skill.id)).toContain(created.id);
    await reopened.close();
  });

  it("filters by source, scenario and search text", async () => {
    const { app } = await withApp();
    const shared = await app.inject({ url: "/api/skills?origin=shared" });
    expect(shared.json().items.every((skill: { origin: string }) => skill.origin === "shared")).toBe(true);
    const scenario = await app.inject({ url: "/api/skills?scenario=" + encodeURIComponent("AI 图片") });
    expect(scenario.json().items.length).toBeGreaterThan(0);
    const search = await app.inject({ url: "/api/skills?search=" + encodeURIComponent("去字幕") });
    expect(search.json().items[0].name).toContain("去字幕");
    const none = await app.inject({ url: "/api/skills?search=" + encodeURIComponent("不存在的关键词") });
    expect(none.json().items).toEqual([]);
    await app.close();
  });

  it("copies a shared skill into an independent owned record", async () => {
    const { app } = await withApp();
    const source = (await app.inject({ url: "/api/skills/seed-skill-ai-image" })).json().skill;
    const copy = await app.inject({ method: "POST", url: "/api/skills/seed-skill-ai-image/copy" });
    expect(copy.statusCode).toBe(201);
    const copied = copy.json().skill;
    expect(copied.id).not.toBe(source.id);
    expect(copied.origin).toBe("owned");
    expect(copied.name).toContain("副本");
    await app.inject({
      method: "PATCH",
      url: `/api/skills/${copied.id}`,
      payload: { steps: "副本正文" },
    });
    const original = await app.inject({ url: "/api/skills/seed-skill-ai-image" });
    expect(original.json().skill.steps).not.toBe("副本正文");
    await app.close();
  });

  it("links a skill to an agent and blocks deletion while referenced", async () => {
    const { app } = await withApp();
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/skills",
        payload: { name: "关联技能", scenario: "AI 视频" },
      })
    ).json().skill;
    const linked = await app.inject({
      method: "PUT",
      url: `/api/skills/${created.id}/links`,
      payload: { agentIds: ["seed-agent-director"] },
    });
    expect(linked.json().skill.agents.map((agent: { id: string }) => agent.id)).toContain(
      "seed-agent-director",
    );
    const blocked = await app.inject({ method: "DELETE", url: `/api/skills/${created.id}` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().references[0].label).toBe("电商广告导演");

    await app.inject({
      method: "PUT",
      url: `/api/skills/${created.id}/links`,
      payload: { agentIds: [] },
    });
    const deleted = await app.inject({ method: "DELETE", url: `/api/skills/${created.id}` });
    expect(deleted.statusCode).toBe(200);
    await app.close();
  });

  it("rejects linking an unknown agent", async () => {
    const { app } = await withApp();
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/skills",
        payload: { name: "错误关联", scenario: "AI 视频" },
      })
    ).json().skill;
    const response = await app.inject({
      method: "PUT",
      url: `/api/skills/${created.id}/links`,
      payload: { agentIds: ["missing-agent"] },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("rejects direct edits and deletion of shared skills while allowing copies", async () => {
    const { app } = await withApp();
    const url = "/api/skills/seed-skill-ai-image";
    const original = (await app.inject({ url })).json().skill;
    const edited = await app.inject({ method: "PATCH", url, payload: { steps: "越权编辑" } });
    expect(edited.statusCode).toBe(403);
    expect(edited.json().code).toBe("FORBIDDEN");
    const removed = await app.inject({ method: "DELETE", url });
    expect(removed.statusCode).toBe(403);
    expect((await app.inject({ url })).json().skill).toEqual(original);
    expect((await app.inject({ method: "POST", url: `${url}/copy` })).statusCode).toBe(201);
    await app.close();
  });

  it.each([
    { name: "无效类型", scenario: "AI 视频", skillType: "unknown" },
    { name: "无效标签", scenario: "AI 视频", tags: [{ invalid: true }] },
    { name: "无效正文", scenario: "AI 视频", steps: { invalid: true } },
  ])("rejects malformed skill fields without writing a record (%j)", async (payload) => {
    const { app } = await withApp();
    const before = (await app.inject({ url: "/api/skills" })).json().items;
    const response = await app.inject({ method: "POST", url: "/api/skills", payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_FAILED");
    expect((await app.inject({ url: "/api/skills" })).json().items).toEqual(before);
    await app.close();
  });

  it("rolls back all link changes on failure and accepts safe retries", async () => {
    const { app } = await withApp();
    const skill = (await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "原子关联技能", scenario: "AI 视频" },
    })).json().skill;
    const url = `/api/skills/${skill.id}/links`;
    const payload = {
      agentIds: ["seed-agent-director", "seed-agent-image-maker"],
      workflowIds: ["seed-workflow-tietie"],
    };
    expect((await app.inject({ method: "PUT", url, payload })).statusCode).toBe(200);
    const retried = await app.inject({ method: "PUT", url, payload });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().skill.agents).toHaveLength(2);
    expect(retried.json().skill.workflows).toHaveLength(1);

    const failed = await app.inject({
      method: "PUT", url,
      payload: { agentIds: ["seed-agent-qc"], workflowIds: ["missing-workflow"] },
    });
    expect(failed.statusCode).toBe(404);
    expect(failed.json().code).toBe("WORKFLOW_NOT_FOUND");
    const detail = (await app.inject({ url: `/api/skills/${skill.id}` })).json().skill;
    expect(detail.agents).toEqual(retried.json().skill.agents);
    expect(detail.workflows).toEqual(retried.json().skill.workflows);

    const duplicate = await app.inject({
      method: "PUT", url,
      payload: { agentIds: ["seed-agent-director", "seed-agent-director"] },
    });
    expect(duplicate.statusCode).toBe(400);
    const blocked = await app.inject({ method: "DELETE", url: `/api/skills/${skill.id}` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().references.map((reference: { kind: string }) => reference.kind))
      .toEqual(["agent", "agent", "workflow"]);
    await app.close();
  });

  it("preserves all copied content and type without copying incoming references", async () => {
    const { app } = await withApp();
    const source = (await app.inject({ url: "/api/skills/seed-skill-libtv-video" })).json().skill;
    const copied = (await app.inject({ method: "POST", url: `/api/skills/${source.id}/copy` })).json().skill;
    expect(copied).toMatchObject({
      origin: "owned",
      skill_type: source.skill_type,
      input_spec: source.input_spec,
      steps: source.steps,
      output_spec: source.output_spec,
      examples: source.examples,
      tags: source.tags,
      external_ref: source.external_ref,
      agents: [],
      workflows: [],
    });
    expect(copied.id).not.toBe(source.id);
    await app.close();
  });

  it("does not recreate a deleted seeded skill after restart", async () => {
    const { dataDir, app } = await withApp();
    const url = "/api/skills/seed-skill-video-breakdown";
    await app.inject({ method: "PUT", url: `${url}/links`, payload: { agentIds: [], workflowIds: [] } });
    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(200);
    await app.close();
    const reopened = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
    expect((await reopened.inject({ url })).statusCode).toBe(404);
    await reopened.close();
  });

  it("returns stable not-found errors for missing skill operations", async () => {
    const { app } = await withApp();
    const requests = [
      { method: "GET", url: "/api/skills/missing" },
      { method: "PATCH", url: "/api/skills/missing", payload: { steps: "正文" } },
      { method: "POST", url: "/api/skills/missing/copy" },
      { method: "PUT", url: "/api/skills/missing/links", payload: { agentIds: [] } },
      { method: "DELETE", url: "/api/skills/missing" },
    ] as const;
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("SKILL_NOT_FOUND");
    }
    await app.close();
  });
});
