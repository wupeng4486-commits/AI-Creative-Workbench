import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button.tsx";
import { MediaPreview } from "../../components/MediaPreview.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { AssetView, PreviewKind } from "../../lib/types.ts";

export interface DemoRun {
  id: string;
  owner: string;
  ownerId: string;
  status: string;
  progress: number;
  message: string;
  demo: boolean;
  parameters: Record<string, unknown>;
  inputSnapshot: { inputs: Record<string, unknown>; parameters: Record<string, unknown>; resources: Array<{ id: string; name: string; kind: string }> };
  result: { logs?: string[] };
  items: Array<{ id: string; label: string; status: string; message: string; result: { fileId?: string; contentUrl?: string; downloadUrl?: string; previewKind?: PreviewKind; demo?: boolean } }>;
}

const STATUS: Record<string, string> = { queued: "已排队", running: "正在演示", completed: "演示完成", failed: "演示失败", stopped: "已停止", interrupted: "已中断" };

export function RunPanel({ ownerId, parameters = {} }: { ownerId: string; parameters?: Record<string, unknown> }) {
  const client = useQueryClient();
  const [requirements, setRequirements] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [sampleInputs, setSampleInputs] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [duration, setDuration] = useState(Number(parameters.duration ?? 15));
  const [ratio, setRatio] = useState(String(parameters.ratio ?? "9:16"));
  const [count, setCount] = useState(Number(parameters.count ?? (parameters.batch ? 3 : 1)));
  const [error, setError] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ["runs", ownerId], queryFn: () => api<{ items: DemoRun[] }>(`/api/runs?owner=workflow&ownerId=${encodeURIComponent(ownerId)}`),
    refetchInterval: (query) => query.state.data?.items.some((run) => ["queued", "running"].includes(run.status)) ? 300 : false,
  });
  const assets = useQuery({ queryKey: ["assets", "run-picker"], queryFn: () => api<{ items: AssetView[] }>("/api/assets") });
  const refresh = () => { void client.invalidateQueries({ queryKey: ["runs", ownerId] }); setError(null); };
  const start = useMutation({
    mutationFn: () => api<DemoRun>("/api/runs", { method: "POST", body: {
      owner: "workflow", ownerId, requirements, assetIds, sampleInputs, simulateFailure,
      parameters: { ...parameters, duration, ratio, count },
    } }),
    onSuccess: refresh, onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const stop = useMutation({ mutationFn: (id: string) => api(`/api/runs/${id}/stop`, { method: "POST" }), onSuccess: refresh, onError: (mutationError) => setError(errorMessage(mutationError)) });
  const retry = useMutation({ mutationFn: (id: string) => api(`/api/runs/${id}/retry`, { method: "POST" }), onSuccess: refresh, onError: (mutationError) => setError(errorMessage(mutationError)) });
  return <section className="section" aria-label="演示运行">
    <h2>参数与本地演示</h2>
    <p className="hint">尚未接入真实 LibTV。结果使用本地有效测试素材，输入与参数会随每次演示保存。</p>
    <div className="card">
      <label className="field">本次演示要求<textarea aria-label="本次演示要求" value={requirements} onChange={(event) => setRequirements(event.target.value)} /></label>
      <div className="form-grid">
        <label className="field">时长（秒）<input type="number" min={1} max={120} aria-label="演示时长" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
        <label className="field">画面比例<select aria-label="演示比例" value={ratio} onChange={(event) => setRatio(event.target.value)}>{["9:16", "16:9", "1:1"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field">条目数量<input type="number" min={1} max={10} aria-label="演示条目数量" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>
      </div>
      <fieldset><legend>输入素材</legend>
        {(assets.data?.items ?? []).map((asset) => <label className="field" key={asset.id}><span><input type="checkbox" aria-label={`输入素材 ${asset.name}`} checked={assetIds.includes(asset.id)} onChange={(event) => setAssetIds(event.target.checked ? [...assetIds, asset.id] : assetIds.filter((id) => id !== asset.id))} /> {asset.name}</span></label>)}
        <label className="field"><span><input type="checkbox" aria-label="使用本地测试素材" checked={sampleInputs} onChange={(event) => setSampleInputs(event.target.checked)} /> 使用本地测试素材</span></label>
        <label className="field"><span><input type="checkbox" aria-label="模拟首条失败" checked={simulateFailure} onChange={(event) => setSimulateFailure(event.target.checked)} /> 模拟首条失败（用于检查重试）</span></label>
      </fieldset>
      <Button variant="primary" disabled={start.isPending} onClick={() => start.mutate()}>开始演示</Button>
      {error && <p role="alert">{error}</p>}
    </div>
    <h3>演示历史</h3>
    {history.isError && <p role="alert">{errorMessage(history.error)}</p>}
    {(history.data?.items ?? []).map((run) => <article className="card" aria-label={`演示 ${run.id}`} key={run.id}>
      <h3>{STATUS[run.status] ?? run.status} · 本地演示</h3>
      <progress max={100} value={run.progress} aria-label="演示进度" />
      <p>{run.message}</p><p className="hint">{run.id}</p>
      {["queued", "running"].includes(run.status) && <Button disabled={stop.isPending} onClick={() => stop.mutate(run.id)}>停止演示</Button>}
      {["failed", "stopped", "interrupted"].includes(run.status) && <Button disabled={retry.isPending} onClick={() => retry.mutate(run.id)}>重试演示</Button>}
      <details><summary>输入快照与日志</summary><pre>{JSON.stringify(run.inputSnapshot, null, 2)}</pre><ul>{run.result.logs?.map((log, index) => <li key={index}>{log}</li>)}</ul></details>
      <div className="grid-cards">{run.items.map((item) => <section className="card" key={item.id} aria-label={item.label}>
        <h4>{item.label} · {STATUS[item.status] ?? item.status}</h4><p>{item.message}</p>
        {item.result.fileId && <><p className="hint">示例成果 · 本地测试素材</p><MediaPreview kind={item.result.previewKind ?? "none"} url={item.result.contentUrl ?? null} downloadUrl={item.result.downloadUrl} name={item.label} /></>}
      </section>)}</div>
    </article>)}
    {history.data?.items.length === 0 && <p className="hint">尚无演示记录。</p>}
  </section>;
}
