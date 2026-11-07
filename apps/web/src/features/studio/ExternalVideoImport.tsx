import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { AssetView } from "../../lib/types.ts";
import type { DraftSaveQueue } from "./DraftSaveQueue.ts";

export function ExternalVideoImport({ queue, datasetId }: { queue: DraftSaveQueue; datasetId: string }) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<AssetView | null>(null);
  const uploaded = useRef<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("请选择外部成片视频。");
      await queue.flush();
      if (!uploaded.current) {
        const body = new FormData(); body.append("file", file);
        const data = await api<{ file: { id: string } }>("/api/files/upload", { method: "POST", datasetId, body });
        uploaded.current = data.file.id;
      }
      await queue.flush();
      return api<{ asset: AssetView }>("/api/results/external-video", { method: "POST", datasetId, body: { draftId: queue.draft.id, revision: queue.draft.revision, fileId: uploaded.current, name } });
    },
    onSuccess: (data) => {
      setSaved(data.asset);
      for (const key of ["assets", "home", "search", "runs"]) void client.invalidateQueries({ queryKey: [key] });
    },
  });
  return <fieldset disabled={mutation.isPending}>
    <legend>手动导入外部成片</legend>
    <p className="hint">外部剪辑完成后，手动选择成片并保存制作来源。</p>
    <label className="field">外部成片<input type="file" accept="video/*" aria-label="外部成片" onChange={(event) => { const selected = event.target.files?.[0] ?? null; setFile(selected); setName(selected?.name ?? ""); uploaded.current = null; setSaved(null); }} /></label>
    <label className="field">成片名称<input aria-label="外部成片名称" value={name} onChange={(event) => setName(event.target.value)} /></label>
    <Button onClick={() => mutation.mutate()}>导入外部成片</Button>
    {mutation.isError && <p role="alert">{errorMessage(mutation.error)}</p>}
    {saved && <p role="status">外部成片已导入 <Link to={`/assets/${saved.id}`}>查看外部成片</Link></p>}
  </fieldset>;
}
