import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { appError } from "../http/errors.ts";
import { newId } from "../util/id.ts";
import { nowIso } from "../util/time.ts";
import {
  activateRestore,
  cancelRestore,
  datasetHealth,
  prepareRestore,
} from "../services/restore.ts";
import { openActiveDataset } from "../db/datasets.ts";
import { seedDatabase } from "../db/seed.ts";
import { createBackup } from "../services/backup.ts";
import { markUnfinishedRunsInterrupted } from "../services/snapshots.ts";

export async function registerRestoreRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.post("/api/restores/upload", async (request, reply) => {
    const part = await request.file();
    if (!part) throw appError("FILE_REQUIRED", "请选择备份文件。");
    const sourceName = path.basename(part.filename ?? "backup.zip");
    if (!sourceName.toLowerCase().endsWith(".zip")) {
      part.file.resume();
      throw appError("RESTORE_INVALID", "请选择 .zip 备份包。");
    }
    const inbox = path.join(ctx.config.dataDir, "staging", "restores");
    fs.mkdirSync(inbox, { recursive: true });
    const target = path.join(inbox, `${newId()}.zip`);
    try {
      await pipeline(part.file, fs.createWriteStream(target));
      const preview = await prepareRestore(ctx, target, sourceName);
      return reply.code(201).send({ datasetId: ctx.datasetId, preview });
    } catch (error) {
      fs.rmSync(target, { force: true });
      throw error;
    }
  });

  app.post("/api/restores/:id/confirm", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { datasetId?: string; backupFirst?: boolean };
    if (!body.datasetId) {
      throw appError("DATASET_REQUIRED", "缺少当前数据集标识。", { datasetId: ctx.datasetId });
    }
    if (body.datasetId !== ctx.datasetId) {
      throw appError("DATASET_CHANGED", "当前数据集已变化，请重新加载。", {
        datasetId: ctx.datasetId,
      });
    }
    if (body.backupFirst) await createBackup(ctx.db, ctx.dataset.dir, ctx.config.dataDir, { datasetId: ctx.datasetId, barrier: ctx.barrier });
    const result = activateRestore(
      ctx.config.dataDir,
      id,
      ctx.datasetId,
      (datasetId) => datasetHealth(ctx.config.dataDir, datasetId),
    );
    ctx.close();
    const next = openActiveDataset(ctx.config.dataDir);
    seedDatabase(next.db);
    ctx.dataset = next;
    ctx.db = next.db;
    ctx.datasetId = next.datasetId;
    markUnfinishedRunsInterrupted(ctx.db);
    ctx.db.prepare("UPDATE run_items SET item_status = 'interrupted', message = '恢复时演示已中断。' WHERE item_status IN ('queued', 'running')").run();
    return reply.send({
      datasetId: ctx.datasetId,
      previousDatasetId: result.previousDatasetId,
      message: "恢复完成，已切换到备份数据集。",
      confirmedAt: nowIso(),
    });
  });

  app.post("/api/restores/:id/cancel", async (request) => {
    const { id } = request.params as { id: string };
    cancelRestore(ctx, id);
    return { datasetId: ctx.datasetId, cancelled: true };
  });

  app.get("/api/restores", async () => {
    const items = ctx.db
      .prepare(
        `SELECT id, status, source_name AS sourceName, exported_at AS exportedAt,
                record_counts AS recordCounts, file_count AS fileCount, message,
                created_at AS createdAt, finished_at AS finishedAt
         FROM restores ORDER BY created_at DESC LIMIT 20`,
      )
      .all();
    return {
      datasetId: ctx.datasetId,
      items: items.map((row) => ({
        ...(row as Record<string, unknown>),
        recordCounts: JSON.parse(
          (row as { recordCounts: string }).recordCounts || "{}",
        ) as Record<string, number>,
      })),
    };
  });
}
