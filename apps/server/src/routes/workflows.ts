import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { rememberSeedDeletion } from "../db/seed.ts";
import { appError } from "../http/errors.ts";
import { copyWorkflow, createWorkflow, getWorkflow, listWorkflows, updateWorkflow, type WorkflowInput } from "../services/workflows.ts";
import { recordActivity } from "../services/events.ts";
import { assertNotReferenced, workflowReferences } from "../services/references.ts";

const bodySchema = {
  type: "object", properties: {
    name: { type: "string" }, purpose: { type: "string" }, libtvRef: { type: "string" }, inputSpec: { type: "string" },
    defaultParameters: { type: "object", additionalProperties: true },
    steps: { type: "array", items: { type: "string" } }, coverFileId: { type: ["string", "null"] },
    skillIds: { type: "array", items: { type: "string" }, uniqueItems: true },
    assetIds: { type: "array", items: { type: "string" }, uniqueItems: true },
  },
};

export async function registerWorkflowRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/workflows", async (request) => ({
    datasetId: ctx.datasetId, items: listWorkflows(ctx.db, request.query as Record<string, string>),
    purposes: (ctx.db.prepare("SELECT DISTINCT purpose FROM team_workflows ORDER BY purpose").all() as Array<{ purpose: string }>).map((row) => row.purpose),
  }));
  app.get("/api/workflows/:id", async (request) => {
    const { id } = request.params as { id: string };
    return {
      datasetId: ctx.datasetId, workflow: getWorkflow(ctx.db, id),
      skills: ctx.db.prepare("SELECT id, name FROM skills ORDER BY name").all(),
      assets: ctx.db.prepare("SELECT a.id, a.name, a.file_id, f.mime_type FROM assets a LEFT JOIN files f ON f.id = a.file_id ORDER BY a.name").all(),
    };
  });
  app.post<{ Body: WorkflowInput }>("/api/workflows", { schema: { body: bodySchema } }, async (request, reply) =>
    reply.code(201).send({ datasetId: ctx.datasetId, workflow: createWorkflow(ctx.db, request.body) }),
  );
  app.patch<{ Body: Partial<WorkflowInput> }>("/api/workflows/:id", { schema: { body: bodySchema } }, async (request) => {
    const { id } = request.params as { id: string };
    return { datasetId: ctx.datasetId, workflow: updateWorkflow(ctx.db, id, request.body) };
  });
  app.post("/api/workflows/:id/copy", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(201).send({ datasetId: ctx.datasetId, workflow: copyWorkflow(ctx.db, id) });
  });
  app.delete("/api/workflows/:id", async (request) => {
    const { id } = request.params as { id: string };
    const workflow = getWorkflow(ctx.db, id);
    if (workflow.origin !== "owned") throw appError("FORBIDDEN", "只能删除自己创建的流程。");
    assertNotReferenced(workflowReferences(ctx.db, id), "工作流仍被草稿引用，请先解除引用。");
    ctx.db.transaction(() => {
      ctx.db.prepare("DELETE FROM team_workflows WHERE id = ?").run(id);
      rememberSeedDeletion(ctx.db, id);
      recordActivity(ctx.db, "workflow", id, `删除团队工作流：${workflow.name}`, { name: workflow.name });
    })();
    return { datasetId: ctx.datasetId, deleted: true };
  });
}
