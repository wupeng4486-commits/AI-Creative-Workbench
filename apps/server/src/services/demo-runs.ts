import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppContext } from "../context.ts";
import { SEED_WORKFLOWS } from "../db/seed.ts";
import { appError } from "../http/errors.ts";
import { commitStagedFile, describeFile, getFile, guessMimeType, insertFile } from "../storage/files.ts";
import { newId } from "../util/id.ts";
import { nowIso, parseJson } from "../util/time.ts";
import { recordActivity } from "./events.ts";
import { buildSnapshot, hydrateRun, insertRun, keepRunFile, markUnfinishedRunsInterrupted, type RunRow, type RunSnapshot } from "./snapshots.ts";
import { getWorkflow } from "./workflows.ts";
import { getConnector } from "./connectors.ts";
import { getDraft, type DraftView } from "./drafts.ts";
import { findAsset } from "./assets.ts";

export const LIBTV_SAMPLES = SEED_WORKFLOWS.map((sample) => ({
  id: sample.id.replace("seed-workflow-", "libtv-"), name: sample.name, purpose: sample.purpose,
  libtvRef: sample.libtvRef, inputSpec: sample.input, defaultParameters: sample.parameters, steps: [...sample.steps],
}));

export interface DemoRunInput {
  owner: "workflow" | "connector" | "draft";
  ownerId: string;
  requirements: string;
  parameters?: Record<string, unknown>;
  assetIds?: string[];
  sampleInputs?: boolean;
  simulateFailure?: boolean;
  draftRevision?: number;
}

function validateProduction(ctx: AppContext, draft: DraftView) {
  const errors: Record<string, string> = {};
  if (!draft.requirements.trim()) errors.requirements = "请填写创作要求。";
  if (["ai_video", "ai_image"].includes(draft.creationType) && !draft.productId) errors.productId = "请选择商品知识。";
  const assetIds = draft.creationType === "video_join" ? draft.clips.map((clip) => clip.assetId) : draft.assetIds;
  const assets = assetIds.map((id) => ctx.db.prepare("SELECT f.mime_type, f.duration FROM assets a JOIN files f ON f.id = a.file_id WHERE a.id = ? AND f.state = 'ready'").get(id) as { mime_type: string; duration: number | null } | undefined);
  if (!assets.length || assets.some((asset) => !asset)) errors.assetIds = "请选择有效的参考素材。";
  if (draft.creationType === "ai_video") {
    if (typeof draft.parameters.duration !== "number" || draft.parameters.duration < 1 || draft.parameters.duration > 120) errors.duration = "目标时长需在 1 到 120 秒之间。";
    if (!["9:16", "16:9", "1:1"].includes(String(draft.parameters.ratio))) errors.ratio = "请选择画面比例。";
    if (typeof draft.parameters.shotRequirements !== "string" || !draft.parameters.shotRequirements.trim()) errors.shotRequirements = "请填写分镜要求。";
  } else if (draft.creationType === "ai_image") {
    if (!assets.some((asset) => asset?.mime_type.startsWith("image/"))) errors.assetIds = "请选择商品或参考图片。";
    for (const key of ["width", "height"] as const) {
      const value = draft.parameters[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 64 || value > 4096) errors[key] = "目标尺寸需为 64 到 4096 的整数。";
    }
    if (typeof draft.parameters.count !== "number" || !Number.isInteger(draft.parameters.count) || draft.parameters.count < 1 || draft.parameters.count > 8) errors.count = "候选数量需为 1 到 8 的整数。";
    if (!String(draft.parameters.composition ?? "").trim() && !String(draft.parameters.style ?? "").trim()) errors.style = "请填写构图或风格要求。";
  } else if (draft.creationType === "video_join") {
    if (draft.clips.length < 2 || assets.some((asset) => !asset?.mime_type.startsWith("video/") || !asset.duration)) errors.clips = "请添加至少两个可读取时长的视频片段。";
  } else {
    throw appError("VALIDATION_FAILED", "该创作类型的演示入口尚未开放。");
  }
  if (Object.keys(errors).length) throw appError("VALIDATION_FAILED", "请补充制作所需的输入。", { fieldErrors: errors });
}

