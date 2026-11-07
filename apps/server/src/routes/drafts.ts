import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { carryIntoDraft, createDraft, getDraft, listDrafts, updateDraft, type DraftInput } from "../services/drafts.ts";
import { withIdempotency } from "../services/idempotency.ts";
import { recordRecent } from "../services/events.ts";

const bodySchema = { type: "object", properties: {
  creationType: { type: "string", enum: ["ai_video", "ai_image", "design", "video_join"] },
  name: { type: "string" }, requirements: { type: "string" }, parameters: { type: "object", additionalProperties: true },
  agentId: { type: ["string", "null"] }, productId: { type: ["string", "null"] }, workflowId: { type: ["string", "null"] },
  assetIds: { type: "array", items: { type: "string" }, uniqueItems: true }, skillIds: { type: "array", items: { type: "string" }, uniqueItems: true },
  revision: { type: "integer", minimum: 1 },
  clipAssetIds: { type: "array", maxItems: 50, items: { type: "string" } },
} };

export async function registerDraftRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/drafts", async (request) => ({ datasetId: ctx.datasetId, items: listDrafts(ctx.db, (request.query as { creationType?: string }).creationType) }));
  app.get("/api/drafts/:id", async (request) => {
    const draft = getDraft(ctx.db, (request.params as { id: string }).id);
    recordRecent(ctx.db, "draft", draft.id, { name: draft.name, creationType: draft.creationType });
    return { datasetId: ctx.datasetId, draft };
  });
  app.post<{ Body: DraftInput }>("/api/drafts", { schema: { body: { ...bodySchema, required: ["creationType"] } } }, async (request, reply) => {
    const result = ctx.db.transaction(() => withIdempotency(ctx.db, "draft-create", request.headers["idempotency-key"] as string | undefined, () => createDraft(ctx.db, request.body)))();
    return reply.code(result.replayed ? 200 : 201).send({ datasetId: ctx.datasetId, draft: getDraft(ctx.db, result.resource.id), replayed: result.replayed });
  });
  app.patch<{ Body: Partial<DraftInput> & { revision: number } }>("/api/drafts/:id", { schema: { body: { ...bodySchema, required: ["revision"] } } }, async (request) => ({
    datasetId: ctx.datasetId, draft: updateDraft(ctx.db, (request.params as { id: string }).id, request.body.revision, request.body),
  }));
  app.post<{ Body: Partial<DraftInput> & { revision: number } }>("/api/drafts/:id/carry", { schema: { body: { ...bodySchema, required: ["revision"] } } }, async (request) => ({
    datasetId: ctx.datasetId, draft: carryIntoDraft(ctx.db, (request.params as { id: string }).id, request.body.revision, request.body),
  }));
}
