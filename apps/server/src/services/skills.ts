import type Database from "better-sqlite3";
import { newId } from "../util/id.ts";
import { nowIso, parseJson } from "../util/time.ts";
import { recordActivity } from "./events.ts";
import { appError } from "../http/errors.ts";

export interface SkillRow {
  id: string;
  name: string;
  scenario: string;
  origin: "owned" | "shared";
  author: string;
  skill_type: "platform" | "libtv_reference";
  tags: string[];
  input_spec: string;
  steps: string;
  output_spec: string;
  examples: string;
  external_ref: string;
  created_at: string;
  updated_at: string;
}

export interface SkillView extends SkillRow {
  agents: Array<{ id: string; name: string }>;
  workflows: Array<{ id: string; name: string }>;
}

export function mapSkill(row: Record<string, unknown>): SkillRow {
  return {
    ...(row as unknown as SkillRow),
    tags: parseJson(row.tags as string, []),
  };
}

export function listSkills(
  db: Database.Database,
  query: { search?: string; origin?: string; scenario?: string; skillType?: string },
): SkillView[] {
  const rows = db.prepare("SELECT * FROM skills ORDER BY updated_at DESC").all() as Array<
    Record<string, unknown>
  >;
  const search = (query.search ?? "").trim().toLowerCase();
  return rows
    .map(mapSkill)
    .filter((row) => {
      if (query.origin && row.origin !== query.origin) return false;
      if (query.scenario && row.scenario !== query.scenario) return false;
      if (query.skillType && row.skill_type !== query.skillType) return false;
      if (
        search &&
        ![row.name, row.scenario, ...row.tags, row.input_spec, row.steps, row.output_spec, row.examples]
          .join(" ")
          .toLowerCase()
          .includes(search)
      ) {
        return false;
      }
      return true;
    })
    .map((row) => ({
      ...row,
      agents: db
        .prepare(
          "SELECT a.id, a.name FROM agent_skills s JOIN agents a ON a.id = s.agent_id WHERE s.skill_id = ?",
        )
        .all(row.id) as Array<{ id: string; name: string }>,
      workflows: db
        .prepare(
          "SELECT w.id, w.name FROM workflow_skills s JOIN team_workflows w ON w.id = s.workflow_id WHERE s.skill_id = ?",
        )
        .all(row.id) as Array<{ id: string; name: string }>,
    }));
}

export function getSkill(db: Database.Database, id: string): SkillView | undefined {
  return listSkills(db, {}).find((skill) => skill.id === id);
}

export interface SkillInput {
  name: string;
  scenario: string;
  origin?: "owned" | "shared";
  author?: string;
  skillType?: "platform" | "libtv_reference";
  tags?: string[];
  inputSpec?: string;
  steps?: string;
  outputSpec?: string;
  examples?: string;
  externalRef?: string;
}

export function validateSkill(input: Partial<SkillInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.name?.trim()) errors.name = "技能名称不能为空。";
  if (!input.scenario?.trim()) errors.scenario = "适用场景不能为空。";
  return errors;
}

export function createSkill(db: Database.Database, input: SkillInput): SkillView {
  const errors = validateSkill(input);
  if (Object.keys(errors).length > 0) {
    const error = new Error("请检查必填项。") as Error & {
      code: string;
      fieldErrors: Record<string, string>;
    };
    error.code = "VALIDATION_FAILED";
    error.fieldErrors = errors;
    throw error;
  }
  const id = newId();
  const time = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO skills (id, name, scenario, origin, author, skill_type, tags, input_spec, steps, output_spec, examples, external_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name.trim(),
      input.scenario.trim(),
      input.origin ?? "owned",
      input.author ?? "本机用户",
      input.skillType ?? "platform",
      JSON.stringify(input.tags ?? []),
      input.inputSpec ?? "",
      input.steps ?? "",
      input.outputSpec ?? "",
      input.examples ?? "",
      input.externalRef ?? "",
      time,
      time,
    );
    recordActivity(db, "skill", id, `新建技能：${input.name.trim()}`, { name: input.name.trim() });
  })();
  return getSkill(db, id)!;
}

