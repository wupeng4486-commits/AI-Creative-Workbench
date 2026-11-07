import type Database from "better-sqlite3";
import type { ResultSourceSnapshot } from "@workbench/shared";
import { appError } from "../http/errors.ts";
import { newId } from "../util/id.ts";
import { nowIso, parseJson } from "../util/time.ts";
import { findAsset, type AssetView } from "./assets.ts";
import { recordActivity } from "./events.ts";

export interface WorkflowInput {
  name: string;
  purpose?: string;
  libtvRef?: string;
  inputSpec?: string;
  defaultParameters?: Record<string, unknown>;
  steps?: string[];
  coverFileId?: string | null;
  skillIds?: string[];
  assetIds?: string[];
  sourceSnapshot?: ResultSourceSnapshot | null;
}

export interface WorkflowView {
  id: string;
  name: string;
  purpose: string;
  origin: "owned" | "shared";
  author: string;
  libtv_ref: string;
  input_spec: string;
  default_parameters: Record<string, unknown>;
  steps: string[];
  cover_file_id: string | null;
  created_at: string;
  updated_at: string;
  skills: Array<{ id: string; name: string }>;
  assets: AssetView[];
  sourceSnapshot: ResultSourceSnapshot | null;
}

export function getWorkflow(db: Database.Database, id: string): WorkflowView {
  const row = db.prepare("SELECT * FROM team_workflows WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw appError("WORKFLOW_NOT_FOUND", "工作流不存在。");
  const { source_snapshot, ...workflow } = row;
  const refs = db.prepare("SELECT DISTINCT asset_id FROM workflow_assets WHERE workflow_id = ?").all(id) as Array<{ asset_id: string }>;
  return {
    ...(workflow as unknown as WorkflowView),
    sourceSnapshot: parseJson(String(source_snapshot ?? "null"), null),
    default_parameters: parseJson(String(row.default_parameters), {}),
    steps: parseJson(String(row.steps), []),
    skills: db.prepare("SELECT s.id, s.name FROM workflow_skills r JOIN skills s ON s.id = r.skill_id WHERE r.workflow_id = ?").all(id) as Array<{ id: string; name: string }>,
    assets: refs.map((ref) => findAsset(db, ref.asset_id)!),
  };
}

export function listWorkflows(db: Database.Database, query: { search?: string; origin?: string; purpose?: string }) {
  const search = (query.search ?? "").trim().toLowerCase();
  const rows = db.prepare("SELECT id FROM team_workflows ORDER BY updated_at DESC, id").all() as Array<{ id: string }>;
  return rows.map((row) => getWorkflow(db, row.id)).filter((flow) =>
    (!query.origin || flow.origin === query.origin) &&
    (!query.purpose || flow.purpose === query.purpose) &&
    (!search || `${flow.name} ${flow.purpose} ${flow.input_spec} ${flow.steps.join(" ")}`.toLowerCase().includes(search)),
  );
}

function validate(db: Database.Database, input: Partial<WorkflowInput>) {
  if (!input.name?.trim()) throw appError("VALIDATION_FAILED", "工作流名称不能为空。", { fieldErrors: { name: "请输入工作流名称。" } });
  if (input.coverFileId && !db.prepare("SELECT id FROM files WHERE id = ? AND mime_type LIKE 'image/%'").get(input.coverFileId)) {
    throw appError("VALIDATION_FAILED", "封面需要选择已导入的图片文件。");
  }
}

function setLinks(db: Database.Database, id: string, input: Partial<WorkflowInput>) {
  if (input.skillIds) {
    db.prepare("DELETE FROM workflow_skills WHERE workflow_id = ?").run(id);
    for (const skillId of new Set(input.skillIds)) {
      if (!db.prepare("SELECT id FROM skills WHERE id = ?").get(skillId)) throw appError("SKILL_NOT_FOUND", "关联技能不存在。");
      db.prepare("INSERT INTO workflow_skills (workflow_id, skill_id) VALUES (?, ?)").run(id, skillId);
    }
  }
  if (input.assetIds) {
    db.prepare("DELETE FROM workflow_assets WHERE workflow_id = ?").run(id);
    for (const assetId of new Set(input.assetIds)) {
      if (!findAsset(db, assetId)) throw appError("ASSET_NOT_FOUND", "流程附件或示例不存在。");
      db.prepare("INSERT INTO workflow_assets (workflow_id, asset_id, role) VALUES (?, ?, 'attachment')").run(id, assetId);
    }
  }
}

export function createWorkflow(db: Database.Database, input: WorkflowInput): WorkflowView {
  validate(db, input);
  const id = newId();
  const time = nowIso();
  db.transaction(() => {
    db.prepare(`INSERT INTO team_workflows (id, name, purpose, libtv_ref, input_spec, default_parameters, steps, cover_file_id, source_snapshot, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.name.trim(), input.purpose ?? "", input.libtvRef ?? "", input.inputSpec ?? "",
      JSON.stringify(input.defaultParameters ?? {}), JSON.stringify(input.steps ?? []), input.coverFileId ?? null, JSON.stringify(input.sourceSnapshot ?? null), time, time,
    );
    setLinks(db, id, input);
    recordActivity(db, "workflow", id, `新建团队工作流：${input.name.trim()}`, { name: input.name.trim() });
  })();
  return getWorkflow(db, id);
}

export function updateWorkflow(db: Database.Database, id: string, input: Partial<WorkflowInput>): WorkflowView {
  const current = getWorkflow(db, id);
  if (current.origin !== "owned") throw appError("FORBIDDEN", "共享工作流请先复制为自己的版本。");
  validate(db, { ...input, name: input.name ?? current.name });
  db.transaction(() => {
    db.prepare(`UPDATE team_workflows SET name = ?, purpose = ?, libtv_ref = ?, input_spec = ?, default_parameters = ?, steps = ?, cover_file_id = ?, updated_at = ? WHERE id = ?`).run(
      input.name?.trim() ?? current.name, input.purpose ?? current.purpose, input.libtvRef ?? current.libtv_ref,
      input.inputSpec ?? current.input_spec, JSON.stringify(input.defaultParameters ?? current.default_parameters),
      JSON.stringify(input.steps ?? current.steps), input.coverFileId === undefined ? current.cover_file_id : input.coverFileId, nowIso(), id,
    );
    setLinks(db, id, input);
    recordActivity(db, "workflow", id, `更新团队工作流：${input.name ?? current.name}`, { name: input.name ?? current.name });
  })();
  return getWorkflow(db, id);
}

export function copyWorkflow(db: Database.Database, id: string): WorkflowView {
  const source = getWorkflow(db, id);
  return createWorkflow(db, {
    name: `${source.name}（副本）`, purpose: source.purpose, libtvRef: source.libtv_ref,
    inputSpec: source.input_spec, defaultParameters: source.default_parameters, steps: source.steps,
    coverFileId: source.cover_file_id, skillIds: source.skills.map((item) => item.id), assetIds: source.assets.map((item) => item.id),
    sourceSnapshot: source.sourceSnapshot,
  });
}
