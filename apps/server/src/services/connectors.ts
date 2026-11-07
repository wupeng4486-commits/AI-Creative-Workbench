import type Database from "better-sqlite3";
import type { AppContext } from "../context.ts";
import { appError } from "../http/errors.ts";
import { newId } from "../util/id.ts";
import { nowIso, parseJson } from "../util/time.ts";
import { createAsset, findAsset } from "./assets.ts";
import { recordActivity } from "./events.ts";
import { withIdempotency } from "./idempotency.ts";
import { getIntegrations, setSetting, SETTING_KEYS, validateWebUrl } from "./settings.ts";

export interface ConnectorInput {
  name: string;
  serviceType: "shopify" | "gmail" | "github" | "creation_tool";
  enabled?: boolean;
  config?: { label: string; endpoint: string; note: string };
}
export interface ConnectorView {
  id: string;
  name: string;
  service_type: ConnectorInput["serviceType"];
  enabled: boolean;
  demo_config: NonNullable<ConnectorInput["config"]>;
  simulation_status: string;
  last_simulated_at: string | null;
}

export function getConnector(db: Database.Database, id: string): ConnectorView {
  const row = db.prepare("SELECT * FROM connectors WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw appError("CONNECTOR_NOT_FOUND", "连接器不存在。");
  const config = { label: "", endpoint: "", note: "", ...parseJson<Partial<NonNullable<ConnectorInput["config"]>>>(String(row.demo_config), {}) };
  if (id === "seed-connector-libtv") config.endpoint = getIntegrations(db).libtv.url;
  return { ...(row as unknown as ConnectorView), enabled: Boolean(row.enabled), demo_config: config };
}

export function createConnector(db: Database.Database, input: ConnectorInput) {
  validateConnectorInput(input);
  const id = newId();
  const time = nowIso();
  db.transaction(() => {
    db.prepare("INSERT INTO connectors (id, service_type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, input.serviceType, input.name.trim(), time, time);
    if (input.config || input.enabled !== undefined) updateConnector(db, id, input);
    recordActivity(db, "connector", id, "新建演示连接器", { name: input.name.trim() }, true);
  })();
  return getConnector(db, id);
}

export function validateConnectorInput(input: Partial<ConnectorInput>) {
  if (input.name !== undefined && !input.name.trim()) throw appError("VALIDATION_FAILED", "连接名称不能为空。");
  const invalidUrl = input.config ? validateWebUrl(input.config.endpoint) : null;
  if (invalidUrl) throw appError("VALIDATION_FAILED", invalidUrl);
}

export function updateConnector(db: Database.Database, id: string, input: Partial<ConnectorInput>) {
  validateConnectorInput(input);
  const current = getConnector(db, id);
  const config = input.config ?? current.demo_config;
  const enabled = input.enabled ?? current.enabled;
  const status = enabled ? (input.config ? (config.label.trim() ? "pending" : "unconfigured") : current.simulation_status === "disabled" ? (config.label.trim() ? "pending" : "unconfigured") : current.simulation_status) : "disabled";
  db.transaction(() => {
    db.prepare("UPDATE connectors SET name = ?, demo_config = ?, enabled = ?, simulation_status = ?, updated_at = ? WHERE id = ?")
      .run(input.name?.trim() ?? current.name, JSON.stringify(config), enabled ? 1 : 0, status, nowIso(), id);
    if (id === "seed-connector-libtv" && input.config) setSetting(db, SETTING_KEYS.libtv, { url: config.endpoint, note: config.note });
    recordActivity(db, "connector", id, "更新连接器演示配置", { name: input.name ?? current.name }, true);
  })();
  return getConnector(db, id);
}

export function importConnectorBatch(ctx: AppContext, connectorId: string, runId: string) {
  const connector = getConnector(ctx.db, connectorId);
  const run = ctx.db.prepare("SELECT owner, owner_id, status, parameters FROM runs WHERE id = ?").get(runId) as { owner: string; owner_id: string; status: string; parameters: string } | undefined;
  if (!run || run.owner !== "connector" || run.owner_id !== connectorId) throw appError("RUN_NOT_FOUND", "连接器同步记录不存在。");
  if (!["completed", "failed"].includes(run.status) || parseJson<{ action?: string }>(run.parameters, {}).action !== "sync") throw appError("RUN_STATE", "请先完成一次模拟同步，再导入其成功条目。");
  const items = ctx.db.prepare("SELECT id, label, result FROM run_items WHERE run_id = ? AND item_status = 'completed' ORDER BY rowid").all(runId) as Array<{ id: string; label: string; result: string }>;
  if (!items.length) throw appError("RUN_STATE", "本次同步没有可导入的成功条目。");
  return ctx.db.transaction(() => {
    ctx.db.prepare("INSERT OR IGNORE INTO import_batches (id, source, batch_key, created_at) VALUES (?, ?, ?, ?)").run(newId(), connectorId, runId, nowIso());
    const imported = items.map((item) => {
      const output = parseJson<{ fileId?: string }>(item.result, {});
      if (!output.fileId) throw appError("FILE_NOT_FOUND", "示例原文件不存在。");
      const result = withIdempotency(ctx.db, `connector-import:${runId}`, item.id, () => createAsset(ctx.db, {
        name: `示例 · ${connector.name} · ${item.label}`, fileId: output.fileId, provenance: "demo_result",
        tags: ["连接器示例", connector.service_type], notes: `本地模拟同步样例。来源连接器 ${connectorId}，批次 ${runId}，条目 ${item.id}。`,
      }));
      return { id: result.resource.id, asset: findAsset(ctx.db, result.resource.id) ?? null, replayed: result.replayed };
    });
    return { items: imported, importedCount: imported.filter((item) => !item.replayed).length, replayedCount: imported.filter((item) => item.replayed).length };
  })();
}
