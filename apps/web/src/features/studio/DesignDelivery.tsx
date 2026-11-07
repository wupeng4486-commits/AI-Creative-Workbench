import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button.tsx";
import { FieldError } from "../../components/FieldError.tsx";
import { api, ApiRequestError, errorMessage } from "../../lib/api.ts";
import type { AssetView } from "../../lib/types.ts";
import type { DraftSaveQueue } from "./DraftSaveQueue.ts";

export function DesignDelivery({ queue, assets, datasetId, errors, onValidation }: { queue: DraftSaveQueue; assets: AssetView[]; datasetId: string; errors: Record<string, string>; onValidation: (errors: Record<string, string>) => void }) {
  const client = useQueryClient();
  const key = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = queue.draft;
  const sourceIds = Array.isArray(draft.parameters.sourceAssetIds) ? draft.parameters.sourceAssetIds as string[] : [];
  const upload = useMutation({
    mutationFn: async ({ files, role }: { files: File[]; role: "preview" | "source" }) => {
      for (const file of files) {
        const body = new FormData(); body.append("file", file);
        const data = await api<{ asset: AssetView }>("/api/assets/import", { method: "POST", datasetId, body });
        const current = queue.draft;
        const previous = Array.isArray(current.parameters.sourceAssetIds) ? current.parameters.sourceAssetIds as string[] : [];
        queue.edit({ assetIds: Array.from(new Set([...current.assetIds, data.asset.id])), parameters: {
          ...current.parameters,
          ...(role === "preview" ? { previewAssetId: data.asset.id } : { sourceAssetIds: [...previous, data.asset.id] }),
        } });
      }
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["assets"] }); setError(null); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const save = useMutation({
    mutationFn: async () => {
      await queue.flush();
      key.current ??= crypto.randomUUID();
      return api(`/api/drafts/${draft.id}/deliveries`, { method: "POST", datasetId, idempotencyKey: key.current, body: { revision: queue.draft.revision } });
    },
    onSuccess: () => { key.current = null; setError(null); onValidation({}); void client.invalidateQueries({ queryKey: ["runs", "draft", draft.id] }); },
    onError: (failure) => {
      if (failure instanceof ApiRequestError && failure.fieldErrors) { onValidation(failure.fieldErrors); setError(null); }
      else setError(errorMessage(failure));
    },
  });
  return <fieldset disabled={upload.isPending || save.isPending}>
    <legend>预览与源文件</legend>
    <label className="field">预览稿<select aria-label="选择预览稿" value={String(draft.parameters.previewAssetId ?? "")} onChange={(event) => {
      const id = event.target.value;
      queue.edit({ assetIds: id ? Array.from(new Set([...draft.assetIds, id])) : draft.assetIds, parameters: { ...draft.parameters, previewAssetId: id } });
    }}><option value="">请选择</option>{assets.filter((asset) => ["image", "pdf"].includes(asset.previewKind)).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><FieldError message={errors.previewAssetId} /></label>
    <label className="field">导入预览稿<input type="file" accept="image/*,.pdf" aria-label="导入预览稿" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate({ files: [file], role: "preview" }); }} /></label>
    <label className="field">导入设计源文件<input type="file" multiple aria-label="导入设计源文件" onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) upload.mutate({ files, role: "source" }); }} /></label>
    <FieldError message={errors.sourceAssetIds} />
    {sourceIds.map((id) => <p key={id}>{assets.find((asset) => asset.id === id)?.name ?? "已导入源文件"} <Button onClick={() => queue.edit({ parameters: { ...draft.parameters, sourceAssetIds: sourceIds.filter((sourceId) => sourceId !== id) } })}>移出源文件</Button></p>)}
    <label className="field">本次版本说明<textarea aria-label="本次版本说明" value={String(draft.parameters.deliveryNote ?? "")} onChange={(event) => queue.edit({ parameters: { ...draft.parameters, deliveryNote: event.target.value } })} /><FieldError message={errors.deliveryNote} /></label>
    {upload.isPending && <p role="status">正在导入交付文件…</p>}
    <Button variant="primary" onClick={() => save.mutate()}>保存交付版本</Button>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
