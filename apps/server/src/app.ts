import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { APP_VERSION, type SystemInfo } from "@workbench/shared";
import type { AppConfig } from "./config.ts";
import { createContext } from "./context.ts";
import { getIntegrations, getPreferences } from "./services/settings.ts";
import { registerFileRoutes } from "./routes/files.ts";
import { registerBackupRoutes } from "./routes/backups.ts";
import { registerRestoreRoutes } from "./routes/restores.ts";
import { installErrorHandler } from "./http/errors.ts";
import { registerAssetRoutes } from "./routes/assets.ts";
import { registerCollectionRoutes } from "./routes/collections.ts";
import { registerSettingsRoutes } from "./routes/settings.ts";
import { registerSkillRoutes } from "./routes/skills.ts";

export interface AppDeps {
  config: AppConfig;
  version?: string;
}

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);

export async function buildApp({ config, version }: AppDeps): Promise<FastifyInstance> {
  const ctx = createContext(config);
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: "warn" },
    bodyLimit: 1024 * 1024 * 2,
  });
  app.addHook("onClose", async () => {
    ctx.close();
  });
  installErrorHandler(app, () => ctx.datasetId);
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024 * 1024, files: 1 },
  });

  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host?.split(":")[0] ?? "";
    if (!ALLOWED_HOSTS.has(host)) {
      return reply.code(403).send({
        code: "HOST_NOT_ALLOWED",
        message: "本机服务仅接受 127.0.0.1 或 localhost 的请求。",
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      const origin = request.headers.origin;
      if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        return reply.code(403).send({
          code: "ORIGIN_NOT_ALLOWED",
          message: "写请求来源不受信任。",
        });
      }
    }
  });

  app.get("/api/system/health", async (): Promise<{ ok: true; version: string }> => ({
    ok: true,
    version: version ?? APP_VERSION,
  }));

  app.get("/api/system/info", async (): Promise<SystemInfo> => {
    fs.mkdirSync(config.dataDir, { recursive: true });
    let freeBytes: number | null = null;
    let totalBytes: number | null = null;
    try {
      const stats = fs.statfsSync(config.dataDir);
      freeBytes = stats.bavail * stats.bsize;
      totalBytes = stats.blocks * stats.bsize;
    } catch {
      freeBytes = null;
      totalBytes = null;
    }
    const count = (table: string, where = "") => {
      const row = ctx.db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get() as {
        c: number;
      };
      return row.c;
    };
    const backups = fs.existsSync(path.join(config.dataDir, "backups"))
      ? fs
          .readdirSync(path.join(config.dataDir, "backups"))
          .filter((name) => name.endsWith(".zip"))
          .sort()
          .at(-1)
      : undefined;
    return {
      app: "AI Creative Workbench",
      version: version ?? APP_VERSION,
      dataDir: config.dataDir,
      datasetId: ctx.datasetId,
      healthy: true,
      counts: {
        agents: count("agents"),
        skills: count("skills"),
        products: count("products"),
        files: count("files"),
        assets: count("assets"),
        workflows: count("team_workflows"),
        drafts: count("drafts"),
        runs: count("runs"),
        connectors: count("connectors"),
        collections: count("case_collections"),
      },
      disk: { freeBytes, totalBytes },
      lastBackup: backups
        ? {
            id: backups,
            createdAt: fs.statSync(path.join(config.dataDir, "backups", backups)).mtime.toISOString(),
            size: fs.statSync(path.join(config.dataDir, "backups", backups)).size,
          }
        : null,
    };
  });

  app.get("/api/system/settings", async () => ({
    datasetId: ctx.datasetId,
    integrations: getIntegrations(ctx.db),
    preferences: getPreferences(ctx.db),
  }));

  await registerFileRoutes(app, ctx);
  await registerBackupRoutes(app, ctx);
  await registerRestoreRoutes(app, ctx);
  await registerAssetRoutes(app, ctx);
  await registerCollectionRoutes(app, ctx);
  await registerSettingsRoutes(app, ctx);
  await registerSkillRoutes(app, ctx);

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "接口不存在。" });
    }
    const index = path.join(config.webDistDir, "index.html");
    if (fs.existsSync(index)) {
      return reply.type("text/html").send(fs.createReadStream(index));
    }
    return reply
      .code(503)
      .type("text/plain; charset=utf-8")
      .send("前端尚未构建，请先运行 npm run build。");
  });

  if (fs.existsSync(config.webDistDir)) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      prefix: "/",
      index: ["index.html"],
      wildcard: false,
    });
  }

  return app;
}
