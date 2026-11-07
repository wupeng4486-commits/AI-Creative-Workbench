import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import type { AppContext } from "../context.ts";
import {
  absoluteFilePath,
  commitStagedFile,
  describeFile,
  getFile,
  guessMimeType,
  insertFile,
  previewsRoot,
  stageUpload,
} from "../storage/files.ts";

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

function decodeName(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name) || /[^\u0000-\u00ff]/.test(name)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\ufffd") ? name : decoded;
}

export async function registerFileRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.post("/api/files/upload", async (request, reply) => {
    const part = await request.file();
    if (!part) {
      return reply.code(400).send({ code: "FILE_REQUIRED", message: "请选择要导入的文件。" });
    }
    const originalName = path.basename(decodeName(part.filename ?? ""));
    if (!originalName || originalName === "." || originalName === "..") {
      return reply.code(400).send({ code: "FILE_NAME_INVALID", message: "文件名无效。" });
    }
    const mimeType = part.mimetype || guessMimeType(originalName);
    try {
      const staged = await stageUpload(
        path.join(ctx.config.dataDir, "staging", "uploads"),
        part.file,
      );
      const committed = commitStagedFile(
        ctx.dataset.dir,
        staged.stagingPath,
        originalName,
        mimeType,
        staged.sha256,
      );
      const record = insertFile(ctx.db, committed);
      return reply.code(201).send(describeFile(record));
    } catch (error) {
      request.log.error(error);
      const tooLarge = (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE";
      return reply.code(tooLarge ? 413 : 500).send({
        code: tooLarge ? "FILE_TOO_LARGE" : "UPLOAD_FAILED",
        message: tooLarge
          ? "文件超过 512 MB 上限。"
          : "文件写入失败，未创建资产记录，请重试。",
      });
    }
  });

  app.get("/api/files/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = getFile(ctx.db, id);
    if (!record) {
      return reply.code(404).send({ code: "FILE_NOT_FOUND", message: "文件不存在。" });
    }
    return describeFile(record);
  });

  app.get("/api/files/:id/thumb", async (request, reply) => {
    const { id } = request.params as { id: string };
    const thumb = path.join(previewsRoot(ctx.dataset.dir), id, "thumb.png");
    if (!fs.existsSync(thumb)) {
      return reply.code(404).send({ code: "THUMB_NOT_FOUND", message: "没有可用缩略图。" });
    }
    return reply.type("image/png").send(fs.createReadStream(thumb));
  });

  app.get("/api/files/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = getFile(ctx.db, id);
    if (!record) {
      return reply.code(404).send({ code: "FILE_NOT_FOUND", message: "文件不存在。" });
    }
    const file = absoluteFilePath(ctx.dataset.dir, record.relative_path);
    reply.header(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(record.original_name)}`,
    );
    return reply.type(record.mime_type).send(fs.createReadStream(file));
  });

  app.get("/api/files/:id/content", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = getFile(ctx.db, id);
    if (!record) {
      return reply.code(404).send({ code: "FILE_NOT_FOUND", message: "文件不存在。" });
    }
    const file = absoluteFilePath(ctx.dataset.dir, record.relative_path);
    const size = fs.statSync(file).size;
    const range = request.headers.range;
    reply.header("accept-ranges", "bytes").type(record.mime_type);
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        return reply.code(416).header("content-range", `bytes */${size}`).send();
      }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        return reply.code(416).header("content-range", `bytes */${size}`).send();
      }
      reply
        .code(206)
        .header("content-range", `bytes ${start}-${end}/${size}`)
        .header("content-length", end - start + 1);
      return reply.send(fs.createReadStream(file, { start, end }));
    }
    reply.header("content-length", size);
    return reply.send(fs.createReadStream(file));
  });

  app.get("/api/files/:id/text", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = getFile(ctx.db, id);
    if (!record || record.size > 1024 * 1024) {
      return reply.code(404).send({ code: "FILE_NOT_FOUND", message: "文件不可读取为文本。" });
    }
    const file = absoluteFilePath(ctx.dataset.dir, record.relative_path);
    const text = await fs.promises.readFile(file, "utf8");
    return { text };
  });
}
