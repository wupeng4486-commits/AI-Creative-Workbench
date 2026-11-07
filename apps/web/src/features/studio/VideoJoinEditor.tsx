import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDuration } from "@workbench/shared";
import { Button } from "../../components/Button.tsx";
import { FieldError } from "../../components/FieldError.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { AssetView } from "../../lib/types.ts";
import type { DraftSaveQueue } from "./DraftSaveQueue.ts";

export function VideoJoinEditor({ queue, assets, datasetId, errors }: { queue: DraftSaveQueue; assets: AssetView[]; datasetId: string; errors: Record<string, string> }) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef<number | null>(null);
  const clips = queue.draft.clips;
  const setClips = (ids: string[]) => queue.edit({ clipAssetIds: ids, clips: ids.map((assetId, position) => ({ assetId, position })) });
  const add = (id: string) => setClips([...queue.draft.clips.map((clip) => clip.assetId), id]);
  const move = (from: number, to: number) => {
    if (!Number.isInteger(from) || from === to || from < 0 || to < 0 || from >= clips.length || to >= clips.length) return;
    const ids = clips.map((clip) => clip.assetId);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id!);
    setClips(ids);
    setPreviewIndex(to);
  };
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const body = new FormData(); body.append("file", file);
        const data = await api<{ asset: AssetView }>("/api/assets/import", { method: "POST", datasetId, body });
        if (!data.asset.file?.mime_type.startsWith("video/") || !data.asset.file.duration) throw new Error("文件已导入，请选择能够读取有效时长的视频加入拼接。");
        add(data.asset.id);
      }
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["assets"] }); setError(null); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const total = clips.reduce((sum, clip) => sum + (assets.find((asset) => asset.id === clip.assetId)?.file?.duration ?? 0), 0);
  const preview = assets.find((asset) => asset.id === clips[Math.min(previewIndex, clips.length - 1)]?.assetId);
  return <fieldset>
    <legend>视频片段</legend>
    <label className="field">添加本地视频<input type="file" accept="video/*" multiple aria-label="添加本地视频" disabled={upload.isPending} onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) upload.mutate(files); }} /></label>
    <label className="field">资产库视频<select aria-label="选择拼接视频" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">请选择</option>
      {assets.filter((asset) => asset.asset_type === "video").map((asset) => <option key={asset.id} value={asset.id} disabled={!asset.file?.duration}>{asset.name} · {formatDuration(asset.file?.duration)}</option>)}
    </select></label>
    <Button disabled={!selectedId} onClick={() => { add(selectedId); setSelectedId(""); }}>加入片段</Button>
    <FieldError message={errors.clips} />
    {error && <p role="alert">{error}</p>}
    <p aria-label="合计时长">合计时长 {formatDuration(total)}</p>
    <ol aria-label="拼接片段">{clips.map((clip, index) => {
      const asset = assets.find((item) => item.id === clip.assetId);
      return <li className="card" key={`${clip.assetId}-${index}`} draggable aria-label={`片段 ${index + 1} ${asset?.name ?? clip.assetId}`}
        onDragStart={(event) => { dragging.current = index; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index)); }}
        onDragEnd={() => { dragging.current = null; }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
        onDrop={(event) => { event.preventDefault(); const from = dragging.current ?? Number.parseInt(event.dataTransfer.getData("text/plain"), 10); move(from, index); dragging.current = null; }}>
        <span className="drag-handle" draggable aria-label={`拖动片段 ${index + 1}`}>↕ 拖动排序</span>
        {asset?.thumbUrl && <img draggable={false} className="asset-thumb" src={asset.thumbUrl} alt={`${asset.name} 缩略图`} />}
        <p>{asset?.name ?? "正在读取片段"} · {formatDuration(asset?.file?.duration)}</p>
        <div className="card-actions">
          <Button onClick={() => setPreviewIndex(index)}>预览片段 {index + 1}</Button>
          <Button disabled={index === 0} onClick={() => move(index, index - 1)}>上移片段 {index + 1}</Button>
          <Button disabled={index === clips.length - 1} onClick={() => move(index, index + 1)}>下移片段 {index + 1}</Button>
          <Button onClick={() => setClips(clips.filter((_, position) => position !== index).map((item) => item.assetId))}>移除片段 {index + 1}</Button>
        </div>
      </li>;
    })}</ol>
    {preview?.contentUrl && <video className="media-video" aria-label="单片段预览" src={preview.contentUrl} controls preload="metadata" />}
    <ol aria-label="片段顺序">{clips.map((clip, index) => <li key={index}>{assets.find((asset) => asset.id === clip.assetId)?.name ?? clip.assetId}</li>)}</ol>
    <p className="hint">本页保存拼接方案与顺序，拼接成果使用明确标注的本地演示素材。</p>
  </fieldset>;
}
