import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { appError } from "../http/errors.ts";
import { rememberSeedDeletion } from "../db/seed.ts";
import { recordActivity, recordRecent } from "../services/events.ts";
import {
  copySkill,
  createSkill,
  getSkill,
  listSkills,
  setSkillLinks,
  updateSkill,
  type SkillInput,
} from "../services/skills.ts";
import { skillReferences, assertNotReferenced } from "../services/references.ts";

const skillBody = {
  type: "object",
  properties: {
    name: { type: "string" },
    scenario: { type: "string" },
    origin: { type: "string", enum: ["owned", "shared"] },
    author: { type: "string" },
    skillType: { type: "string", enum: ["platform", "libtv_reference"] },
    tags: { type: "array", items: { type: "string" } },
    inputSpec: { type: "string" },
    steps: { type: "string" },
    outputSpec: { type: "string" },
    examples: { type: "string" },
    externalRef: { type: "string" },
  },
};

export async function registerSkillRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/skills", async (request) => {
    const query = request.query as Record<string, string>;
    return {
      datasetId: ctx.datasetId,
      items: listSkills(ctx.db, {
        search: query.search,
        origin: query.origin,
        scenario: query.scenario,
        skillType: query.skillType,
      }),
      scenarios: Array.from(
        new Set(
          (ctx.db.prepare("SELECT DISTINCT scenario FROM skills").all() as Array<{
            scenario: string;
          }>).map((row) => row.scenario),
        ),
      ).sort(),
    };
  });

  app.get("/api/skills/:id", async (request) => {
    const { id } = request.params as { id: string };
    const skill = getSkill(ctx.db, id);
    if (!skill) throw appError("SKILL_NOT_FOUND", "技能不存在。");
    recordRecent(ctx.db, "skill", id, { name: skill.name });
    const agents = ctx.db.prepare("SELECT id, name FROM agents ORDER BY name").all();
    const workflows = ctx.db
      .prepare("SELECT id, name FROM team_workflows ORDER BY name")
      .all();
    return { datasetId: ctx.datasetId, skill, agents, workflows };
  });

  app.post<{ Body: SkillInput }>(
    "/api/skills",
    { schema: { body: skillBody } },
    async (request, reply) => {
      const skill = createSkill(ctx.db, request.body);
      return reply.code(201).send({ datasetId: ctx.datasetId, skill });
    },
  );

  app.patch<{ Body: Partial<SkillInput> }>(
    "/api/skills/:id",
    { schema: { body: skillBody } },
    async (request) => {
      const { id } = request.params as { id: string };
      return { datasetId: ctx.datasetId, skill: updateSkill(ctx.db, id, request.body) };
    },
  );

  app.post("/api/skills/:id/copy", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(201).send({ datasetId: ctx.datasetId, skill: copySkill(ctx.db, id) });
  });

  app.put<{ Body: { agentIds?: string[]; workflowIds?: string[] } }>(
    "/api/skills/:id/links",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            agentIds: { type: "array", items: { type: "string" }, uniqueItems: true },
            workflowIds: { type: "array", items: { type: "string" }, uniqueItems: true },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const skill = setSkillLinks(ctx.db, id, request.body);
      return { datasetId: ctx.datasetId, skill };
    },
  );

  app.delete("/api/skills/:id", async (request) => {
    const { id } = request.params as { id: string };
    const skill = getSkill(ctx.db, id);
    if (!skill) throw appError("SKILL_NOT_FOUND", "技能不存在。");
    if (skill.origin !== "owned") throw appError("FORBIDDEN", "只能删除自己创建的技能。");
    assertNotReferenced(skillReferences(ctx.db, id), "该技能仍被智能体、流程或草稿引用。");
    ctx.db.transaction(() => {
      ctx.db.prepare("DELETE FROM agent_skills WHERE skill_id = ?").run(id);
      ctx.db.prepare("DELETE FROM workflow_skills WHERE skill_id = ?").run(id);
      ctx.db.prepare("DELETE FROM draft_skills WHERE skill_id = ?").run(id);
      ctx.db.prepare("DELETE FROM skills WHERE id = ?").run(id);
      rememberSeedDeletion(ctx.db, id);
      recordActivity(ctx.db, "skill", id, `删除技能：${skill.name}`, { name: skill.name });
    })();
    return { datasetId: ctx.datasetId, deleted: true };
  });
}