export function updateSkill(
  db: Database.Database,
  id: string,
  input: Partial<SkillInput>,
): SkillView {
  const current = getSkill(db, id);
  if (!current) {
    const error = new Error("技能不存在。") as Error & { code: string };
    error.code = "SKILL_NOT_FOUND";
    throw error;
  }
  if (current.origin !== "owned") {
    throw appError("FORBIDDEN", "共享技能请先复制为自己的技能再编辑。");
  }
  const merged = { ...current, ...input };
  const errors = validateSkill(merged);
  if (Object.keys(errors).length > 0) {
    const error = new Error("请检查必填项。") as Error & {
      code: string;
      fieldErrors: Record<string, string>;
    };
    error.code = "VALIDATION_FAILED";
    error.fieldErrors = errors;
    throw error;
  }
  db.transaction(() => {
    db.prepare(
      `UPDATE skills SET name = ?, scenario = ?, tags = ?, input_spec = ?, steps = ?, output_spec = ?,
       examples = ?, external_ref = ?, skill_type = ?, updated_at = ? WHERE id = ?`,
    ).run(
      input.name?.trim() ?? current.name,
      input.scenario?.trim() ?? current.scenario,
      JSON.stringify(input.tags ?? current.tags),
      input.inputSpec ?? current.input_spec,
      input.steps ?? current.steps,
      input.outputSpec ?? current.output_spec,
      input.examples ?? current.examples,
      input.externalRef ?? current.external_ref,
      input.skillType ?? current.skill_type,
      nowIso(),
      id,
    );
    recordActivity(db, "skill", id, `更新技能：${input.name?.trim() ?? current.name}`, {
      name: input.name?.trim() ?? current.name,
    });
  })();
  return getSkill(db, id)!;
}

/** Copies always become a new, locally owned record; the source is unchanged. */
export function copySkill(db: Database.Database, id: string): SkillView {
  const source = getSkill(db, id);
  if (!source) {
    const error = new Error("技能不存在。") as Error & { code: string };
    error.code = "SKILL_NOT_FOUND";
    throw error;
  }
  return createSkill(db, {
    name: `${source.name}（副本）`,
    scenario: source.scenario,
    origin: "owned",
    author: "本机用户",
    skillType: source.skill_type,
    tags: [...source.tags],
    inputSpec: source.input_spec,
    steps: source.steps,
    outputSpec: source.output_spec,
    examples: source.examples,
    externalRef: source.external_ref,
  });
}

export function setSkillLinks(
  db: Database.Database,
  id: string,
  links: { agentIds?: string[]; workflowIds?: string[] },
): SkillView {
  if (!getSkill(db, id)) {
    const error = new Error("技能不存在。") as Error & { code: string };
    error.code = "SKILL_NOT_FOUND";
    throw error;
  }
  db.transaction(() => {
    if (links.agentIds) {
      db.prepare("DELETE FROM agent_skills WHERE skill_id = ?").run(id);
      for (const agentId of links.agentIds) {
        const exists = db.prepare("SELECT id FROM agents WHERE id = ?").get(agentId);
        if (!exists) {
          const error = new Error("关联的智能体不存在。") as Error & { code: string };
          error.code = "AGENT_NOT_FOUND";
          throw error;
        }
        db.prepare("INSERT INTO agent_skills (agent_id, skill_id) VALUES (?, ?)").run(agentId, id);
      }
    }
    if (links.workflowIds) {
      db.prepare("DELETE FROM workflow_skills WHERE skill_id = ?").run(id);
      for (const workflowId of links.workflowIds) {
        const exists = db.prepare("SELECT id FROM team_workflows WHERE id = ?").get(workflowId);
        if (!exists) {
          const error = new Error("关联的工作流不存在。") as Error & { code: string };
          error.code = "WORKFLOW_NOT_FOUND";
          throw error;
        }
        db.prepare(
          "INSERT INTO workflow_skills (workflow_id, skill_id) VALUES (?, ?)",
        ).run(workflowId, id);
      }
    }
  })();
  return getSkill(db, id)!;
}
