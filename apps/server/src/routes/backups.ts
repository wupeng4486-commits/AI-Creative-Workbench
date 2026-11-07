import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { appError } from "../http/errors.ts";
import {
  backupPath,
  createBackup,
  listBackups,
} from "../services/backup.ts";

export async function registerBackupRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/backups", async () => ({ datasetId: ctx.datasetId, items: listBackups(ctx.db) }));

  app.post("/api/backups", async (request, reply) => {
    const { backup, manifest } = await createBackup(ctx.db, ctx.dataset.dir, ctx.config.dataDir, {
      datasetId: ctx.datasetId,
      barrier: ctx.barrier,
    });
    return reply.code(201).send({
      datasetId: ctx.datasetId,
      backup,
      manifest: {
        exportedAt: manifest.exportedAt,
        recordCounts: manifest.recordCounts,
        fileCount: manifest.files.length,
      },
      downloadUrl: `/api/backups/${backup.id}/download`,
    });
  });

  app.get("/api/backups/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = ctx.db
      .prepare("SELECT file_name, status FROM backups WHERE id = ?")
      .get(id) as { file_name: string; status: string } | undefined;
    if (!row || row.status !== "ready") {
      const latest = listBackups(ctx.db).find((item) => item.id === id);
      if (latest?.status === "failed") {
        throw appError("BACKUP_FAILED", "备份未完成，请重新导出。");
      }
      throw appError("NOT_FOUND", "备份不存在。");
    }
    const file = backupPath(ctx.config.dataDir, row.file_name);
    if (!fs.existsSync(file)) throw appError("NOT_FOUND", "备份文件已不存在。");
    reply.header(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    );
    return reply.type("application/zip").send(fs.createReadStream(file));
  });

  app.delete("/api/backups/:id", async (request) => {
    const { id } = request.params as { id: string };
    const row = ctx.db.prepare("SELECT file_name FROM backups WHERE id = ?").get(id) as
      | { file_name: string }
      | undefined;
    if (!row) throw appError("NOT_FOUND", "备份不存在。");
    fs.rmSync(backupPath(ctx.config.dataDir, row.file_name), { force: true });
    ctx.db.prepare("DELETE FROM backups WHERE id = ?").run(id);
    return { datasetId: ctx.datasetId, deleted: true };
  });
}
