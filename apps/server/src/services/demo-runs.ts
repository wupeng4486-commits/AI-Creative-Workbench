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
import { buildSnapshot, hydrateRun, insertRun, keepRunFile, markUnfinishedRunsInterrupted, type RunRow } from "./snapshots.ts";
import { getWorkflow } from "./workflows.ts";

export const LIBTV_SAMPLES = SEED_WORKFLOWS.map((sample) => ({
  id: sample.id.replace("seed-workflow-", "libtv-"), name: sample.name, purpose: sample.purpose,
  libtvRef: sample.libtvRef, inputSpec: sample.input, defaultParameters: sample.parameters, steps: [...sample.steps],
}));

export interface DemoRunInput {
  owner: "workflow";
  ownerId: string;
  requirements: string;
  parameters?: Record<string, unknown>;
  assetIds?: string[];
  sampleInputs?: boolean;
  simulateFailure?: boolean;
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
  }

  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  start(input: DemoRunInput) {
    if (!input.requirements?.trim()) throw appError("VALIDATION_FAILED", "请填写本次演示要求。", { fieldErrors: { requirements: "演示要求不能为空。" } });
    if (!input.sampleInputs && !input.assetIds?.length) throw appError("VALIDATION_FAILED", "请选择输入素材，或明确选择使用本地测试素材。", { fieldErrors: { assetIds: "缺少输入素材。" } });
    const workflow = input.ownerId.startsWith("libtv-")
      ? LIBTV_SAMPLES.find((sample) => sample.id === input.ownerId)
      : getWorkflow(this.ctx.db, input.ownerId);
    if (!workflow) throw appError("WORKFLOW_NOT_FOUND", "LibTV 示例不存在。");
    const defaults = "defaultParameters" in workflow ? workflow.defaultParameters : workflow.default_parameters;
    const parameters = { ...defaults, ...input.parameters } as Record<string, unknown>;
    const count = Number(parameters.count ?? (parameters.batch ? 3 : 1));
    if (!Number.isInteger(count) || count < 1 || count > 10) throw appError("VALIDATION_FAILED", "批量数量需为 1 到 10 的整数。");
    if (parameters.duration !== undefined && (typeof parameters.duration !== "number" || parameters.duration <= 0 || parameters.duration > 120)) throw appError("VALIDATION_FAILED", "时长需在 1 到 120 秒之间。");
    if (parameters.ratio !== undefined && !["9:16", "16:9", "1:1"].includes(String(parameters.ratio))) throw appError("VALIDATION_FAILED", "请选择支持的画面比例。");
    const active = this.ctx.db.prepare("SELECT COUNT(*) AS count FROM runs WHERE status IN ('queued', 'running')").get() as { count: number };
    if (active.count >= 4) throw appError("RUN_LIMIT", "同时最多进行 4 次演示，请等待或停止已有演示。");
    const snapshot = buildSnapshot(this.ctx.db, {
      inputs: { ...input, workflow, requirements: input.requirements.trim() }, parameters, assetIds: input.assetIds,
    });
    const row = this.ctx.db.transaction(() => {
      const run = insertRun(this.ctx.db, { owner: input.owner, ownerId: input.ownerId, kind: "libtv_demo", snapshot });
      this.ctx.db.prepare("UPDATE runs SET result = ? WHERE id = ?").run(JSON.stringify({ logs: ["已排队（本地演示）"] }), run.id);
      for (let index = 0; index < count; index += 1) {
        this.ctx.db.prepare("INSERT INTO run_items (id, run_id, label) VALUES (?, ?, ?)").run(newId(), run.id, `示例条目 ${index + 1}`);
      }
      for (const assetId of input.assetIds ?? []) {
        const asset = this.ctx.db.prepare("SELECT file_id FROM assets WHERE id = ?").get(assetId) as { file_id: string | null };
        if (asset.file_id) keepRunFile(this.ctx.db, run.id, asset.file_id, "input");
      }
      recordActivity(this.ctx.db, "run", run.id, "启动 LibTV 本地演示", { name: workflow.name }, true);
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
    const snapshot = run.inputSnapshot as { inputs: DemoRunInput };
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
        this.ctx.db.prepare("UPDATE runs SET status = 'running', progress = ?, message = '正在演示（未接入 LibTV）', result = ? WHERE id = ? AND status IN ('queued', 'running')").run(progress, JSON.stringify({ logs }), id);
        this.ctx.db.prepare("UPDATE run_items SET item_status = 'running' WHERE run_id = ? AND item_status = 'queued'").run(id);
        this.schedule(id, datasetId);
        return;
      }
      const snapshot = parseJson<{ inputs: DemoRunInput }>(row.input_snapshot, { inputs: {} as DemoRunInput });
      this.ctx.db.transaction(() => {
        const image = row.owner_id?.includes("repack") ?? false;
        const file = ensureDemoFile(this.ctx, image ? "image" : "video");
        const description = describeFile(file);
        const items = this.ctx.db.prepare("SELECT id FROM run_items WHERE run_id = ? ORDER BY rowid").all(id) as Array<{ id: string }>;
        items.forEach((item, index) => {
          const failed = Boolean(snapshot.inputs.simulateFailure) && index === 0;
          const result = failed ? {} : { fileId: file.id, contentUrl: description.contentUrl, downloadUrl: description.downloadUrl, previewKind: description.previewKind, demo: true };
          this.ctx.db.prepare("UPDATE run_items SET item_status = ?, result = ?, message = ? WHERE id = ?").run(failed ? "failed" : "completed", JSON.stringify(result), failed ? "测试注入的演示失败，可重试。" : "示例结果，未调用真实 LibTV。", item.id);
        });
        keepRunFile(this.ctx.db, id, file.id, "output");
        const failed = Boolean(snapshot.inputs.simulateFailure);
        this.ctx.db.prepare("UPDATE runs SET status = ?, progress = 100, result = ?, message = ?, finished_at = ? WHERE id = ? AND status IN ('queued', 'running')").run(failed ? "failed" : "completed", JSON.stringify({ logs, demo: true }), failed ? "部分条目演示失败，可重试。" : "本地演示完成，结果为测试素材。", nowIso(), id);
        recordActivity(this.ctx.db, "run", id, failed ? "本地演示失败" : "本地演示完成", { name: row.owner_id }, true);
      })();
    } catch (error) {
      this.ctx.db.prepare("UPDATE runs SET status = 'failed', message = ?, finished_at = ? WHERE id = ? AND status IN ('queued', 'running')").run(`演示失败，请重试。${error instanceof Error ? error.message : ""}`, nowIso(), id);
      this.ctx.db.prepare("UPDATE run_items SET item_status = 'failed', message = '演示失败，请重试。' WHERE run_id = ? AND item_status IN ('queued', 'running')").run(id);
    }
  }
}
