import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, type AppContext } from "../../apps/server/src/context.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { createAsset, deleteAsset } from "../../apps/server/src/services/assets.ts";
import { carryIntoDraft, createDraft, getDraft, updateDraft } from "../../apps/server/src/services/drafts.ts";
import { DemoRunner, getDemoRun } from "../../apps/server/src/services/demo-runs.ts";
import { commitStagedFile, insertFile } from "../../apps/server/src/storage/files.ts";
import { tempDataDir, cleanupDirs } from "../helpers/app.ts";

const contexts: AppContext[] = [];
const runners: DemoRunner[] = [];
function setup() {
  const dataDir = tempDataDir();
  const ctx = createContext(createConfig({ APP_DATA_DIR: dataDir }));
  contexts.push(ctx);
  const assets = ["测试视频A-4秒.mp4", "测试视频B-6秒.mp4", "测试视频C-5秒.mp4"].map((name, index) => {
    const bytes = fs.readFileSync(path.join(ctx.config.projectRoot, "fixtures/demo", name));
    const staged = path.join(dataDir, "staging", `clip-${index}`);
    fs.writeFileSync(staged, bytes);
    const file = insertFile(ctx.db, commitStagedFile(ctx.dataset.dir, staged, name, "video/mp4", crypto.createHash("sha256").update(bytes).digest("hex")));
    return createAsset(ctx.db, { name, fileId: file.id });
  });
  const draft = createDraft(ctx.db, { creationType: "video_join", name: "拼接草稿", requirements: "按顺序展示", clipAssetIds: assets.map((asset) => asset.id) });
  return { ctx, dataDir, assets, draft };
}
afterEach(() => {
  for (const runner of runners.splice(0)) runner.close();
  for (const ctx of contexts.splice(0)) ctx.close();
  vi.useRealTimers(); cleanupDirs();
});

describe("video join order and persistence (T19)", () => {
  it("stores A/B/C, reorders C/A/B, removes B and reports nine seconds", () => {
    const { ctx, assets, draft } = setup();
    expect(draft.totalDuration).toBe(15);
    const ordered = updateDraft(ctx.db, draft.id, 1, { clipAssetIds: [assets[2]!.id, assets[0]!.id, assets[1]!.id] });
    expect(ordered.clips.map((clip) => clip.assetId)).toEqual([assets[2]!.id, assets[0]!.id, assets[1]!.id]);
    const removed = updateDraft(ctx.db, draft.id, 2, { clipAssetIds: [assets[2]!.id, assets[0]!.id] });
    expect(removed.totalDuration).toBe(9);
    expect(removed.clips.map((clip) => clip.position)).toEqual([0, 1]);
  });

  it("restores order, duration and input references after restarting", () => {
    const { ctx, dataDir, assets, draft } = setup();
    updateDraft(ctx.db, draft.id, 1, { clipAssetIds: [assets[2]!.id, assets[0]!.id] });
    ctx.close();
    const next = createContext(createConfig({ APP_DATA_DIR: dataDir }));
    contexts.push(next);
    const restored = getDraft(next.db, draft.id);
    expect(restored.clips.map((clip) => clip.assetId)).toEqual([assets[2]!.id, assets[0]!.id]);
    expect(restored.totalDuration).toBe(9);
  });

  it("supports repeated use of the same clip as separate ordered positions", () => {
    const { ctx, assets, draft } = setup();
    const result = updateDraft(ctx.db, draft.id, 1, { clipAssetIds: [assets[0]!.id, assets[0]!.id] });
    expect(result.totalDuration).toBe(8);
    expect(result.clips).toHaveLength(2);
    expect(result.clips.map((clip) => clip.position)).toEqual([0, 1]);
  });

  it("blocks deletion of current clips and permits it after removing their references", () => {
    const { ctx, assets, draft } = setup();
    expect(() => deleteAsset(ctx.db, ctx.dataset.dir, assets[0]!.id)).toThrow(/仍被引用/);
    updateDraft(ctx.db, draft.id, 1, { clipAssetIds: [assets[1]!.id, assets[2]!.id] });
    expect(deleteAsset(ctx.db, ctx.dataset.dir, assets[0]!.id).deleted).toBe(true);
  });

  it("rejects invalid clip metadata without changing order or revision", () => {
    const { ctx, assets, draft } = setup();
    ctx.db.prepare("UPDATE files SET duration = NULL WHERE id = ?").run(assets[0]!.file_id);
    expect(() => updateDraft(ctx.db, draft.id, 1, { clipAssetIds: [assets[0]!.id], name: "不应保存" })).toThrow(/有效时长/);
    expect(getDraft(ctx.db, draft.id).revision).toBe(1);
    expect(getDraft(ctx.db, draft.id).name).toBe("拼接草稿");
  });

  it("freezes the ordered join plan and keeps an explicitly marked playable demo result", async () => {
    vi.useFakeTimers();
    const { ctx, assets, draft } = setup();
    updateDraft(ctx.db, draft.id, 1, { clipAssetIds: [assets[2]!.id, assets[0]!.id] });
    const runner = new DemoRunner(ctx, 10); runners.push(runner);
    const run = runner.start({ owner: "draft", ownerId: draft.id, requirements: "", draftRevision: 2 });
    updateDraft(ctx.db, draft.id, 2, { clipAssetIds: [assets[1]!.id, assets[0]!.id] });
    await vi.advanceTimersByTimeAsync(40);
    const completed = getDemoRun(ctx, run.id);
    expect(completed).toMatchObject({ kind: "video_join", status: "completed", demo: true });
    expect(completed.result).toMatchObject({ joinPlan: { totalDuration: 9, clips: [{ name: "测试视频C-5秒.mp4", duration: 5 }, { name: "测试视频A-4秒.mp4", duration: 4 }] } });
    expect(completed.items[0].result).toMatchObject({ previewKind: "video", demo: true });
  });

  it("requires two clips and carries valid video assets into the join sequence", () => {
    const { ctx, assets, draft } = setup();
    updateDraft(ctx.db, draft.id, 1, { clipAssetIds: [assets[0]!.id] });
    const runner = new DemoRunner(ctx); runners.push(runner);
    expect(() => runner.start({ owner: "draft", ownerId: draft.id, requirements: "" })).toThrow(/补充制作/);
    const carried = carryIntoDraft(ctx.db, draft.id, 2, { assetIds: [assets[2]!.id] });
    expect(carried.clips.map((clip) => clip.assetId)).toEqual([assets[0]!.id, assets[2]!.id]);
    expect(carried.totalDuration).toBe(9);
  });
});
