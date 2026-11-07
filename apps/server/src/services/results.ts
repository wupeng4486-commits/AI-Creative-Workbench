import fs from "node:fs";
import type { ResultSourceSnapshot } from "@workbench/shared";
import type { AppContext } from "../context.ts";
import { appError } from "../http/errors.ts";
import { absoluteFilePath, describeFile, getFile } from "../storage/files.ts";
import { newId } from "../util/id.ts";
import { nowIso } from "../util/time.ts";
import { createAsset, findAsset } from "./assets.ts";
import { getDemoRun } from "./demo-runs.ts";
import { getDraft } from "./drafts.ts";
import { recordActivity } from "./events.ts";
import { withIdempotency } from "./idempotency.ts";
import { buildSnapshot, insertRun, keepRunFile } from "./snapshots.ts";
import { createWorkflow, getWorkflow } from "./workflows.ts";

export interface ArchiveInput { runId: string; resultItemId: string; name?: string; tags?: string[]; catalog?: string }

function resultFile(ctx: AppContext, fileId: string) {
  const file = getFile(ctx.db, fileId);
  if (!file || file.state !== "ready") throw appError("FILE_NOT_FOUND", "成果原文件不存在。");
  const target = absoluteFilePath(ctx.dataset.dir, file.relative_path);
  if (!fs.existsSync(target) || fs.statSync(target).size !== file.size) throw appError("FILE_NOT_FOUND", "成果原文件不完整，请检查或重新导入。");
  return file;
}

function sourceSnapshot(run: ReturnType<typeof getDemoRun>, resultItemId: string | null, output: Record<string, unknown>): ResultSourceSnapshot {
  return {
    runId: run.id, resultItemId, owner: run.owner, ownerId: run.ownerId, kind: run.kind, demo: run.demo,
    inputSnapshot: run.inputSnapshot, parameters: run.parameters, output, createdAt: run.startedAt,
  };
}

export function archiveResult(ctx: AppContext, input: ArchiveInput) {
  const run = getDemoRun(ctx, input.runId);
  const item = run.items.find((result) => result.id === input.resultItemId);
  const output = item?.result as { fileId?: string } | undefined;
  if (!["completed", "failed"].includes(run.status) || item?.status !== "completed" || !output?.fileId) throw appError("RESULT_STATE", "只能归档已经完成且包含原文件的成果条目。");
  if (input.name !== undefined && !input.name.trim()) throw appError("VALIDATION_FAILED", "成果名称不能为空。");
  const file = resultFile(ctx, output.fileId);
  return ctx.db.transaction(() => {
    const existing = ctx.db.prepare("SELECT asset_id FROM archives WHERE run_id = ? AND result_item_id = ?").get(run.id, item.id) as { asset_id: string } | undefined;
    const result = withIdempotency(ctx.db, "result-archive", `${run.id}:${item.id}`, () => {
      if (existing) return { id: existing.asset_id };
      const asset = createAsset(ctx.db, {
        name: input.name?.trim() ?? item.label, fileId: file.id, catalog: input.catalog ?? "result",
        tags: input.tags ?? [], provenance: run.demo ? "demo_result" : "user_import",
        sourceSnapshot: sourceSnapshot(run, item.id, { fileId: file.id, originalName: file.original_name, mimeType: file.mime_type, size: file.size, sha256: file.sha256 }),
        notes: run.demo ? "本地制作演示成果。" : "手动导入的真实交付文件。",
      });
      ctx.db.prepare("INSERT INTO archives (id, run_id, result_item_id, asset_id, created_at) VALUES (?, ?, ?, ?, ?)").run(newId(), run.id, item.id, asset.id, nowIso());
      recordActivity(ctx.db, "asset", asset.id, "归档创作成果", { name: asset.name, runId: run.id }, run.demo);
      return asset;
    });
    const asset = findAsset(ctx.db, result.resource.id);
    if (!asset) throw appError("RESULT_REMOVED", "该成果已归档并从资产库删除，可在制作历史中查看原文件。");
    return { asset, replayed: result.replayed || Boolean(existing) };
  })();
}

