import fs from "node:fs";
import type { AppContext } from "../context.ts";
import { appError } from "../http/errors.ts";
import { absoluteFilePath, describeFile, getFile } from "../storage/files.ts";
import { newId } from "../util/id.ts";
import { nowIso } from "../util/time.ts";
import { findAsset } from "./assets.ts";
import { getDraft } from "./drafts.ts";
import { recordActivity } from "./events.ts";
import { buildSnapshot, insertRun, keepRunFile } from "./snapshots.ts";
import { getWorkflow } from "./workflows.ts";

export function createDesignDelivery(ctx: AppContext, draftId: string, revision: number) {
  return ctx.db.transaction(() => {
    const draft = getDraft(ctx.db, draftId);
    if (draft.creationType !== "design") throw appError("VALIDATION_FAILED", "请在美工设计草稿中登记交付。");
    if (draft.revision !== revision) throw appError("REVISION_CONFLICT", "草稿已变化，请先保存。", { currentRevision: draft.revision });
    const parameters = draft.parameters;
    const errors: Record<string, string> = {};
    if (!draft.requirements.trim()) errors.requirements = "请填写设计要求。";
    if (!String(parameters.designType ?? "").trim()) errors.designType = "请选择设计类型。";
    if (!String(parameters.size ?? "").trim()) errors.size = "请填写设计尺寸。";
    if (!String(parameters.copy ?? "").trim() && !String(parameters.deliveryRequirements ?? "").trim()) errors.deliveryRequirements = "请填写文案或交付要求。";
    if (!String(parameters.deliveryNote ?? "").trim()) errors.deliveryNote = "请填写本次版本说明。";
    const previewId = typeof parameters.previewAssetId === "string" ? parameters.previewAssetId : "";
    const sourceIds = Array.isArray(parameters.sourceAssetIds) ? parameters.sourceAssetIds.filter((id): id is string => typeof id === "string") : [];
    const preview = previewId ? findAsset(ctx.db, previewId) : null;
    if (!preview?.file || !["image", "pdf"].includes(preview.previewKind) || !draft.assetIds.includes(previewId)) errors.previewAssetId = "请选择当前草稿中的图片或 PDF 预览稿。";
    if (!sourceIds.length || sourceIds.some((id) => !draft.assetIds.includes(id))) errors.sourceAssetIds = "请添加当前草稿的设计源文件。";
    if (Object.keys(errors).length) throw appError("VALIDATION_FAILED", "请补充交付所需的资料。", { fieldErrors: errors });
    const sources = sourceIds.map((id) => findAsset(ctx.db, id));
    if (sources.some((asset) => !asset?.file_id)) throw appError("FILE_NOT_FOUND", "设计源文件不存在。");
    const count = ctx.db.prepare("SELECT COUNT(*) AS count FROM runs WHERE owner = 'draft' AND owner_id = ? AND kind = 'design_delivery'").get(draft.id) as { count: number };
    const version = count.count + 1;
    const snapshot = buildSnapshot(ctx.db, {
      inputs: {
        draft, delivery: { version, note: parameters.deliveryNote, previewAssetId: previewId, sourceAssetIds: sourceIds },
        product: draft.productId ? ctx.db.prepare("SELECT * FROM products WHERE id = ?").get(draft.productId) : null,
        workflow: draft.workflowId ? getWorkflow(ctx.db, draft.workflowId) : null,
      },
      parameters, assetIds: draft.assetIds, skillIds: draft.skillIds, agentId: draft.agentId,
    });
    const files = [{ asset: preview!, role: "preview" }, ...sources.map((asset) => ({ asset: asset!, role: "source" }))];
    for (const item of files) {
      const file = getFile(ctx.db, item.asset.file_id!)!;
      if (!fs.existsSync(absoluteFilePath(ctx.dataset.dir, file.relative_path))) throw appError("FILE_NOT_FOUND", "交付原文件无法读取，请重新导入。");
    }
    const run = insertRun(ctx.db, { owner: "draft", ownerId: draft.id, kind: "design_delivery", status: "completed", snapshot, demo: false });
    for (const item of files) {
      const file = getFile(ctx.db, item.asset.file_id!)!;
      const info = describeFile(file);
      ctx.db.prepare("INSERT INTO run_items (id, run_id, label, item_status, result, message) VALUES (?, ?, ?, 'completed', ?, ?)").run(
        newId(), run.id, item.asset.name,
        JSON.stringify({ fileId: file.id, contentUrl: info.contentUrl, downloadUrl: info.downloadUrl, previewKind: info.previewKind, role: item.role, demo: false }),
        item.role === "preview" ? "手动导入的交付预览稿。" : "手动导入的设计源文件。",
      );
      keepRunFile(ctx.db, run.id, file.id, item.role);
    }
    ctx.db.prepare("UPDATE runs SET progress = 100, result = ?, message = ?, finished_at = ? WHERE id = ?").run(
      JSON.stringify({ delivery: { version, note: parameters.deliveryNote }, logs: [`已登记交付版本 ${version}`, String(parameters.deliveryNote)] }),
      `已登记交付版本 ${version}，文件由用户手动导入。`, nowIso(), run.id,
    );
    recordActivity(ctx.db, "run", run.id, `登记美工交付版本 ${version}`, { name: draft.name, version });
    return run;
  })();
}
