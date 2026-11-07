import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, type AppContext } from "../../apps/server/src/context.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { DemoRunner, getDemoRun, LIBTV_SAMPLES, type DemoRunInput } from "../../apps/server/src/services/demo-runs.ts";
import { updateWorkflow } from "../../apps/server/src/services/workflows.ts";
import { absoluteFilePath, getFile } from "../../apps/server/src/storage/files.ts";
import { makeApp, tempDataDir, cleanupDirs } from "../helpers/app.ts";

const contexts: AppContext[] = [];
const runners: DemoRunner[] = [];
function setup(dataDir = tempDataDir()) {
  const ctx = createContext(createConfig({ APP_DATA_DIR: dataDir }));
  const runner = new DemoRunner(ctx, 25);
  contexts.push(ctx);
  runners.push(runner);
  return { ctx, runner, dataDir };
}
const input: DemoRunInput = { owner: "workflow", ownerId: "libtv-tietie", requirements: "检查人物动作顺序", sampleInputs: true, parameters: { duration: 15, ratio: "9:16", count: 1 } };
afterEach(() => {
  for (const runner of runners.splice(0)) runner.close();
  for (const ctx of contexts.splice(0)) ctx.close();
  vi.useRealTimers();
  cleanupDirs();
});

describe("bounded demo runs (T14)", () => {
  it("exposes four samples without adding team records until explicitly saved", async () => {
    const app = await makeApp();
    try {
      const samples = (await app.inject({ url: "/api/workflows/libtv/samples" })).json();
      expect(samples.connected).toBe(false);
      expect(samples.items).toHaveLength(4);
      expect((await app.inject({ url: "/api/workflows" })).json().items).toHaveLength(4);
      const saved = await app.inject({ method: "POST", url: "/api/workflows/libtv/libtv-repack/save" });
      expect(saved.statusCode).toBe(201);
      expect(saved.json().workflow).toMatchObject({ origin: "owned", libtv_ref: "libtv://workflow/repack", default_parameters: { batch: true, count: 3 } });
      expect((await app.inject({ url: "/api/workflows" })).json().items).toHaveLength(5);
    } finally { await app.close(); }
  });

  it("validates required inputs before creating any runs", async () => {
    const app = await makeApp();
    try {
      const missing = await app.inject({ method: "POST", url: "/api/runs", payload: { ...input, requirements: " " } });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().fieldErrors.requirements).toBeTruthy();
      expect((await app.inject({ method: "POST", url: "/api/runs", payload: { ...input, sampleInputs: false } })).statusCode).toBe(400);
      expect((await app.inject({ url: "/api/runs" })).json().items).toEqual([]);
    } finally { await app.close(); }
  });

  it("transitions queued to running to completed with valid local media", async () => {
    vi.useFakeTimers();
    const { ctx, runner } = setup();
    const created = runner.start(input);
    expect(created.status).toBe("queued");
    await vi.advanceTimersByTimeAsync(25);
    expect(getDemoRun(ctx, created.id).status).toBe("running");
    await vi.advanceTimersByTimeAsync(100);
    const result = getDemoRun(ctx, created.id);
    expect(result.status).toBe("completed");
    expect(result.progress).toBe(100);
    expect(result.demo).toBe(true);
    expect(result.items[0].status).toBe("completed");
    const output = result.items[0].result as { fileId: string; demo: boolean };
    expect(output.demo).toBe(true);
    const file = getFile(ctx.db, output.fileId)!;
    expect(fs.readFileSync(absoluteFilePath(ctx.dataset.dir, file.relative_path))).toEqual(fs.readFileSync(path.join(ctx.config.projectRoot, "fixtures/demo/测试视频A-4秒.mp4")));
    expect(ctx.db.prepare("SELECT * FROM run_files WHERE run_id = ? AND role = 'output'").all(created.id)).toHaveLength(1);
  });

  it("keeps stopped terminal state after delayed completion callbacks", async () => {
    vi.useFakeTimers();
    const { ctx, runner } = setup();
    const created = runner.start(input);
    await vi.advanceTimersByTimeAsync(75);
    runner.stop(created.id);
    await vi.advanceTimersByTimeAsync(5000);
    const stopped = getDemoRun(ctx, created.id);
    expect(stopped.status).toBe("stopped");
    expect(stopped.items.every((item) => item.status === "stopped")).toBe(true);
    expect(stopped.items[0].result).toEqual({});
    expect(ctx.db.prepare("SELECT * FROM run_files WHERE run_id = ? AND role = 'output'").all(created.id)).toEqual([]);
    expect(() => runner.stop(created.id)).toThrow(/已经结束/);
  });

  it("stores per-item failures and retries independently with frozen parameters", async () => {
    vi.useFakeTimers();
    const { ctx, runner } = setup();
    const created = runner.start({ ...input, ownerId: "libtv-repack", simulateFailure: true, parameters: { count: 3 } });
    await vi.advanceTimersByTimeAsync(100);
    const failed = getDemoRun(ctx, created.id);
    expect(failed.status).toBe("failed");
    expect(failed.items.map((item) => item.status)).toEqual(["failed", "completed", "completed"]);
    expect(failed.items[0].result).toEqual({});
    const retried = runner.retry(created.id);
    expect(retried.id).not.toBe(created.id);
    expect(retried.parameters).toEqual(failed.parameters);
    await vi.advanceTimersByTimeAsync(100);
    expect(getDemoRun(ctx, retried.id).status).toBe("completed");
    expect(getDemoRun(ctx, created.id)).toEqual(failed);
    expect(() => runner.retry(retried.id)).toThrow(/仅失败/);
  });

  it("marks unfinished runs and batch items interrupted after a service restart", async () => {
    vi.useFakeTimers();
    const first = setup();
    const created = first.runner.start(input);
    await vi.advanceTimersByTimeAsync(25);
    first.runner.close();
    first.ctx.close();
    const restarted = setup(first.dataDir);
    const interrupted = getDemoRun(restarted.ctx, created.id);
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.items[0].status).toBe("interrupted");
    expect(interrupted.inputSnapshot).toEqual(created.inputSnapshot);
    const retry = restarted.runner.retry(created.id);
    await vi.advanceTimersByTimeAsync(100);
    expect(getDemoRun(restarted.ctx, retry.id).status).toBe("completed");
  });

  it("freezes the workflow and parameters when current records are edited", async () => {
    vi.useFakeTimers();
    const { ctx, runner } = setup();
    const created = runner.start({ ...input, ownerId: "seed-workflow-tietie" });
    const snapshot = structuredClone(created.inputSnapshot);
    updateWorkflow(ctx.db, "seed-workflow-tietie", { name: "稍后的新名称", defaultParameters: { duration: 30 } });
    await vi.advanceTimersByTimeAsync(100);
    expect(getDemoRun(ctx, created.id).inputSnapshot).toEqual(snapshot);
    expect(getDemoRun(ctx, created.id).parameters.duration).toBe(15);
  });

  it("waits for backup barriers and bounds concurrency", async () => {
    vi.useFakeTimers();
    const { ctx, runner } = setup();
    const created = runner.start(input);
    ctx.barrier.acquire();
    await vi.advanceTimersByTimeAsync(500);
    expect(getDemoRun(ctx, created.id).progress).toBe(0);
    ctx.barrier.release();
    await vi.advanceTimersByTimeAsync(100);
    expect(getDemoRun(ctx, created.id).status).toBe("completed");
    for (let index = 0; index < 4; index += 1) runner.start(input);
    expect(() => runner.start(input)).toThrow(/最多进行 4/);
  });

  it.each([{ count: 0 }, { count: 11 }, { count: 1.5 }, { duration: -1 }, { ratio: "unsupported" }])("rejects invalid parameters %j", (parameters) => {
    const { runner, ctx } = setup();
    expect(() => runner.start({ ...input, parameters })).toThrow();
    expect(ctx.db.prepare("SELECT id FROM runs").all()).toEqual([]);
  });
});
