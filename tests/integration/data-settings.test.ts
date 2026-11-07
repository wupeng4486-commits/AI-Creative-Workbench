import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeApp, tempDataDir, cleanupDirs } from "../helpers/app.ts";
import { readActivePointer } from "../../apps/server/src/db/datasets.ts";

afterEach(() => { vi.restoreAllMocks(); cleanupDirs(); });
describe("data settings (T22)", () => {
  it("requires exact confirmation and dataset, switches atomically and retains the old dataset", async () => {
    const dir = tempDataDir();
    let app = await makeApp(dir);
    try {
      const before = (await app.inject("/api/system/info")).json();
      const invalid = await app.inject({ method: "POST", url: "/api/system/reset", payload: { datasetId: before.datasetId, confirmation: "清空" } });
      expect(invalid.statusCode).toBe(400);
      expect(readActivePointer(dir)?.datasetId).toBe(before.datasetId);
      const stale = await app.inject({ method: "POST", url: "/api/system/reset", payload: { datasetId: "stale", confirmation: "清空本机数据" } });
      expect(stale.statusCode).toBe(409);
      const reset = await app.inject({ method: "POST", url: "/api/system/reset", payload: { datasetId: before.datasetId, confirmation: "清空本机数据" } });
      expect(reset.statusCode).toBe(200);
      expect(reset.json().datasetId).not.toBe(before.datasetId);
      expect(fs.existsSync(path.join(dir, "datasets", before.datasetId, "database.sqlite"))).toBe(true);
      expect((await app.inject("/api/system/info")).json().counts.agents).toBe(0);
      const oldWrite = await app.inject({ method: "POST", url: "/api/skills", headers: { "x-dataset-id": before.datasetId }, payload: { name: "旧页面", scenario: "验证" } });
      expect(oldWrite.json().code).toBe("DATASET_CHANGED");
      await app.close(); app = await makeApp(dir);
      expect((await app.inject("/api/agents")).json().items).toEqual([]);
      await app.inject({ method: "POST", url: "/api/system/seed" });
      expect((await app.inject("/api/agents")).json().items.length).toBe(before.counts.agents);
    } finally { await app.close(); }
  });

  it("supplements missing seeds without overwriting edited content, settings or removed associations", async () => {
    const app = await makeApp();
    try {
      await app.inject({ method: "PATCH", url: "/api/agents/seed-agent-director", payload: { name: "我的导演", skillIds: [] } });
      await app.inject({ method: "PATCH", url: "/api/workflows/seed-workflow-tietie", payload: { skillIds: [] } });
      expect((await app.inject({ method: "DELETE", url: "/api/skills/seed-skill-video-breakdown" })).statusCode).toBe(200);
      expect((await app.inject("/api/skills/seed-skill-video-breakdown")).statusCode).toBe(404);
      await app.inject({ method: "PATCH", url: "/api/settings/integrations/libtv", payload: { url: "https://example.com/custom" } });
      for (let index = 0; index < 2; index++) expect((await app.inject({ method: "POST", url: "/api/system/seed" })).statusCode).toBe(200);
      const agent = (await app.inject("/api/agents/seed-agent-director")).json().agent;
      expect(agent.name).toBe("我的导演"); expect(agent.skills).toEqual([]);
      expect((await app.inject("/api/skills/seed-skill-video-breakdown")).statusCode).toBe(200);
      expect((await app.inject("/api/settings")).json().integrations.libtv.url).toBe("https://example.com/custom");
      expect((await app.inject("/api/agents")).json().items).toHaveLength(6);
    } finally { await app.close(); }
  });

  it("keeps the original dataset usable after activation fails", async () => {
    const dir = tempDataDir(); const app = await makeApp(dir);
    try {
      const before = (await app.inject("/api/system/info")).json();
      const rename = fs.renameSync;
      let injected = false;
      vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        if (!injected && String(to) === path.join(dir, "active.json")) { injected = true; throw new Error("injected pointer failure"); }
        return rename(from, to);
      });
      const result = await app.inject({ method: "POST", url: "/api/system/reset", payload: { datasetId: before.datasetId, confirmation: "清空本机数据" } });
      expect(result.statusCode).toBe(500);
      expect((await app.inject("/api/system/info")).json().datasetId).toBe(before.datasetId);
      expect((await app.inject("/api/agents")).json().items).toHaveLength(before.counts.agents);
    } finally { await app.close(); }
  });

  it("persists UI preferences and shares entry settings after service restart", async () => {
    const dir = tempDataDir(); let app = await makeApp(dir);
    try {
      await app.inject({ method: "PATCH", url: "/api/settings/preferences", payload: { assetView: "grid", sidebarCollapsed: true } });
      await app.inject({ method: "PATCH", url: "/api/settings/integrations/jianying", payload: { url: "https://example.com/edit", note: "交付入口" } });
      await app.close(); app = await makeApp(dir);
      expect((await app.inject("/api/settings")).json().preferences).toEqual({ assetView: "grid", sidebarCollapsed: true });
      expect((await app.inject("/api/system/settings")).json().integrations.jianying).toEqual({ url: "https://example.com/edit", note: "交付入口" });
    } finally { await app.close(); }
  });
});
