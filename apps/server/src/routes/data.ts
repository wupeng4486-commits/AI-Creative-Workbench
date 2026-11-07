import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { seedDatabase, SEED_VERSION } from "../db/seed.ts";
import { newDatasetId, openDatabase, writeActivePointer } from "../db/datasets.ts";
import { runMigrations } from "../db/migrations.ts";
import { writeJournal, clearJournal } from "../services/activation.ts";
import { appError } from "../http/errors.ts";
import { nowIso } from "../util/time.ts";

export async function registerDataRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/api/system/seed", async () => {
    ctx.db.transaction(() => {
      ctx.db.prepare("DELETE FROM seed_tombstones").run();
      seedDatabase(ctx.db, true);
    })();
    return { datasetId: ctx.datasetId, message: "已补充缺失示例，已有资料与关联保留当前内容。" };
  });
  app.post("/api/system/reset", async (request) => {
    const body = (request.body ?? {}) as { datasetId?: string; confirmation?: string };
    if (body.confirmation !== "清空本机数据") throw appError("VALIDATION_FAILED", "请输入“清空本机数据”完成二次确认。");
    if (body.datasetId !== ctx.datasetId) throw appError("DATASET_CHANGED", "当前数据集已变化，请重新加载。", { datasetId: ctx.datasetId });
    const previous = ctx.datasetId;
    const nextId = newDatasetId();
    const db = openDatabase(ctx.config.dataDir, nextId);
    try {
      runMigrations(db);
      db.prepare("INSERT INTO seed_state (seed_key, seed_version, applied_at) VALUES ('demo', ?, ?)").run(SEED_VERSION, nowIso());
      seedDatabase(db);
      if ((db.pragma("integrity_check", { simple: true })) !== "ok") throw new Error("新数据集校验失败。");
    } finally { db.close(); }
    writeJournal(ctx.config.dataDir, { id: nextId, phase: "prepared", fromDatasetId: previous, toDatasetId: nextId, updatedAt: nowIso() });
    try {
      writeActivePointer(ctx.config.dataDir, { datasetId: nextId, previousDatasetId: previous, activatedAt: nowIso() });
      ctx.reopen();
      clearJournal(ctx.config.dataDir);
    } catch (error) {
      writeActivePointer(ctx.config.dataDir, { datasetId: previous, previousDatasetId: null, activatedAt: nowIso() });
      ctx.reopen();
      clearJournal(ctx.config.dataDir);
      throw error;
    }
    return { datasetId: ctx.datasetId, previousDatasetId: previous, message: "已启用空数据集。原完整数据集保留在本机。" };
  });
}
