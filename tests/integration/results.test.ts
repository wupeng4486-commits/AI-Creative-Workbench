import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, type AppContext } from "../../apps/server/src/context.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { MIGRATIONS, migrationsDir } from "../../apps/server/src/db/migrations.ts";
import { createAsset, deleteAsset, findAsset } from "../../apps/server/src/services/assets.ts";
import { createDraft, updateDraft } from "../../apps/server/src/services/drafts.ts";
import { DemoRunner, ensureDemoFile, getDemoRun } from "../../apps/server/src/services/demo-runs.ts";
import { archiveResult, importExternalVideo, workflowFromResult } from "../../apps/server/src/services/results.ts";
import { makeApp, tempDataDir, cleanupDirs } from "../helpers/app.ts";

const contexts: AppContext[] = [];
const runners: DemoRunner[] = [];
async function setup(simulateFailure = false) {
  vi.useFakeTimers();
  const dataDir = tempDataDir();
  const ctx = createContext(createConfig({ APP_DATA_DIR: dataDir })); contexts.push(ctx);
  const runner = new DemoRunner(ctx, 10); runners.push(runner);
  const reference = createAsset(ctx.db, { name: "参考图", fileId: ensureDemoFile(ctx, "image").id });
  const draft = createDraft(ctx.db, { creationType: "ai_image", requirements: "归档前的原始需求", productId: "seed-product-sunscreen", workflowId: "seed-workflow-tietie", assetIds: [reference.id], parameters: { width: 1024, height: 1024, count: 2, style: "柔光" } });
  const started = runner.start({ owner: "draft", ownerId: draft.id, requirements: "", simulateFailure });
  await vi.advanceTimersByTimeAsync(40);
  return { ctx, dataDir, draft, runner, run: getDemoRun(ctx, started.id) };
}
afterEach(() => {
  for (const runner of runners.splice(0)) runner.close();
  for (const ctx of contexts.splice(0)) ctx.close();
  vi.useRealTimers(); cleanupDirs();
});

