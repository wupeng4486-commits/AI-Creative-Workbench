import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { Workflow } from "../../lib/types.ts";
import { RunPanel } from "../runs/RunPanel.tsx";

interface Sample { id: string; name: string; purpose: string; inputSpec: string; libtvRef: string; defaultParameters: Record<string, unknown>; steps: string[] }
export function LibTVPanel() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Sample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["libtv-samples"], queryFn: () => api<{ items: Sample[] }>("/api/workflows/libtv/samples") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<{ integrations: { libtv: { url: string } } }>("/api/settings") });
  const save = useMutation({
    mutationFn: (id: string) => api<{ workflow: Workflow }>(`/api/workflows/libtv/${id}/save`, { method: "POST" }),
    onSuccess: (data) => { void client.invalidateQueries({ queryKey: ["workflows"] }); navigate(`/workflows/${data.workflow.id}`); },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  return <section className="section">
    <p className="hint">尚未接入 LibTV。以下四项为可复用的本地演示示例。</p>
    {settings.data?.integrations.libtv.url && <a className="btn btn-secondary" href={settings.data.integrations.libtv.url} target="_blank" rel="noreferrer">打开 LibTV</a>}
    {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="grid-cards">{query.data?.items.map((sample) => <article className="card" key={sample.id}>
      <h3>{sample.name}</h3><p>{sample.purpose}</p><p>输入要求 {sample.inputSpec}</p>
      <ol>{sample.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      <div className="card-actions"><Button onClick={() => setSelected(sample)}>参数与演示 · {sample.name}</Button><Button disabled={save.isPending} onClick={() => save.mutate(sample.id)}>保存为团队工作流 · {sample.name}</Button></div>
    </article>)}</div>
    {selected && <><h2>{selected.name}</h2><RunPanel key={selected.id} ownerId={selected.id} parameters={selected.defaultParameters} /></>}
  </section>;
}