interface RunItem { id: string; label: string; item_status: string; result: string; message: string }

export function getDemoRun(ctx: AppContext, id: string) {
  const row = ctx.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  if (!row) throw appError("RUN_NOT_FOUND", "演示记录不存在。");
  const run = hydrateRun(row);
  const items = ctx.db.prepare("SELECT id, label, item_status, result, message FROM run_items WHERE run_id = ? ORDER BY rowid").all(id) as RunItem[];
  return { ...run, items: items.map((item) => ({ id: item.id, label: item.label, status: item.item_status, result: parseJson(item.result, {}), message: item.message })) };
}

export function ensureDemoFile(ctx: AppContext, kind: "image" | "video") {
  const fixture = kind === "image" ? "测试产品图.png" : "测试视频A-4秒.mp4";
  const originalName = `示例结果-${fixture}`;
  const source = path.join(ctx.config.projectRoot, "fixtures", "demo", fixture);
  const bytes = fs.readFileSync(source);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const existing = ctx.db.prepare("SELECT id FROM files WHERE original_name = ? AND sha256 = ?").get(originalName, sha256) as { id: string } | undefined;
  if (existing) return getFile(ctx.db, existing.id)!;
  const staging = path.join(ctx.config.dataDir, "staging", "demo", newId());
  fs.mkdirSync(path.dirname(staging), { recursive: true });
  fs.writeFileSync(staging, bytes);
  return insertFile(ctx.db, commitStagedFile(ctx.dataset.dir, staging, originalName, guessMimeType(fixture), sha256));
}

