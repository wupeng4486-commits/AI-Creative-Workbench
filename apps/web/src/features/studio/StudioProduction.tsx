import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button.tsx";
import { MediaPreview } from "../../components/MediaPreview.tsx";
import { api, ApiRequestError, errorMessage } from "../../lib/api.ts";
import type { DemoRun } from "../runs/RunPanel.tsx";
import type { DraftSaveQueue } from "./DraftSaveQueue.ts";
import { ArchiveResultButton, SaveWorkflowButton } from "./ResultActions.tsx";

const STATUS: Record<string, string> = { queued: "制作已排队", running: "制作演示中", completed: "制作演示完成", failed: "制作演示失败", stopped: "制作已停止", interrupted: "制作已中断" };

export function StudioProduction({ queue, datasetId, onValidation }: { queue: DraftSaveQueue; datasetId: string; onValidation: (errors: Record<string, string>) => void }) {
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState(params.get("runId") ?? "");
  const loadedHistory = useRef(false);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftId = queue.draft.id;
  const key = ["runs", "draft", draftId];
  const history = useQuery({
    queryKey: key, queryFn: () => api<{ items: DemoRun[] }>(`/api/runs?owner=draft&ownerId=${draftId}`),
    refetchInterval: (query) => query.state.data?.items.some((run) => ["queued", "running"].includes(run.status)) ? 300 : false,
  });
  useEffect(() => {
    if (!history.data?.items[0]) return;
    if (!loadedHistory.current) {
      loadedHistory.current = true;
      if (params.get("runId")) return;
    }
    setSelectedId(history.data.items[0].id);
  }, [history.data?.items[0]?.id]);
  const receive = (run: DemoRun) => {
    client.setQueryData<{ items: DemoRun[] }>(key, (current) => ({ items: [run, ...(current?.items.filter((item) => item.id !== run.id) ?? [])] }));
    void client.invalidateQueries({ queryKey: key });
    setSelectedId(run.id);
    onValidation({});
    setError(null);
  };
  const failed = (failure: unknown) => {
    if (failure instanceof ApiRequestError && failure.fieldErrors) { onValidation(failure.fieldErrors); setError(null); }
    else setError(errorMessage(failure));
  };
  const start = useMutation({
    mutationFn: async () => {
      await queue.flush();
      return api<DemoRun>("/api/runs", { method: "POST", datasetId, body: { owner: "draft", ownerId: draftId, requirements: queue.draft.requirements, draftRevision: queue.draft.revision, simulateFailure } });
    },
    onSuccess: receive, onError: failed,
  });
  const stop = useMutation({ mutationFn: (id: string) => api<DemoRun>(`/api/runs/${id}/stop`, { method: "POST", datasetId }), onSuccess: receive, onError: failed });
  const retry = useMutation({ mutationFn: (id: string) => api<DemoRun>(`/api/runs/${id}/retry`, { method: "POST", datasetId }), onSuccess: receive, onError: failed });
  const selected = selectedId ? history.data?.items.find((run) => run.id === selectedId) : history.data?.items[0];
  const active = history.data?.items.some((run) => ["queued", "running"].includes(run.status));
  const manualDelivery = queue.draft.creationType === "design";
  return <article className="card" aria-label="制作预览">
    <h2>制作预览</h2><p className="hint">{manualDelivery ? "展示手动导入的交付预览稿、源文件与版本记录。" : "本地制作演示，成果使用有效测试素材，未调用真实模型。"}</p>
    {!manualDelivery && <>
    <label className="field"><span><input type="checkbox" aria-label="模拟制作失败" checked={simulateFailure} onChange={(event) => setSimulateFailure(event.target.checked)} /> 模拟首个候选失败</span></label>
    <Button variant="primary" disabled={Boolean(active) || start.isPending} onClick={() => start.mutate()}>{history.data?.items.length ? "再次制作演示" : "开始制作演示"}</Button>
    </>}
    {(error || history.isError) && <p role="alert">{error ?? errorMessage(history.error)}</p>}
    <label className="field">制作历史<select aria-label="制作历史" value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
      <option value="">选择制作记录</option>{history.data?.items.map((run) => <option key={run.id} value={run.id}>{run.startedAt} · {run.kind === "design_delivery" ? `交付版本 ${run.result.delivery?.version}` : STATUS[run.status]} · {run.id.slice(0, 8)}</option>)}
    </select></label>
    {selected ? <section aria-label="当前制作记录">
      <h3>{selected.kind === "design_delivery" ? `交付版本 ${selected.result.delivery?.version} 已登记` : selected.kind === "external_video" ? "外部成片已导入" : STATUS[selected.status] ?? selected.status}</h3><progress max={100} value={selected.progress} aria-label="制作进度" />
      <p>{selected.message}</p>
      {selected.items.some((item) => item.status === "completed") && <SaveWorkflowButton key={selected.id} runId={selected.id} datasetId={datasetId} initialName={`${(selected.inputSnapshot.inputs.draft as { name?: string } | undefined)?.name ?? queue.draft.name}（流程）`} />}
      {selected.result.joinPlan && <section aria-label="拼接方案">
        <h4>拼接方案（演示）</h4><ol>{selected.result.joinPlan.clips.map((clip, index) => <li key={index}>{clip.name} · {clip.duration}秒</li>)}</ol>
        <p>方案合计 {selected.result.joinPlan.totalDuration}秒</p>
      </section>}
      {["queued", "running"].includes(selected.status) && <Button disabled={stop.isPending} onClick={() => stop.mutate(selected.id)}>停止制作演示</Button>}
      {["failed", "stopped", "interrupted"].includes(selected.status) && <Button disabled={retry.isPending} onClick={() => retry.mutate(selected.id)}>重试原记录</Button>}
      {selected.result.shots && selected.result.shots.length > 0 && <><h4>分镜示例</h4><ol>{selected.result.shots.map((shot) => <li key={shot.order}><strong>{shot.title}</strong><p>{shot.description}</p></li>)}</ol></>}
      {selected.items.map((item) => <section className="section" key={item.id} aria-label={item.label}>
        <h4>{item.label}</h4><p>{item.message}</p>
        {item.result.fileId && <><p className="hint">{selected.demo ? "示例成果 · 测试媒体" : "手动导入交付文件"}</p>
          {item.result.role !== "source" && <MediaPreview kind={item.result.previewKind ?? "none"} url={item.result.contentUrl ?? null} downloadUrl={item.result.downloadUrl} name={item.label} />}
          {item.result.downloadUrl && <a href={item.result.downloadUrl} download>{item.result.role === "source" ? "下载源文件" : "下载成果"} {item.label}</a>}
          {item.status === "completed" && <ArchiveResultButton key={item.id} runId={selected.id} itemId={item.id} datasetId={datasetId} initialName={item.label} />}
        </>}
      </section>)}
      <details><summary>输入快照与制作日志</summary><pre>{JSON.stringify(selected.inputSnapshot, null, 2)}</pre><ul>{selected.result.logs?.map((log, index) => <li key={index}>{log}</li>)}</ul></details>
    </section> : <p className="hint">{manualDelivery ? "导入预览稿与源文件后保存交付版本。" : "填写要求并选择资料后开始演示。"}</p>}
  </article>;
}
