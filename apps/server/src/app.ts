import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { APP_VERSION, type SystemInfo } from "@workbench/shared";
import type { AppConfig } from "./config.ts";

export interface AppDeps {
  config: AppConfig;
  version?: string;
}

const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"]);

export async function buildApp({ config, version }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: "warn" },
    bodyLimit: 1024 * 1024 * 2,
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
    try {
      const stats = fs.statfsSync(config.dataDir);
      freeBytes = stats.bavail * stats.bsize;
    } catch {
      freeBytes = null;
    }
    return {
      app: "AI Creative Workbench",
      version: version ?? APP_VERSION,
      dataDir: config.dataDir,
      datasetId: "boot",
      healthy: true,
      counts: {},
      disk: { freeBytes, totalBytes: null },
      lastBackup: null,
    };
  });

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