describe("result archival and workflow reuse (T20)", () => {
  it("archives each result once without copying files or marking private output shared", async () => {
    const { ctx, run } = await setup();
    const beforeFiles = ctx.db.prepare("SELECT id FROM files").all().length;
    const input = { runId: run.id, resultItemId: run.items[0]!.id, name: "归档主图", tags: ["主图"] };
    const first = archiveResult(ctx, input);
    const repeated = archiveResult(ctx, input);
    expect(first.replayed).toBe(false);
    expect(repeated.replayed).toBe(true);
    expect(repeated.asset.id).toBe(first.asset.id);
    expect(first.asset).toMatchObject({ origin: "owned", provenance: "demo_result", catalog: "result", tags: ["主图"] });
    expect(first.asset.sourceSnapshot).toMatchObject({ runId: run.id, resultItemId: run.items[0]!.id, demo: true, owner: "draft" });
    expect(ctx.db.prepare("SELECT id FROM archives").all()).toHaveLength(1);
    expect(ctx.db.prepare("SELECT id FROM files").all()).toHaveLength(beforeFiles);
  });

  it("serializes concurrent API archive requests into one asset", async () => {
    const { ctx, dataDir, run } = await setup();
    vi.useRealTimers();
    const app = await makeApp(dataDir);
    try {
      const request = { method: "POST" as const, url: "/api/results/archive", payload: { runId: run.id, resultItemId: run.items[0]!.id, name: "并发归档" } };
      const results = await Promise.all([app.inject(request), app.inject(request)]);
      expect(results.map((result) => result.statusCode).sort()).toEqual([200, 201]);
      expect(results[0]!.json().asset.id).toBe(results[1]!.json().asset.id);
      expect(ctx.db.prepare("SELECT id FROM archives").all()).toHaveLength(1);
    } finally { await app.close(); }
  });

  it("retains source snapshots after the current draft changes", async () => {
    const { ctx, draft, run } = await setup();
    const archived = archiveResult(ctx, { runId: run.id, resultItemId: run.items[0]!.id });
    const source = structuredClone(archived.asset.sourceSnapshot);
    updateDraft(ctx.db, draft.id, 1, { requirements: "后来的不同需求", parameters: { style: "暗调", count: 1 } });
    expect(findAsset(ctx.db, archived.asset.id)?.sourceSnapshot).toEqual(source);
    expect(source?.inputSnapshot.inputs).toMatchObject({ requirements: "归档前的原始需求" });
  });

  it("preserves history after asset deletion and does not resurrect a deleted archive", async () => {
    const { ctx, run } = await setup();
    const input = { runId: run.id, resultItemId: run.items[0]!.id };
    const first = archiveResult(ctx, input);
    expect(deleteAsset(ctx.db, ctx.dataset.dir, first.asset.id).retainedFile).toBe(true);
    expect(() => archiveResult(ctx, input)).toThrow(/从资产库删除/);
    expect(getDemoRun(ctx, run.id).items[0]!.result).toMatchObject({ fileId: first.asset.file_id });
    expect(ctx.db.prepare("SELECT id FROM assets").all()).toHaveLength(1);
  });

  it("saves LibTV reference, frozen requirements and parameters into one reusable team workflow", async () => {
    const { ctx, run } = await setup();
    const first = workflowFromResult(ctx, run.id, "可复用图片流程");
    const repeated = workflowFromResult(ctx, run.id, "重复名称");
    expect(repeated.workflow.id).toBe(first.workflow.id);
    expect(repeated.replayed).toBe(true);
    expect(first.workflow).toMatchObject({ origin: "owned", libtv_ref: "libtv://workflow/tietie", input_spec: "归档前的原始需求", default_parameters: { width: 1024, count: 2, style: "柔光" } });
    expect(first.workflow.sourceSnapshot?.runId).toBe(run.id);
    expect(ctx.db.prepare("SELECT id FROM team_workflows").all()).toHaveLength(5);
  });

  it("imports a real external video only once and preserves manual provenance", async () => {
    const { ctx, draft } = await setup();
    const file = ensureDemoFile(ctx, "video");
    const input = { draftId: draft.id, revision: 1, fileId: file.id, name: "外部剪辑成片" };
    const first = importExternalVideo(ctx, input);
    updateDraft(ctx.db, draft.id, 1, { requirements: "之后的需求" });
    const repeated = importExternalVideo(ctx, input);
    expect(repeated.asset.id).toBe(first.asset.id);
    expect(repeated.replayed).toBe(true);
    expect(first.asset).toMatchObject({ provenance: "user_import", origin: "owned", sourceSnapshot: { demo: false, kind: "external_video" } });
    expect(first.asset.file?.sha256).toBe(file.sha256);
    expect(ctx.db.prepare("SELECT id FROM runs WHERE kind = 'external_video'").all()).toHaveLength(1);
  });

  it("archives successful batch items and rejects failed items", async () => {
    const { ctx, run } = await setup(true);
    expect(run.status).toBe("failed");
    expect(() => archiveResult(ctx, { runId: run.id, resultItemId: run.items[0]!.id })).toThrow(/只能归档/);
    expect(archiveResult(ctx, { runId: run.id, resultItemId: run.items[1]!.id }).asset.file_id).toBeTruthy();
  });

  it("rolls back asset, activity and idempotency writes when archive registration fails", async () => {
    const { ctx, run } = await setup();
    const before = ctx.db.prepare("SELECT COUNT(*) AS count FROM activities").get();
    ctx.db.exec("CREATE TRIGGER reject_archive BEFORE INSERT ON archives BEGIN SELECT RAISE(ABORT, 'injected archive failure'); END");
    const input = { runId: run.id, resultItemId: run.items[0]!.id };
    expect(() => archiveResult(ctx, input)).toThrow(/injected archive failure/);
    expect(ctx.db.prepare("SELECT id FROM assets").all()).toHaveLength(1);
    expect(ctx.db.prepare("SELECT COUNT(*) AS count FROM activities").get()).toEqual(before);
    expect(ctx.db.prepare("SELECT * FROM idempotency_keys WHERE scope = 'result-archive'").all()).toEqual([]);
    ctx.db.exec("DROP TRIGGER reject_archive");
    expect(archiveResult(ctx, input).replayed).toBe(false);
  });

  it("migrates a pre-existing asset with an empty source while preserving its data", () => {
    const dataDir = tempDataDir();
    const datasetId = "ds-before-sources";
    const directory = path.join(dataDir, "datasets", datasetId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "active.json"), JSON.stringify({ datasetId, activatedAt: "t", previousDatasetId: null }));
    const db = new Database(path.join(directory, "database.sqlite"));
    for (const migration of MIGRATIONS.slice(0, 4)) {
      db.exec(fs.readFileSync(path.join(migrationsDir(), migration.file), "utf8"));
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, 't')").run(migration.id);
    }
    db.prepare("INSERT INTO assets (id, name, asset_type, created_at, updated_at) VALUES ('old-asset', '原有资料', 'file', 't', 't')").run();
    db.close();
    const ctx = createContext(createConfig({ APP_DATA_DIR: dataDir })); contexts.push(ctx);
    expect(findAsset(ctx.db, "old-asset")).toMatchObject({ name: "原有资料", sourceSnapshot: null });
  });
});