export class DemoRunner {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private ctx: AppContext, private stepMs = 500) {
    markUnfinishedRunsInterrupted(ctx.db);
    ctx.db.prepare("UPDATE run_items SET item_status = 'interrupted', message = '应用退出时演示未完成。' WHERE item_status IN ('queued', 'running') AND run_id IN (SELECT id FROM runs WHERE status = 'interrupted')").run();
    ctx.db.prepare("UPDATE connectors SET simulation_status = CASE WHEN simulation_status = 'syncing' THEN 'connected' ELSE 'pending' END WHERE enabled = 1 AND simulation_status IN ('connecting', 'syncing')").run();
  }

  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  start(input: DemoRunInput) {
    const draft = input.owner === "draft" ? getDraft(this.ctx.db, input.ownerId) : null;
    if (draft) {
      if (input.draftRevision !== undefined && input.draftRevision !== draft.revision) throw appError("REVISION_CONFLICT", "草稿版本已变化，请先保存最新输入。", { currentRevision: draft.revision });
      validateProduction(this.ctx, draft);
      input = { ...input, requirements: draft.requirements, parameters: { ...draft.parameters, count: draft.creationType === "ai_image" ? draft.parameters.count : 1 }, assetIds: Array.from(new Set([...draft.assetIds, ...draft.clips.map((clip) => clip.assetId)])), sampleInputs: false };
    }
    if (!input.requirements?.trim()) throw appError("VALIDATION_FAILED", "请填写本次演示要求。", { fieldErrors: { requirements: "演示要求不能为空。" } });
    if (!input.sampleInputs && !input.assetIds?.length) throw appError("VALIDATION_FAILED", "请选择输入素材，或明确选择使用本地测试素材。", { fieldErrors: { assetIds: "缺少输入素材。" } });
    const connector = input.owner === "connector" ? getConnector(this.ctx.db, input.ownerId) : null;
    if (connector) {
      if (!["connect", "sync"].includes(String(input.parameters?.action))) throw appError("VALIDATION_FAILED", "请选择模拟连接或模拟同步。");
      if (!connector.enabled) throw appError("CONNECTOR_STATE", "连接器已停用，请先启用。");
      if (!connector.demo_config.label?.trim()) throw appError("VALIDATION_FAILED", "请先保存演示配置。");
      if (input.parameters?.action === "sync" && connector.simulation_status !== "connected") throw appError("CONNECTOR_STATE", "请先完成模拟连接，再模拟同步。");
      const active = this.ctx.db.prepare("SELECT id FROM runs WHERE owner = 'connector' AND owner_id = ? AND status IN ('queued', 'running')").get(input.ownerId);
      if (active) throw appError("CONNECTOR_STATE", "该连接器正在演示，请先等待或停止。");
    }
    const workflow = draft ? { name: draft.name, defaultParameters: {}, draft } : connector ? { name: connector.name, defaultParameters: {}, connector } : input.ownerId.startsWith("libtv-")
      ? LIBTV_SAMPLES.find((sample) => sample.id === input.ownerId)
      : getWorkflow(this.ctx.db, input.ownerId);
    if (!workflow) throw appError("WORKFLOW_NOT_FOUND", "LibTV 示例不存在。");
    const defaults = "defaultParameters" in workflow ? workflow.defaultParameters : workflow.default_parameters;
    const parameters = { ...defaults, ...input.parameters } as Record<string, unknown>;
    const count = Number(parameters.count ?? (parameters.batch ? 3 : 1));
    if (!Number.isInteger(count) || count < 1 || count > 10) throw appError("VALIDATION_FAILED", "批量数量需为 1 到 10 的整数。");
    parameters.count = count;
    if (parameters.duration !== undefined && (typeof parameters.duration !== "number" || parameters.duration <= 0 || parameters.duration > 120)) throw appError("VALIDATION_FAILED", "时长需在 1 到 120 秒之间。");
    if (parameters.ratio !== undefined && !["9:16", "16:9", "1:1"].includes(String(parameters.ratio))) throw appError("VALIDATION_FAILED", "请选择支持的画面比例。");
    const snapshot = buildSnapshot(this.ctx.db, {
      inputs: {
        ...input, workflow, draft, requirements: input.requirements.trim(),
        product: draft?.productId ? this.ctx.db.prepare("SELECT * FROM products WHERE id = ?").get(draft.productId) : null,
        teamWorkflow: draft?.workflowId ? getWorkflow(this.ctx.db, draft.workflowId) : null,
        orderedClips: draft?.clips.map((clip) => {
          const asset = findAsset(this.ctx.db, clip.assetId)!;
          return { ...clip, name: asset.name, fileId: asset.file_id, duration: asset.file?.duration };
        }) ?? [],
      },
      parameters, assetIds: input.assetIds, skillIds: draft?.skillIds, agentId: draft?.agentId,
    });
    return this.enqueue(input, snapshot, draft?.creationType ?? (connector ? "connector_demo" : "libtv_demo"), workflow.name);
  }

  private enqueue(input: DemoRunInput, snapshot: RunSnapshot, kind: string, name: string, sourceRunId?: string) {
    const parameters = snapshot.parameters;
    const count = Number(parameters.count ?? 1);
    const connector = input.owner === "connector";
    const active = this.ctx.db.prepare("SELECT COUNT(*) AS count FROM runs WHERE status IN ('queued', 'running')").get() as { count: number };
    if (active.count >= 4) throw appError("RUN_LIMIT", "同时最多进行 4 次演示，请等待或停止已有演示。");
    const row = this.ctx.db.transaction(() => {
      const run = insertRun(this.ctx.db, { owner: input.owner, ownerId: input.ownerId, kind, snapshot });
      if (connector) this.ctx.db.prepare("UPDATE connectors SET simulation_status = ? WHERE id = ?").run(parameters.action === "sync" ? "syncing" : "connecting", input.ownerId);
      this.ctx.db.prepare("UPDATE runs SET result = ? WHERE id = ?").run(JSON.stringify({ logs: ["已排队（本地演示）"] }), run.id);
      for (let index = 0; index < count; index += 1) {
        this.ctx.db.prepare("INSERT INTO run_items (id, run_id, label) VALUES (?, ?, ?)").run(newId(), run.id, `示例条目 ${index + 1}`);
      }
      for (const assetId of sourceRunId ? [] : input.assetIds ?? []) {
        const asset = this.ctx.db.prepare("SELECT file_id FROM assets WHERE id = ?").get(assetId) as { file_id: string | null };
        if (asset.file_id) keepRunFile(this.ctx.db, run.id, asset.file_id, "input");
      }
      if (sourceRunId) {
        const files = this.ctx.db.prepare("SELECT file_id FROM run_files WHERE run_id = ? AND role = 'input'").all(sourceRunId) as Array<{ file_id: string }>;
        for (const file of files) keepRunFile(this.ctx.db, run.id, file.file_id, "input");
      }
      recordActivity(this.ctx.db, "run", run.id, connector ? "启动连接器本地演示" : "启动本地制作演示", { name }, true);
      return run;
    })();
    this.schedule(row.id, this.ctx.datasetId);
    return getDemoRun(this.ctx, row.id);
  }

  stop(id: string) {
    const result = this.ctx.db.transaction(() => {
      const changed = this.ctx.db.prepare("UPDATE runs SET status = 'stopped', message = '已停止（本地演示）', finished_at = ? WHERE id = ? AND status IN ('queued', 'running')").run(nowIso(), id);
      if (!changed.changes) {
        getDemoRun(this.ctx, id);
        throw appError("RUN_STATE", "演示已经结束，无法停止。");
      }
      this.ctx.db.prepare("UPDATE run_items SET item_status = 'stopped' WHERE run_id = ? AND item_status IN ('queued', 'running')").run(id);
      const run = getDemoRun(this.ctx, id);
      if (run.owner === "connector") this.ctx.db.prepare("UPDATE connectors SET simulation_status = ? WHERE id = ? AND enabled = 1").run(run.parameters.action === "sync" ? "connected" : "pending", run.ownerId);
      recordActivity(this.ctx.db, "run", id, "停止本地演示", { name: "已停止" }, true);
      return getDemoRun(this.ctx, id);
    })();
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    return result;
  }

  retry(id: string) {
    const run = getDemoRun(this.ctx, id);
    if (!["failed", "stopped", "interrupted"].includes(run.status)) throw appError("RUN_STATE", "仅失败、停止或中断的演示可以重试。");
    const snapshot = structuredClone(run.inputSnapshot) as unknown as RunSnapshot & { inputs: DemoRunInput };
    if (!snapshot.inputs || !snapshot.parameters) throw appError("RUN_STATE", "该历史记录缺少可重试输入，请从当前草稿再次演示。");
    if (run.owner === "draft") {
      snapshot.inputs.simulateFailure = false;
      return this.enqueue(snapshot.inputs, snapshot, run.kind, snapshot.inputs.requirements, id);
    }
    return this.start({ ...snapshot.inputs, parameters: run.parameters, simulateFailure: false });
  }

  private schedule(id: string, datasetId: string) {
    this.timers.set(id, setTimeout(() => this.tick(id, datasetId), this.stepMs));
  }

  private tick(id: string, datasetId: string) {
    this.timers.delete(id);
    if (this.ctx.datasetId !== datasetId || !this.ctx.db.open) return;
    if (this.ctx.barrier.locked) { this.schedule(id, datasetId); return; }
    const row = this.ctx.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    if (!row || !["queued", "running"].includes(row.status)) return;
    try {
      const progress = Math.min(row.progress + 25, 100);
      const previous = parseJson<{ logs: string[] }>(row.result, { logs: [] });
      const logs = [...(previous.logs ?? []), `本地演示进度 ${progress}%`];
      if (progress < 100) {
        this.ctx.db.prepare("UPDATE runs SET status = 'running', progress = ?, message = '正在本地演示（未调用外部服务）', result = ? WHERE id = ? AND status IN ('queued', 'running')").run(progress, JSON.stringify({ logs }), id);
        this.ctx.db.prepare("UPDATE run_items SET item_status = 'running' WHERE run_id = ? AND item_status = 'queued'").run(id);
        this.schedule(id, datasetId);
        return;
      }
      const snapshot = parseJson<RunSnapshot>(row.input_snapshot, { inputs: {}, parameters: {}, resources: [] });
      this.ctx.db.transaction(() => {
        const parameters = parseJson<{ action?: string }>(row.parameters, {});
        const connecting = row.owner === "connector" && parameters.action === "connect";
        const image = row.kind === "ai_image" || row.owner === "connector" || Boolean(row.owner_id?.includes("repack"));
        const file = connecting ? null : ensureDemoFile(this.ctx, image ? "image" : "video");
        const description = file ? describeFile(file) : null;
        const items = this.ctx.db.prepare("SELECT id FROM run_items WHERE run_id = ? ORDER BY rowid").all(id) as Array<{ id: string }>;
        items.forEach((item, index) => {
          const failed = Boolean(snapshot.inputs.simulateFailure) && index === 0;
          const result = failed || !file || !description ? {} : { fileId: file.id, contentUrl: description.contentUrl, downloadUrl: description.downloadUrl, previewKind: description.previewKind, demo: true };
          this.ctx.db.prepare("UPDATE run_items SET item_status = ?, result = ?, message = ? WHERE id = ?").run(failed ? "failed" : "completed", JSON.stringify(result), failed ? "测试注入的演示失败，可重试。" : "本地示例结果，未调用真实外部服务。", item.id);
        });
        if (file) keepRunFile(this.ctx.db, id, file.id, "output");
        const failed = Boolean(snapshot.inputs.simulateFailure);
        if (row.owner === "connector") this.ctx.db.prepare("UPDATE connectors SET simulation_status = ?, last_simulated_at = ? WHERE id = ? AND enabled = 1").run(connecting && failed ? "failed" : "connected", nowIso(), row.owner_id);
        const message = connecting ? (failed ? "模拟连接失败，可重试。" : "模拟连接成功，未调用真实服务。") : (failed ? "部分条目演示失败，可重试。" : "本地演示完成，结果为测试素材。");
        const shots = row.kind === "ai_video" ? [
          { title: "商品开场（示例）", description: String((parseJson<Record<string, unknown>>(row.parameters, {})).shotRequirements ?? ""), order: 1 },
          { title: "使用场景（示例）", description: String(snapshot.inputs.requirements), order: 2 },
          { title: "卖点与收束（示例）", description: "核对商品信息与交付要求。", order: 3 },
        ] : [];
        const joinPlan = row.kind === "video_join" ? { clips: snapshot.inputs.orderedClips, totalDuration: (snapshot.inputs.draft as DraftView).totalDuration } : undefined;
        this.ctx.db.prepare("UPDATE runs SET status = ?, progress = 100, result = ?, message = ?, finished_at = ? WHERE id = ? AND status IN ('queued', 'running')").run(failed ? "failed" : "completed", JSON.stringify({ logs, demo: true, shots, joinPlan }), message, nowIso(), id);
        recordActivity(this.ctx.db, "run", id, failed ? "本地演示失败" : "本地演示完成", { name: row.owner_id }, true);
      })();
    } catch (error) {
      this.ctx.db.prepare("UPDATE runs SET status = 'failed', message = ?, finished_at = ? WHERE id = ? AND status IN ('queued', 'running')").run(`演示失败，请重试。${error instanceof Error ? error.message : ""}`, nowIso(), id);
      this.ctx.db.prepare("UPDATE run_items SET item_status = 'failed', message = '演示失败，请重试。' WHERE run_id = ? AND item_status IN ('queued', 'running')").run(id);
      if (row.owner === "connector") {
        const parameters = parseJson<{ action?: string }>(row.parameters, {});
        this.ctx.db.prepare("UPDATE connectors SET simulation_status = ?, last_simulated_at = ? WHERE id = ? AND enabled = 1").run(parameters.action === "sync" ? "connected" : "failed", nowIso(), row.owner_id);
      }
    }
  }
}
