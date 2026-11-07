import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { archiveResult, importExternalVideo, workflowFromResult, type ArchiveInput } from "../services/results.ts";

export async function registerResultRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: ArchiveInput }>("/api/results/archive", { schema: { body: { type: "object", required: ["runId", "resultItemId"], properties: {
    runId: { type: "string" }, resultItemId: { type: "string" }, name: { type: "string" }, catalog: { type: "string" }, tags: { type: "array", items: { type: "string" } },
  } } } }, async (request, reply) => {
    const result = archiveResult(ctx, request.body);
    return reply.code(result.replayed ? 200 : 201).send({ datasetId: ctx.datasetId, ...result });
  });
  app.post<{ Body: { runId: string; name?: string } }>("/api/results/save-workflow", { schema: { body: { type: "object", required: ["runId"], properties: { runId: { type: "string" }, name: { type: "string" } } } } }, async (request, reply) => {
    const result = workflowFromResult(ctx, request.body.runId, request.body.name);
    return reply.code(result.replayed ? 200 : 201).send({ datasetId: ctx.datasetId, ...result });
  });
  app.post<{ Body: { draftId: string; revision: number; fileId: string; name?: string; tags?: string[] } }>("/api/results/external-video", { schema: { body: { type: "object", required: ["draftId", "revision", "fileId"], properties: {
    draftId: { type: "string" }, revision: { type: "integer", minimum: 1 }, fileId: { type: "string" }, name: { type: "string" }, tags: { type: "array", items: { type: "string" } },
  } } } }, async (request, reply) => {
    const result = importExternalVideo(ctx, request.body);
    return reply.code(result.replayed ? 200 : 201).send({ datasetId: ctx.datasetId, ...result });
  });
}
