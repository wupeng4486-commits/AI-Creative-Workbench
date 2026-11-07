import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { rememberSeedDeletion } from "../db/seed.ts";
import { appError } from "../http/errors.ts";
import { copyAgent, createAgent, getAgent, listAgents, updateAgent, type AgentInput } from "../services/agents.ts";
import { recordActivity, recordRecent } from "../services/events.ts";
import { agentReferences, assertNotReferenced } from "../services/references.ts";

const bodySchema = {
  type: "object",
  properties: {
    name: { type: "string" }, purpose: { type: "string" }, domain: { type: "string" },
    instructions: { type: "string" }, outputRequirements: { type: "string" }, cautions: { type: "string" },
    exampleDialog: { type: "array", items: { type: "object", required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } } },
    skillIds: { type: "array", items: { type: "string" }, uniqueItems: true },
    productIds: { type: "array", items: { type: "string" }, uniqueItems: true },
    assetIds: { type: "array", items: { type: "string" }, uniqueItems: true },
  },
};

export async function registerAgentRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/agents", async (request) => ({
    datasetId: ctx.datasetId,
    items: listAgents(ctx.db, request.query as Record<string, string>),
    domains: (ctx.db.prepare("SELECT DISTINCT domain FROM agents ORDER BY domain").all() as Array<{ domain: string }>).map((row) => row.domain),
  }));
  app.get("/api/agents/:id", async (request) => {
    const { id } = request.params as { id: string };
    const agent = getAgent(ctx.db, id);
    recordRecent(ctx.db, "agent", id, { name: agent.name });
    return {
      datasetId: ctx.datasetId, agent,
      skills: ctx.db.prepare("SELECT id, name FROM skills ORDER BY name").all(),
      products: ctx.db.prepare("SELECT id, name FROM products ORDER BY name").all(),
      assets: ctx.db.prepare("SELECT id, name FROM assets ORDER BY name").all(),
    };
  });
  app.post<{ Body: AgentInput }>("/api/agents", { schema: { body: bodySchema } }, async (request, reply) =>
    reply.code(201).send({ datasetId: ctx.datasetId, agent: createAgent(ctx.db, request.body) }),
  );
  app.patch<{ Body: Partial<AgentInput> }>("/api/agents/:id", { schema: { body: bodySchema } }, async (request) => {
    const { id } = request.params as { id: string };
    return { datasetId: ctx.datasetId, agent: updateAgent(ctx.db, id, request.body) };
  });
  app.post("/api/agents/:id/copy", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(201).send({ datasetId: ctx.datasetId, agent: copyAgent(ctx.db, id) });
  });
  app.delete("/api/agents/:id", async (request) => {
    const { id } = request.params as { id: string };
    const agent = getAgent(ctx.db, id);
    if (agent.origin !== "owned") throw appError("FORBIDDEN", "只能删除自己创建的智能体。");
    assertNotReferenced(agentReferences(ctx.db, id), "该智能体仍被草稿引用，请先解除引用。");
    ctx.db.transaction(() => {
      ctx.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
      rememberSeedDeletion(ctx.db, id);
      recordActivity(ctx.db, "agent", id, `删除智能体：${agent.name}`, { name: agent.name });
    })();
    return { datasetId: ctx.datasetId, deleted: true };
  });
}
