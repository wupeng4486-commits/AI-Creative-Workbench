import type Database from "better-sqlite3";
import { appError } from "../http/errors.ts";
import { newId } from "../util/id.ts";
import { nowIso, parseJson } from "../util/time.ts";
import { recordActivity } from "./events.ts";

export interface AgentInput {
  name: string;
  purpose: string;
  domain?: string;
  instructions?: string;
  outputRequirements?: string;
  cautions?: string;
  exampleDialog?: Array<{ question: string; answer: string }>;
  skillIds?: string[];
  productIds?: string[];
  assetIds?: string[];
}

interface Resource { id: string; name: string }
export interface AgentView {
  id: string;
  name: string;
  purpose: string;
  domain: string;
  origin: "owned" | "shared";
  author: string;
  instructions: string;
  output_requirements: string;
  cautions: string;
  example_dialog: Array<{ question: string; answer: string }>;
  created_at: string;
  updated_at: string;
  skills: Resource[];
  products: Resource[];
  assets: Resource[];
}

export function getAgent(db: Database.Database, id: string): AgentView {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw appError("AGENT_NOT_FOUND", "智能体不存在。");
  return {
    ...(row as unknown as AgentView),
    example_dialog: parseJson(String(row.example_dialog), []),
    skills: db.prepare("SELECT s.id, s.name FROM agent_skills r JOIN skills s ON s.id = r.skill_id WHERE r.agent_id = ?").all(id) as Resource[],
    products: db.prepare("SELECT p.id, p.name FROM agent_products r JOIN products p ON p.id = r.product_id WHERE r.agent_id = ?").all(id) as Resource[],
    assets: db.prepare("SELECT a.id, a.name FROM agent_assets r JOIN assets a ON a.id = r.asset_id WHERE r.agent_id = ?").all(id) as Resource[],
  };
}

export function listAgents(db: Database.Database, query: { search?: string; origin?: string; domain?: string }) {
  const search = (query.search ?? "").trim().toLowerCase();
  const rows = db.prepare("SELECT id FROM agents ORDER BY updated_at DESC, id").all() as Resource[];
  return rows.map((row) => getAgent(db, row.id)).filter((agent) =>
    (!query.origin || agent.origin === query.origin) &&
    (!query.domain || agent.domain === query.domain) &&
    (!search || `${agent.name} ${agent.purpose} ${agent.domain} ${agent.instructions}`.toLowerCase().includes(search)),
  );
}

function validate(input: Pick<AgentInput, "name" | "purpose">) {
  const fieldErrors: Record<string, string> = {};
  if (!input.name?.trim()) fieldErrors.name = "智能体名称不能为空。";
  if (!input.purpose?.trim()) fieldErrors.purpose = "用途不能为空。";
  if (Object.keys(fieldErrors).length) throw appError("VALIDATION_FAILED", "请检查必填项。", { fieldErrors });
}

function setLinks(db: Database.Database, id: string, input: Partial<AgentInput>) {
  const groups = [
    { ids: input.skillIds, table: "agent_skills", column: "skill_id", target: "skills", code: "SKILL_NOT_FOUND" },
    { ids: input.productIds, table: "agent_products", column: "product_id", target: "products", code: "PRODUCT_NOT_FOUND" },
    { ids: input.assetIds, table: "agent_assets", column: "asset_id", target: "assets", code: "ASSET_NOT_FOUND" },
  ];
  for (const group of groups) {
    if (!group.ids) continue;
    db.prepare(`DELETE FROM ${group.table} WHERE agent_id = ?`).run(id);
    for (const resourceId of new Set(group.ids)) {
      if (!db.prepare(`SELECT id FROM ${group.target} WHERE id = ?`).get(resourceId)) {
        throw appError(group.code, "关联资料不存在，请重新选择。");
      }
      db.prepare(`INSERT INTO ${group.table} (agent_id, ${group.column}) VALUES (?, ?)`).run(id, resourceId);
    }
  }
}

export function createAgent(db: Database.Database, input: AgentInput): AgentView {
  validate(input);
  const id = newId();
  const time = nowIso();
  db.transaction(() => {
    db.prepare(`INSERT INTO agents (id, name, purpose, domain, instructions, output_requirements, cautions, example_dialog, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.name.trim(), input.purpose.trim(), input.domain ?? "AI 视频", input.instructions ?? "",
      input.outputRequirements ?? "", input.cautions ?? "", JSON.stringify(input.exampleDialog ?? []), time, time,
    );
    setLinks(db, id, input);
    recordActivity(db, "agent", id, `新建智能体：${input.name.trim()}`, { name: input.name.trim() });
  })();
  return getAgent(db, id);
}

export function updateAgent(db: Database.Database, id: string, input: Partial<AgentInput>): AgentView {
  const current = getAgent(db, id);
  if (current.origin !== "owned") throw appError("FORBIDDEN", "共享智能体请先复制为自己的版本。");
  validate({ name: input.name ?? current.name, purpose: input.purpose ?? current.purpose });
  db.transaction(() => {
    db.prepare(`UPDATE agents SET name = ?, purpose = ?, domain = ?, instructions = ?, output_requirements = ?,
      cautions = ?, example_dialog = ?, updated_at = ? WHERE id = ?`).run(
      input.name?.trim() ?? current.name, input.purpose?.trim() ?? current.purpose, input.domain ?? current.domain,
      input.instructions ?? current.instructions, input.outputRequirements ?? current.output_requirements,
      input.cautions ?? current.cautions, JSON.stringify(input.exampleDialog ?? current.example_dialog), nowIso(), id,
    );
    setLinks(db, id, input);
    recordActivity(db, "agent", id, `更新智能体：${input.name ?? current.name}`, { name: input.name ?? current.name });
  })();
  return getAgent(db, id);
}

export function copyAgent(db: Database.Database, id: string): AgentView {
  const agent = getAgent(db, id);
  return createAgent(db, {
    name: `${agent.name}（副本）`, purpose: agent.purpose, domain: agent.domain, instructions: agent.instructions,
    outputRequirements: agent.output_requirements, cautions: agent.cautions, exampleDialog: agent.example_dialog,
    skillIds: agent.skills.map((item) => item.id), productIds: agent.products.map((item) => item.id),
    assetIds: agent.assets.map((item) => item.id),
  });
}
