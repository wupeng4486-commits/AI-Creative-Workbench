import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { createConnector, getConnector, importConnectorBatch, updateConnector, validateConnectorInput, type ConnectorInput } from "../services/connectors.ts";
import type { DemoRunner } from "../services/demo-runs.ts";

const bodySchema = { type: "object", properties: {
  name: { type: "string" }, serviceType: { type: "string", enum: ["shopify", "gmail", "github", "creation_tool"] }, enabled: { type: "boolean" },
  config: { type: "object", required: ["label", "endpoint", "note"], additionalProperties: false, properties: { label: { type: "string" }, endpoint: { type: "string" }, note: { type: "string" } } },
} };

export async function registerConnectorRoutes(app: FastifyInstance, ctx: AppContext, runner: DemoRunner) {
  app.get("/api/connectors", async () => ({
    datasetId: ctx.datasetId,
    items: (ctx.db.prepare("SELECT id FROM connectors ORDER BY created_at, id").all() as Array<{ id: string }>).map((row) => getConnector(ctx.db, row.id)),
  }));
  app.post<{ Body: ConnectorInput }>("/api/connectors", { schema: { body: { ...bodySchema, required: ["name", "serviceType"] } } }, async (request, reply) =>
    reply.code(201).send({ connector: createConnector(ctx.db, request.body) }),
  );
  app.patch<{ Body: Partial<ConnectorInput> }>("/api/connectors/:id", { schema: { body: bodySchema } }, async (request) => {
    const { id } = request.params as { id: string };
    validateConnectorInput(request.body);
    if (request.body.config || request.body.enabled === false) {
      const active = ctx.db.prepare("SELECT id FROM runs WHERE owner = 'connector' AND owner_id = ? AND status IN ('queued', 'running')").all(id) as Array<{ id: string }>;
      for (const run of active) runner.stop(run.id);
    }
    return { connector: updateConnector(ctx.db, id, request.body) };
  });
  for (const action of ["connect", "sync"] as const) {
    app.post<{ Body: { simulateFailure?: boolean } }>(`/api/connectors/:id/${action}`, {
      schema: { body: { type: "object", properties: { simulateFailure: { type: "boolean" } } } },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.code(201).send(runner.start({ owner: "connector", ownerId: id, requirements: action === "connect" ? "模拟连接" : "模拟同步", sampleInputs: true, simulateFailure: request.body?.simulateFailure, parameters: { action, count: action === "sync" ? 3 : 1 } }));
    });
  }
  app.post<{ Body: { runId: string } }>("/api/connectors/:id/import", { schema: { body: { type: "object", required: ["runId"], properties: { runId: { type: "string" } } } } }, async (request) =>
    importConnectorBatch(ctx, (request.params as { id: string }).id, request.body.runId),
  );
}