export function workflowFromResult(ctx: AppContext, runId: string, name?: string) {
  const run = getDemoRun(ctx, runId);
  if (!run.items.some((item) => item.status === "completed") || !["completed", "failed"].includes(run.status)) throw appError("RESULT_STATE", "请先完成制作，再另存为团队工作流。");
  if (name !== undefined && !name.trim()) throw appError("VALIDATION_FAILED", "工作流名称不能为空。");
  const inputs = run.inputSnapshot.inputs as Record<string, unknown>;
  const draft = inputs.draft as { name?: string; requirements?: string } | undefined;
  const source = (inputs.teamWorkflow ?? inputs.workflow) as { name?: string; libtv_ref?: string; libtvRef?: string; steps?: string[]; assets?: Array<{ id: string }>; cover_file_id?: string } | undefined;
  return ctx.db.transaction(() => {
    const result = withIdempotency(ctx.db, "workflow-from-run", run.id, () => createWorkflow(ctx.db, {
      name: name?.trim() ?? `${draft?.name ?? source?.name ?? "创作成果"}（流程）`,
      purpose: String(inputs.requirements ?? draft?.requirements ?? "复用已保存的创作输入"),
      libtvRef: source?.libtv_ref ?? source?.libtvRef ?? "", inputSpec: draft?.requirements ?? String(inputs.requirements ?? ""),
      defaultParameters: run.parameters,
      steps: source?.steps ?? ["选择商品与输入素材", "核对本次参数", "执行本地演示或登记交付", "预览并归档成果"],
      assetIds: source?.assets?.filter((asset) => findAsset(ctx.db, asset.id)).map((asset) => asset.id) ?? [],
      coverFileId: source?.cover_file_id && getFile(ctx.db, source.cover_file_id) ? source.cover_file_id : null,
      sourceSnapshot: sourceSnapshot(run, null, {}),
    }));
    const exists = ctx.db.prepare("SELECT id FROM team_workflows WHERE id = ?").get(result.resource.id);
    if (!exists) throw appError("RESULT_REMOVED", "该制作记录另存的工作流已删除，可查看原制作历史。");
    return { workflow: getWorkflow(ctx.db, result.resource.id), replayed: result.replayed };
  })();
}

export function importExternalVideo(ctx: AppContext, input: { draftId: string; revision: number; fileId: string; name?: string; tags?: string[] }) {
  const file = resultFile(ctx, input.fileId);
  if (!file.mime_type.startsWith("video/") || !file.duration) throw appError("VALIDATION_FAILED", "请导入可读取时长的外部成片视频。");
  return ctx.db.transaction(() => {
    const result = withIdempotency(ctx.db, `external-video:${input.draftId}`, file.sha256, () => {
      const draft = getDraft(ctx.db, input.draftId);
      if (draft.revision !== input.revision) throw appError("REVISION_CONFLICT", "草稿已变化，请先保存最新输入。", { currentRevision: draft.revision });
      const snapshot = buildSnapshot(ctx.db, {
        inputs: { draft, requirements: draft.requirements, external: { source: "外部工具手动导入", originalName: file.original_name, sha256: file.sha256 }, product: draft.productId ? ctx.db.prepare("SELECT * FROM products WHERE id = ?").get(draft.productId) : null },
        parameters: draft.parameters, assetIds: Array.from(new Set([...draft.assetIds, ...draft.clips.map((clip) => clip.assetId)])), skillIds: draft.skillIds, agentId: draft.agentId,
      });
      const run = insertRun(ctx.db, { owner: "draft", ownerId: draft.id, kind: "external_video", status: "completed", snapshot, demo: false });
      const itemId = newId();
      const description = describeFile(file);
      ctx.db.prepare("INSERT INTO run_items (id, run_id, label, item_status, result, message) VALUES (?, ?, ?, 'completed', ?, '外部工具手动导入的成片。')").run(
        itemId, run.id, input.name?.trim() || file.original_name, JSON.stringify({ fileId: file.id, contentUrl: description.contentUrl, downloadUrl: description.downloadUrl, previewKind: description.previewKind, demo: false }),
      );
      ctx.db.prepare("UPDATE runs SET progress = 100, message = '外部成片已手动导入。', finished_at = ?, result = ? WHERE id = ?").run(nowIso(), JSON.stringify({ logs: ["用户手动导入外部成片"] }), run.id);
      keepRunFile(ctx.db, run.id, file.id, "output");
      return archiveResult(ctx, { runId: run.id, resultItemId: itemId, name: input.name, tags: input.tags }).asset;
    });
    const asset = findAsset(ctx.db, result.resource.id);
    if (!asset) throw appError("RESULT_REMOVED", "该外部成片已导入并从资产库删除，可查看其制作历史。");
    return { asset, replayed: result.replayed };
  })();
}
