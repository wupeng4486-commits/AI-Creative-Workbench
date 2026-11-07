import type Database from "better-sqlite3";
import type { CreationType } from "@workbench/shared";
import { appError } from "../http/errors.ts";
import { newId } from "../util/id.ts";
import { nowIso, parseJson } from "../util/time.ts";
import { getAgent } from "./agents.ts";
import { getWorkflow } from "./workflows.ts";
import { buildSnapshot } from "./snapshots.ts";
import { recordActivity } from "./events.ts";

export interface DraftInput {
  creationType: CreationType;
  name?: string;
  requirements?: string;
  parameters?: Record<string, unknown>;
  agentId?: string | null;
  productId?: string | null;
  workflowId?: string | null;
  assetIds?: string[];
  skillIds?: string[];
}
export interface DraftView extends DraftInput {
  id: string;
  name: string;
  requirements: string;
  parameters: Record<string, unknown>;
  agentId: string | null;
  productId: string | null;
  workflowId: string | null;
  assetIds: string[];
  skillIds: string[];
  revision: number;
  clips: Array<{ assetId: string; position: number }>;
  createdAt: string;
  updatedAt: string;
}

export const DRAFT_PARAMETER_DEFAULTS: Record<CreationType, Record<string, unknown>> = {
  ai_video: { duration: 15, ratio: "9:16", shotRequirements: "" },
  ai_image: { width: 1024, height: 1024, count: 3, composition: "", style: "" },
  design: {},
  video_join: {},
};

export function getDraft(db: Database.Database, id: string): DraftView {
  const row = db.prepare("SELECT * FROM drafts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw appError("DRAFT_NOT_FOUND", "草稿不存在。");
  return {
    id, creationType: row.creation_type as CreationType, name: String(row.name), requirements: String(row.requirements),
    parameters: { ...DRAFT_PARAMETER_DEFAULTS[row.creation_type as CreationType], ...parseJson<Record<string, unknown>>(String(row.parameters), {}) }, agentId: row.agent_id as string | null,
    productId: row.product_id as string | null, workflowId: row.workflow_id as string | null,
    assetIds: (db.prepare("SELECT asset_id FROM draft_assets WHERE draft_id = ? ORDER BY rowid").all(id) as Array<{ asset_id: string }>).map((item) => item.asset_id),
    skillIds: (db.prepare("SELECT skill_id FROM draft_skills WHERE draft_id = ? ORDER BY rowid").all(id) as Array<{ skill_id: string }>).map((item) => item.skill_id),
    clips: db.prepare("SELECT asset_id AS assetId, position FROM draft_clips WHERE draft_id = ? ORDER BY position").all(id) as DraftView["clips"],
    revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function listDrafts(db: Database.Database, creationType?: string) {
  return (db.prepare("SELECT id FROM drafts WHERE (? IS NULL OR creation_type = ?) ORDER BY updated_at DESC, rowid DESC").all(creationType ?? null, creationType ?? null) as Array<{ id: string }>).map((row) => getDraft(db, row.id));
}

function defaults(db: Database.Database, input: Partial<DraftInput>) {
  const agent = input.agentId ? getAgent(db, input.agentId) : null;
  const workflow = input.workflowId ? getWorkflow(db, input.workflowId) : null;
  return {
    ...input,
    parameters: { ...workflow?.default_parameters, ...input.parameters },
    productId: input.productId ?? agent?.products[0]?.id ?? null,
    assetIds: Array.from(new Set([...(agent?.assets.map((item) => item.id) ?? []), ...(workflow?.assets.map((item) => item.id) ?? []), ...(input.assetIds ?? [])])),
    skillIds: Array.from(new Set([...(agent?.skills.map((item) => item.id) ?? []), ...(workflow?.skills.map((item) => item.id) ?? []), ...(input.skillIds ?? [])])),
  };
}

function validateReferences(db: Database.Database, input: Partial<DraftInput>) {
  buildSnapshot(db, { inputs: {}, parameters: {}, assetIds: input.assetIds, skillIds: input.skillIds, agentId: input.agentId });
  if (input.productId && !db.prepare("SELECT id FROM products WHERE id = ?").get(input.productId)) throw appError("PRODUCT_NOT_FOUND", "商品知识不存在。");
  if (input.workflowId) getWorkflow(db, input.workflowId);
  if (input.name !== undefined && !input.name.trim()) throw appError("VALIDATION_FAILED", "草稿名称不能为空。");
}

function setLinks(db: Database.Database, id: string, input: Partial<DraftInput>) {
  if (input.assetIds) {
    db.prepare("DELETE FROM draft_assets WHERE draft_id = ?").run(id);
    for (const assetId of new Set(input.assetIds)) db.prepare("INSERT INTO draft_assets (draft_id, asset_id) VALUES (?, ?)").run(id, assetId);
  }
  if (input.skillIds) {
    db.prepare("DELETE FROM draft_skills WHERE draft_id = ?").run(id);
    for (const skillId of new Set(input.skillIds)) db.prepare("INSERT INTO draft_skills (draft_id, skill_id) VALUES (?, ?)").run(id, skillId);
  }
}

export function createDraft(db: Database.Database, input: DraftInput): DraftView {
  const resolved = defaults(db, input);
  validateReferences(db, resolved);
  const id = newId();
  const time = nowIso();
  db.transaction(() => {
    db.prepare(`INSERT INTO drafts (id, creation_type, name, requirements, parameters, agent_id, workflow_id, product_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.creationType, input.name?.trim() ?? "未命名草稿", input.requirements ?? "", JSON.stringify(resolved.parameters),
      input.agentId ?? null, input.workflowId ?? null, resolved.productId, time, time,
    );
    setLinks(db, id, resolved);
    recordActivity(db, "draft", id, "新建创作草稿", { name: input.name ?? "未命名草稿", creationType: input.creationType });
  })();
  return getDraft(db, id);
}

export function updateDraft(db: Database.Database, id: string, revision: number, input: Partial<DraftInput>): DraftView {
  return db.transaction(() => {
    const current = getDraft(db, id);
    if (revision !== current.revision) throw appError("REVISION_CONFLICT", "草稿已被其他页面修改。当前输入已保留，请选择处理方式。", { currentRevision: current.revision });
    const merged = { ...current, ...input };
    validateReferences(db, merged);
    db.prepare(`UPDATE drafts SET name = ?, requirements = ?, parameters = ?, agent_id = ?, workflow_id = ?, product_id = ?,
      revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`).run(
      merged.name.trim(), merged.requirements, JSON.stringify(merged.parameters), merged.agentId, merged.workflowId,
      merged.productId, nowIso(), id, revision,
    );
    setLinks(db, id, input);
    return getDraft(db, id);
  })();
}

export function carryIntoDraft(db: Database.Database, id: string, revision: number, input: Partial<DraftInput>): DraftView {
  const current = getDraft(db, id);
  const incoming = defaults(db, input);
  return updateDraft(db, id, revision, {
    agentId: current.agentId ?? input.agentId ?? null,
    productId: current.productId ?? incoming.productId,
    workflowId: current.workflowId ?? input.workflowId ?? null,
    assetIds: Array.from(new Set([...current.assetIds, ...incoming.assetIds])),
    skillIds: Array.from(new Set([...current.skillIds, ...incoming.skillIds])),
    parameters: { ...incoming.parameters, ...current.parameters },
  });
}
