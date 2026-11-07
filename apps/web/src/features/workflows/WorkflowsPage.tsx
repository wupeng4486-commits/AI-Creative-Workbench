import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { SearchInput } from "../../components/SearchInput.tsx";
import { SourceFilter, type SourceValue } from "../../components/SourceFilter.tsx";
import { Badge } from "../../components/Badge.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { Workflow } from "../../lib/types.ts";

export function WorkflowsPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [form, setForm] = useState({ name: "", purpose: "" });
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["workflows", params.toString()], queryFn: () => api<{ items: Workflow[]; purposes: string[] }>(`/api/workflows?${params}`) });
  const create = useMutation({
    mutationFn: () => api<{ workflow: Workflow }>("/api/workflows", { method: "POST", body: form }),
    onSuccess: (data) => { void client.invalidateQueries({ queryKey: ["workflows"] }); navigate(`/workflows/${data.workflow.id}`); },
    onError: (mutationError) => setFormError(errorMessage(mutationError)),
  });
  const copy = useMutation({
    mutationFn: (id: string) => api<{ workflow: Workflow }>(`/api/workflows/${id}/copy`, { method: "POST" }),
    onSuccess: (data) => { void client.invalidateQueries({ queryKey: ["workflows"] }); navigate(`/workflows/${data.workflow.id}`); },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const items = query.data?.items ?? [];
  return (
    <>
      <PageHeader title="工作流" description="团队工作流与 LibTV 工作流入口。" actions={<Button variant="primary" onClick={() => { setFormError(null); setCreating(true); }}>新建团队工作流</Button>} />
      <div className="toolbar">
        <SearchInput label="搜索工作流" value={params.get("search") ?? ""} onChange={(value) => filter("search", value)} />
        <SourceFilter value={(params.get("origin") ?? "all") as SourceValue} onChange={(value) => filter("origin", value === "all" ? "" : value)} />
        <select aria-label="用途筛选" value={params.get("purpose") ?? ""} onChange={(event) => filter("purpose", event.target.value)}>
          <option value="">全部用途</option>
          {(query.data?.purposes ?? []).map((purpose) => <option key={purpose}>{purpose}</option>)}
        </select>
        <span className="hint">最近更新优先</span>
      </div>
      {(error || query.isError) && <p role="alert">{error ?? errorMessage(query.error)}</p>}
      {query.isLoading ? <p role="status">正在读取团队工作流…</p> : items.length === 0 ? <EmptyState title="没有符合条件的工作流" action={<Button onClick={() => setParams({})}>清除筛选</Button>} /> : (
        <div className="grid-cards">{items.map((workflow) => <article className="card" key={workflow.id}>
          {workflow.cover_file_id && <img className="asset-thumb" src={`/api/files/${workflow.cover_file_id}/content`} alt={`${workflow.name} 封面`} />}
          <h3><Link to={`/workflows/${workflow.id}`}>{workflow.name}</Link></h3>
          <p>{workflow.purpose}</p>
          <div className="card-meta"><Badge tone={workflow.origin === "shared" ? "shared" : "neutral"}>{workflow.origin === "shared" ? "与我共享的" : "我创建的"}</Badge><span>{workflow.author}</span></div>
          <p className="hint">{workflow.libtv_ref || "待关联 LibTV 流程"}</p>
          <ol>{workflow.steps.slice(0, 3).map((step, index) => <li key={index}>{step}</li>)}</ol>
          <div className="card-actions">
            <Link className="btn btn-secondary" to={`/workflows/${workflow.id}`}>预览流程</Link>
            <Button disabled={copy.isPending} onClick={() => copy.mutate(workflow.id)}>复制为我的流程</Button>
          </div>
        </article>)}</div>
      )}
      <Modal open={creating} title="新建团队工作流" onClose={() => setCreating(false)} footer={<Button variant="primary" disabled={create.isPending} onClick={() => {
        if (!form.name.trim()) { setFormError("工作流名称不能为空。"); return; }
        setFormError(null);
        create.mutate();
      }}>创建并编辑</Button>}>
        <label className="field">名称 *<input aria-label="工作流名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="field">用途<textarea aria-label="工作流用途" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} /></label>
        {formError && <p role="alert">{formError}</p>}
      </Modal>
    </>
  );
}
