import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, type AppContext } from "../../apps/server/src/context.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { DemoRunner, getDemoRun } from "../../apps/server/src/services/demo-runs.ts";
import { getConnector, importConnectorBatch, updateConnector } from "../../apps/server/src/services/connectors.ts";
import { getIntegrations, setSetting, SETTING_KEYS } from "../../apps/server/src/services/settings.ts";
import { makeApp, tempDataDir, cleanupDirs } from "../helpers/app.ts";

const contexts: AppContext[] = [];
const runners: DemoRunner[] = [];
const connectorId = "seed-connector-shopify";
function setup(dataDir = tempDataDir()) {
  const ctx = createContext(createConfig({ APP_DATA_DIR: dataDir }));
  const runner = new DemoRunner(ctx, 10);
  contexts.push(ctx);
  runners.push(runner);
  return { ctx, runner, dataDir };
}
const config = { label: "演示店铺", endpoint: "https://example.com", note: "本地测试" };
const connectInput = { owner: "connector" as const, ownerId: connectorId, requirements: "模拟连接", sampleInputs: true, parameters: { action: "connect", count: 1 } };
afterEach(() => {
  for (const runner of runners.splice(0)) runner.close();
  for (const ctx of contexts.splice(0)) ctx.close();
  vi.useRealTimers();
  cleanupDirs();
});

describe("connectors (T15)", () => {
  it("lists four services and creates a configured demonstration connection", async () => {
    const app = await makeApp();
    try {
      const items = (await app.inject({ url: "/api/connectors" })).json().items;
      expect(items.map((item: { service_type: string }) => item.service_type).sort()).toEqual(["creation_tool", "github", "gmail", "shopify"]);
      expect(items[0].demo_config).toMatchObject({ label: "", endpoint: "", note: "" });
      const created = await app.inject({ method: "POST", url: "/api/connectors", payload: { name: "演示 GitHub", serviceType: "github", config } });
      expect(created.statusCode).toBe(201);
      expect(created.json().connector).toMatchObject({ name: "演示 GitHub", simulation_status: "pending", demo_config: config });
    } finally { await app.close(); }
  });

  it("requires configuration, enablement and successful connection before sync", () => {
    const { ctx, runner } = setup();
    expect(() => runner.start(connectInput)).toThrow(/保存演示配置/);
    updateConnector(ctx.db, connectorId, { config });
    expect(() => runner.start({ ...connectInput, parameters: { action: "sync" } })).toThrow(/先完成模拟连接/);
    updateConnector(ctx.db, connectorId, { enabled: false });
    expect(() => runner.start(connectInput)).toThrow(/已停用/);
    updateConnector(ctx.db, connectorId, { enabled: true });
    expect(getConnector(ctx.db, connectorId).simulation_status).toBe("pending");
  });

  it("syncs only sample results until explicit import, then imports each batch once across restart", async () => {
    vi.useFakeTimers();
    const { ctx, runner, dataDir } = setup();
    updateConnector(ctx.db, connectorId, { config });
    runner.start(connectInput);
    await vi.advanceTimersByTimeAsync(40);
    expect(getConnector(ctx.db, connectorId).simulation_status).toBe("connected");
    const sync = runner.start({ ...connectInput, parameters: { action: "sync", count: 3 } });
    await vi.advanceTimersByTimeAsync(40);
    expect(getDemoRun(ctx, sync.id).status).toBe("completed");
    expect(ctx.db.prepare("SELECT id FROM assets").all()).toEqual([]);
    const imported = importConnectorBatch(ctx, connectorId, sync.id);
    expect(imported.importedCount).toBe(3);
    expect(imported.items.every((item) => item.asset?.provenance === "demo_result")).toBe(true);
    const repeated = importConnectorBatch(ctx, connectorId, sync.id);
    expect(repeated.importedCount).toBe(0);
    expect(repeated.items.map((item) => item.id)).toEqual(imported.items.map((item) => item.id));
    runner.close(); ctx.close();
    const restarted = setup(dataDir);
    const restored = importConnectorBatch(restarted.ctx, connectorId, sync.id);
    expect(restored.replayedCount).toBe(3);
    expect(restarted.ctx.db.prepare("SELECT id FROM assets").all()).toHaveLength(3);
    expect(getConnector(restarted.ctx.db, connectorId).last_simulated_at).toBeTruthy();
  });

  it("persists failed connection, supports retry and imports only successful sync items", async () => {
    vi.useFakeTimers();
    const { ctx, runner } = setup();
    updateConnector(ctx.db, connectorId, { config });
    const failed = runner.start({ ...connectInput, simulateFailure: true });
    await vi.advanceTimersByTimeAsync(40);
    expect(getConnector(ctx.db, connectorId).simulation_status).toBe("failed");
    expect(() => importConnectorBatch(ctx, connectorId, failed.id)).toThrow(/先完成一次模拟同步/);
    runner.retry(failed.id);
    await vi.advanceTimersByTimeAsync(40);
    const sync = runner.start({ ...connectInput, simulateFailure: true, parameters: { action: "sync", count: 3 } });
    await vi.advanceTimersByTimeAsync(40);
    expect(getDemoRun(ctx, sync.id).items.map((item) => item.status)).toEqual(["failed", "completed", "completed"]);
    expect(importConnectorBatch(ctx, connectorId, sync.id).importedCount).toBe(2);
  });

  it("shares LibTV endpoint settings and persists configuration", () => {
    const { ctx } = setup();
    updateConnector(ctx.db, "seed-connector-libtv", { config: { ...config, endpoint: "http://127.0.0.1:8080" } });
    expect(getIntegrations(ctx.db).libtv.url).toBe("http://127.0.0.1:8080");
    setSetting(ctx.db, SETTING_KEYS.libtv, { url: "https://example.com/new", note: "更新" });
    expect(getConnector(ctx.db, "seed-connector-libtv").demo_config.endpoint).toBe("https://example.com/new");
    expect(() => updateConnector(ctx.db, connectorId, { config: { ...config, endpoint: "ftp://example.com" } })).toThrow(/http/);
  });

  it("invalid configuration leaves an active run intact, while disabling stops it", async () => {
    const app = await makeApp();
    try {
      await app.inject({ method: "PATCH", url: `/api/connectors/${connectorId}`, payload: { config } });
      const created = await app.inject({ method: "POST", url: `/api/connectors/${connectorId}/connect`, payload: {} });
      expect(created.statusCode).toBe(201);
      const id = created.json().id;
      const invalid = await app.inject({ method: "PATCH", url: `/api/connectors/${connectorId}`, payload: { config: { ...config, endpoint: "ftp://example.com" } } });
      expect(invalid.statusCode).toBe(400);
      expect(["queued", "running"]).toContain((await app.inject({ url: `/api/runs/${id}` })).json().status);
      expect((await app.inject({ method: "PATCH", url: `/api/connectors/${connectorId}`, payload: { enabled: false } })).statusCode).toBe(200);
      expect((await app.inject({ url: `/api/runs/${id}` })).json().status).toBe("stopped");
      expect((await app.inject({ method: "POST", url: `/api/connectors/${connectorId}/sync`, payload: {} })).statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it("rejects an import from another connector without creating assets", async () => {
    vi.useFakeTimers();
    const { ctx, runner } = setup();
    updateConnector(ctx.db, connectorId, { config });
    const run = runner.start(connectInput);
    await vi.advanceTimersByTimeAsync(40);
    expect(() => importConnectorBatch(ctx, "seed-connector-gmail", run.id)).toThrow(/记录不存在/);
    expect(ctx.db.prepare("SELECT id FROM assets").all()).toEqual([]);
  });
});
