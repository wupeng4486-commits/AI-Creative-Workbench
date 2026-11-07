import type Database from "better-sqlite3";
import { newId } from "../util/id.ts";
import { nowIso, parseJson } from "../util/time.ts";

export interface RunSnapshot {
  inputs: Record<string, unknown>;
  parameters: Record<string, unknown>;
  resources: Array<{ id: string; name: string; kind: string }>;
}

/**
 * Freezes the current version of referenced resources. Later edits to the
 * asset/skill/agent never change what a historical run recorded.
 */
export function buildSnapshot(
  db: Database.Database,
  input: {
    inputs: Record<string, unknown>;
    parameters: Record<string, unknown>;
    assetIds?: string[];
    skillIds?: string[];
    agentId?: string | null;
  },
): RunSnapshot {
  const resources: RunSnapshot["resources"] = [];
  for (const id of input.assetIds ?? []) {
    const row = db.prepare("SELECT id, name FROM assets WHERE id = ?").get(id) as
      | { id: string; name: string }
      | undefined;
    if (!row) {
      const error = new Error("引用的资产不存在。") as Error & { code: string };
      error.code = "ASSET_NOT_FOUND";
      throw error;
    }
    resources.push({ ...row, kind: "asset" });
  }
  for (const id of input.skillIds ?? []) {
    const row = db.prepare("SELECT id, name FROM skills WHERE id = ?").get(id) as
      | { id: string; name: string }
      | undefined;
    if (!row) {
      const error = new Error("引用的技能不存在。") as Error & { code: string };
      error.code = "SKILL_NOT_FOUND";
      throw error;
    }
    resources.push({ ...row, kind: "skill" });
  }
  if (input.agentId) {
    const row = db
      .prepare("SELECT id, name FROM agents WHERE id = ?")
      .get(input.agentId) as { id: string; name: string } | undefined;
    if (!row) {
      const error = new Error("引用的智能体不存在。") as Error & { code: string };
      error.code = "AGENT_NOT_FOUND";
      throw error;
    }
    resources.push({ ...row, kind: "agent" });
  }
  return { inputs: input.inputs, parameters: input.parameters, resources };
}

export interface RunRow {
  id: string;
  owner: string;
  owner_id: string | null;
  kind: string;
  status: string;
  input_snapshot: string;
  parameters: string;
  demo: number;
  result: string;
  message: string;
  progress: number;
  started_at: string;
  finished_at: string | null;
}

export function insertRun(
  db: Database.Database,
  input: {
    owner: string;
    ownerId?: string | null;
    kind: string;
    status?: RunRow["status"];
    snapshot: RunSnapshot;
    demo?: boolean;
  },
): RunRow {
  const row: RunRow = {
    id: newId(),
    owner: input.owner,
    owner_id: input.ownerId ?? null,
    kind: input.kind,
    status: input.status ?? "queued",
    input_snapshot: JSON.stringify(input.snapshot),
    parameters: JSON.stringify(input.snapshot.parameters),
    demo: input.demo === false ? 0 : 1,
    result: "{}",
    message: "",
    progress: 0,
    started_at: nowIso(),
    finished_at: null,
  };
  db.prepare(
    `INSERT INTO runs (id, owner, owner_id, kind, status, input_snapshot, parameters, demo, result, message, progress, started_at, finished_at)
     VALUES (@id, @owner, @owner_id, @kind, @status, @input_snapshot, @parameters, @demo, @result, @message, @progress, @started_at, @finished_at)`,
  ).run(row);
  return row;
}

export function keepRunFile(db: Database.Database, runId: string, fileId: string, role: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO run_files (run_id, file_id, role) VALUES (?, ?, ?)",
  ).run(runId, fileId, role);
}

export function hydrateRun(row: RunRow) {
  return {
    id: row.id,
    owner: row.owner,
    ownerId: row.owner_id,
    kind: row.kind,
    status: row.status,
    inputSnapshot: parseJson(row.input_snapshot, {}),
    parameters: parseJson(row.parameters, {}),
    demo: Boolean(row.demo),
    result: parseJson(row.result, {}),
    message: row.message,
    progress: row.progress,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function markUnfinishedRunsInterrupted(db: Database.Database): number {
  const result = db
    .prepare(
      `UPDATE runs SET status = 'interrupted', message = '应用关闭时未完成，已标记为中断（模拟）。', finished_at = ?
       WHERE status IN ('queued', 'running')`,
    )
    .run(nowIso());
  return result.changes;
}
