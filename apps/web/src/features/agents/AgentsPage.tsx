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
import type { Agent } from "../../lib/types.ts";
import { agentCreationUrl } from "./agentCreationUrl.ts";

export function AgentsPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [form, setForm] = useState({ name: "", purpose: "", domain: "AI 视频" });
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["agents", params.toString()],
    queryFn: () => api<{ items: Agent[]; domains: string[] }>(`/api/agents?${params}`),
  });
  const create = useMutation({
    mutationFn: () => api<{ agent: Agent }>("/api/agents", { method: "POST", body: form }),
    onSuccess: (data) => {
      void client.invalidateQueries({ queryKey: ["agents"] });
      navigate(`/agents/${data.agent.id}`);
    },
    onError: (mutationError) => setFormError(errorMessage(mutationError)),
  });
  const copy = useMutation({
    mutationFn: (id: string) => api<{ agent: Agent }>(`/api/agents/${id}/copy`, { method: "POST" }),
    onSuccess: (data) => {
      void client.invalidateQueries({ queryKey: ["agents"] });
      navigate(`/agents/${data.agent.id}`);
    },
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
      <PageHeader
        title="智能体"
        description="用户创建或与用户共享的团队智能体目录。"
        actions={<Button variant="primary" onClick={() => { setFormError(null); setCreating(true); }}>新建智能体</Button>}
      />
      <div className="toolbar">
        <SearchInput label="搜索智能体" value={params.get("search") ?? ""} onChange={(value) => filter("search", value)} />
        <SourceFilter value={(params.get("origin") ?? "all") as SourceValue} onChange={(value) => filter("origin", value === "all" ? "" : value)} />
        <select aria-label="用途筛选" value={params.get("domain") ?? ""} onChange={(event) => filter("domain", event.target.value)}>
          <option value="">全部用途</option>
          {(query.data?.domains ?? []).map((domain) => <option key={domain}>{domain}</option>)}
        </select>
        <span className="hint">最近更新优先</span>
      </div>
      {(error || query.isError) && <p role="alert">{error ?? errorMessage(query.error)}</p>}
      {query.isLoading ? <p role="status">正在读取智能体…</p> : items.length === 0 ? (
        <EmptyState title="没有符合条件的智能体" action={<Button onClick={() => setParams({})}>清除筛选</Button>} />
      ) : (
        <div className="grid-cards">
          {items.map((agent) => (
            <article className="card" key={agent.id}>
              <h3><Link to={`/agents/${agent.id}`}>{agent.name}</Link></h3>
              <p>{agent.purpose}</p>
              <div className="card-meta">
                <Badge>{agent.domain}</Badge>
                <Badge tone={agent.origin === "shared" ? "shared" : "neutral"}>{agent.origin === "shared" ? "与我共享的" : "我创建的"}</Badge>
                <span>{agent.author}</span>
                <span>{agent.skills.length} 项技能 · {agent.products.length + agent.assets.length} 项资料</span>
              </div>
              <div className="card-actions">
                <Link className="btn btn-primary" to={agentCreationUrl(agent)}>去创作</Link>
                <Link className="btn btn-secondary" to={`/agents/${agent.id}`}>查看详情</Link>
                <Button onClick={() => copy.mutate(agent.id)} disabled={copy.isPending}>复制</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal open={creating} title="新建智能体" onClose={() => setCreating(false)} footer={
        <Button variant="primary" disabled={create.isPending} onClick={() => {
          if (!form.name.trim() || !form.purpose.trim()) {
            setFormError("请填写智能体名称与用途。");
            return;
          }
          setFormError(null);
          create.mutate();
        }}>创建并编辑</Button>
      }>
        <label className="field">名称 *<input aria-label="智能体名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="field">用途 *<textarea aria-label="智能体用途" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} /></label>
        <label className="field">创作领域<select aria-label="创作领域" value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })}>
          {["AI 视频", "AI 图片", "美工", "素材整理", "交付检查"].map((domain) => <option key={domain}>{domain}</option>)}
        </select></label>
        {formError && <p role="alert">{formError}</p>}
      </Modal>
    </>
  );
}
