import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { DemoRunner, getDemoRun, LIBTV_SAMPLES, type DemoRunInput } from "../services/demo-runs.ts";
import { createWorkflow } from "../services/workflows.ts";
import { appError } from "../http/errors.ts";

export async function registerRunRoutes(app: FastifyInstance, ctx: AppContext) {
  const runner = new DemoRunner(ctx);
  app.addHook("onClose", async () => runner.close());
  app.get("/api/workflows/libtv/samples", async () => ({ items: LIBTV_SAMPLES, connected: false }));
  app.post("/api/workflows/libtv/:id/save", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sample = LIBTV_SAMPLES.find((item) => item.id === id);
    if (!sample) throw appError("WORKFLOW_NOT_FOUND", "LibTV 示例不存在。");
    return reply.code(201).send({ workflow: createWorkflow(ctx.db, { ...sample }) });
  });
  app.get("/api/runs", async (request) => {
    const query = request.query as { owner?: string; ownerId?: string };
    const rows = ctx.db.prepare("SELECT id FROM runs WHERE (? IS NULL OR owner = ?) AND (? IS NULL OR owner_id = ?) ORDER BY started_at DESC, rowid DESC").all(query.owner ?? null, query.owner ?? null, query.ownerId ?? null, query.ownerId ?? null) as Array<{ id: string }>;
    return { datasetId: ctx.datasetId, items: rows.map((row) => getDemoRun(ctx, row.id)) };
  });
  app.get("/api/runs/:id", async (request) => getDemoRun(ctx, (request.params as { id: string }).id));
  app.post<{ Body: DemoRunInput }>("/api/runs", { schema: { body: {
    type: "object", required: ["owner", "ownerId", "requirements"], properties: {
      owner: { type: "string", enum: ["workflow", "connector", "draft"] }, ownerId: { type: "string" }, requirements: { type: "string" },
      parameters: { type: "object", additionalProperties: true }, assetIds: { type: "array", items: { type: "string" }, uniqueItems: true },
      sampleInputs: { type: "boolean" }, simulateFailure: { type: "boolean" },
      draftRevision: { type: "integer", minimum: 1 },
    },
  } } }, async (request, reply) => reply.code(201).send(runner.start(request.body)));
  app.post("/api/runs/:id/stop", async (request) => runner.stop((request.params as { id: string }).id));
  app.post("/api/runs/:id/retry", async (request, reply) => reply.code(201).send(runner.retry((request.params as { id: string }).id)));
  return runner;
}
