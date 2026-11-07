import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, type AppContext } from "../../apps/server/src/context.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { DemoRunner, ensureDemoFile, getDemoRun } from "../../apps/server/src/services/demo-runs.ts";
import { createDraft, getDraft, updateDraft } from "../../apps/server/src/services/drafts.ts";
import { createAsset, deleteAsset } from "../../apps/server/src/services/assets.ts";
import { tempDataDir, cleanupDirs } from "../helpers/app.ts";

const contexts: AppContext[] = [];
const runners: DemoRunner[] = [];
function setup(creationType: "ai_video" | "ai_image" = "ai_video") {
  const ctx = createContext(createConfig({ APP_DATA_DIR: tempDataDir() }));
  const runner = new DemoRunner(ctx, 10);
  contexts.push(ctx); runners.push(runner);
  const file = ensureDemoFile(ctx, "image");
  const asset = createAsset(ctx.db, { name: "参考商品图", fileId: file.id });
  const draft = createDraft(ctx.db, {
    creationType, requirements: "第一版创作要求", agentId: "seed-agent-director", productId: "seed-product-sunscreen", assetIds: [asset.id],
    parameters: creationType === "ai_video" ? { duration: 15, ratio: "9:16", shotRequirements: "第一版分镜" } : { width: 1024, height: 1024, count: 2, style: "明亮柔光" },
  });
  return { ctx, runner, draft, asset };
}
afterEach(() => {
  for (const runner of runners.splice(0)) runner.close();
  for (const ctx of contexts.splice(0)) ctx.close();
  vi.useRealTimers(); cleanupDirs();
});

describe("AI video and image production (T17)", () => {
  it("uses the saved draft revision and creates a playable video with storyboard examples", async () => {
    vi.useFakeTimers();
    const { ctx, runner, draft } = setup();
    const run = runner.start({ owner: "draft", ownerId: draft.id, requirements: "伪造的未保存内容", parameters: { duration: 90 }, draftRevision: 1 });
    expect(run.parameters.duration).toBe(15);
    expect((run.inputSnapshot as { inputs: { requirements: string } }).inputs.requirements).toBe("第一版创作要求");
    await vi.advanceTimersByTimeAsync(40);
    const completed = getDemoRun(ctx, run.id);
    expect(completed.status).toBe("completed");
    expect(completed.kind).toBe("ai_video");
    expect(completed.items[0].result).toMatchObject({ previewKind: "video", demo: true, contentUrl: expect.stringMatching(/^\/api\/files\//) });
    expect((completed.result as { shots: unknown[] }).shots).toHaveLength(3);
  });

  it("creates the requested number of image candidates with an independent history", async () => {
    vi.useFakeTimers();
    const { ctx, runner, draft } = setup("ai_image");
    const run = runner.start({ owner: "draft", ownerId: draft.id, requirements: draft.requirements });
    await vi.advanceTimersByTimeAsync(40);
    const completed = getDemoRun(ctx, run.id);
    expect(completed.kind).toBe("ai_image");
    expect(completed.parameters).toMatchObject({ width: 1024, height: 1024, count: 2, style: "明亮柔光" });
    expect(completed.items).toHaveLength(2);
    expect(completed.items.every((item) => (item.result as { previewKind: string }).previewKind === "image")).toBe(true);
  });

  it("keeps both run snapshots and original source bodies after current records change", async () => {
    vi.useFakeTimers();
    const { ctx, runner, draft } = setup();
    const first = runner.start({ owner: "draft", ownerId: draft.id, requirements: "" });
    const snapshot = structuredClone(first.inputSnapshot);
    const beforeSkill = ctx.db.prepare("SELECT steps FROM skills WHERE id = 'seed-skill-video-breakdown'").get() as { steps: string };
    ctx.db.prepare("UPDATE skills SET steps = '后来的新正文' WHERE id = 'seed-skill-video-breakdown'").run();
    updateDraft(ctx.db, draft.id, 1, { requirements: "第二版要求", parameters: { duration: 20, ratio: "1:1", shotRequirements: "第二版分镜" } });
    await vi.advanceTimersByTimeAsync(40);
    const second = runner.start({ owner: "draft", ownerId: draft.id, requirements: "" });
    await vi.advanceTimersByTimeAsync(40);
    expect(getDemoRun(ctx, first.id).inputSnapshot).toEqual(snapshot);
    expect(getDemoRun(ctx, second.id).inputSnapshot).not.toEqual(snapshot);
    const firstDetails = (snapshot as { resourceDetails: Array<{ id: string; data: { steps?: string } }> }).resourceDetails;
    expect(firstDetails.find((item) => item.id === "seed-skill-video-breakdown")?.data.steps).toBe(beforeSkill.steps);
    expect(getDemoRun(ctx, second.id).parameters.duration).toBe(20);
  });

  it("retries the original failed snapshot even after the draft and asset catalog change", async () => {
    vi.useFakeTimers();
    const { ctx, runner, draft, asset } = setup();
    const run = runner.start({ owner: "draft", ownerId: draft.id, requirements: "", simulateFailure: true });
    await vi.advanceTimersByTimeAsync(40);
    updateDraft(ctx.db, draft.id, 1, { requirements: "完全不同的新需求", assetIds: [] });
    expect(deleteAsset(ctx.db, ctx.dataset.dir, asset.id).retainedFile).toBe(true);
    const retried = runner.retry(run.id);
    expect((retried.inputSnapshot as { inputs: { requirements: string } }).inputs.requirements).toBe("第一版创作要求");
    await vi.advanceTimersByTimeAsync(40);
    expect(getDemoRun(ctx, retried.id).status).toBe("completed");
    expect(getDemoRun(ctx, run.id).status).toBe("failed");
  });

  it("stops a production without losing the current draft or producing a successful item", async () => {
    vi.useFakeTimers();
    const { ctx, runner, draft } = setup();
    const run = runner.start({ owner: "draft", ownerId: draft.id, requirements: "" });
    runner.stop(run.id);
    await vi.advanceTimersByTimeAsync(100);
    expect(getDemoRun(ctx, run.id).status).toBe("stopped");
    expect(getDemoRun(ctx, run.id).items[0].result).toEqual({});
    expect(getDraft(ctx.db, draft.id).requirements).toBe("第一版创作要求");
  });

  it("reports missing product, reference media and shot requirements before creating a run", () => {
    const { ctx, runner, draft } = setup();
    updateDraft(ctx.db, draft.id, 1, { productId: null, assetIds: [], parameters: { duration: 15, ratio: "9:16", shotRequirements: "" } });
    try {
      runner.start({ owner: "draft", ownerId: draft.id, requirements: "" });
      throw new Error("missing validation failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "VALIDATION_FAILED", fieldErrors: { productId: expect.any(String), assetIds: expect.any(String), shotRequirements: expect.any(String) } });
    }
    expect(ctx.db.prepare("SELECT id FROM runs").all()).toEqual([]);
  });

  it("rejects stale draft revisions and invalid image size or candidate counts", () => {
    const { ctx, runner, draft } = setup("ai_image");
    expect(() => runner.start({ owner: "draft", ownerId: draft.id, requirements: "", draftRevision: 2 })).toThrow(/版本已变化/);
    updateDraft(ctx.db, draft.id, 1, { parameters: { width: 0, height: 1024, count: 9, style: "" } });
    expect(() => runner.start({ owner: "draft", ownerId: draft.id, requirements: "" })).toThrow(/补充制作/);
    expect(ctx.db.prepare("SELECT id FROM runs").all()).toEqual([]);
  });
});
