import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { SaveStatus, type SaveState } from "../../components/SaveStatus.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { Agent } from "../../lib/types.ts";
import { agentCreationUrl } from "./agentCreationUrl.ts";

type Resource = { id: string; name: string };
interface Detail { agent: Agent; skills: Resource[]; products: Resource[]; assets: Resource[] }
const TABS = ["概览", "指令配置", "知识与技能", "示例对话"];

export function AgentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["agent", id], queryFn: () => api<Detail>(`/api/agents/${id}`) });
  const [draft, setDraft] = useState<Agent | null>(null);
  const [tab, setTab] = useState("概览");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [answer, setAnswer] = useState<number | null>(null);
  useEffect(() => { if (query.data) setDraft((current) => current?.id === query.data.agent.id ? current : query.data.agent); }, [query.data]);
  useEffect(() => { setTab("概览"); setState("idle"); setError(null); setAnswer(null); }, [id]);
  const invalidate = () => {
    for (const key of ["agents", "skills", "home", "search"]) void client.invalidateQueries({ queryKey: [key] });
  };
  const save = useMutation({
    mutationFn: () => api<{ agent: Agent }>(`/api/agents/${id}`, { method: "PATCH", body: {
      name: draft?.name, purpose: draft?.purpose, domain: draft?.domain, instructions: draft?.instructions,
      outputRequirements: draft?.output_requirements, cautions: draft?.cautions, exampleDialog: draft?.example_dialog,
      skillIds: draft?.skills.map((item) => item.id), productIds: draft?.products.map((item) => item.id),
      assetIds: draft?.assets.map((item) => item.id),
    } }),
    onMutate: () => setState("saving"),
    onSuccess: (data) => { setDraft(data.agent); setState("saved"); setError(null); invalidate(); },
    onError: (mutationError) => { setState("error"); setError(errorMessage(mutationError)); },
  });
  const copy = useMutation({
    mutationFn: () => api<{ agent: Agent }>(`/api/agents/${id}/copy`, { method: "POST" }),
    onSuccess: (data) => { invalidate(); navigate(`/agents/${data.agent.id}`); },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/agents/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); navigate("/agents"); },
    onError: (mutationError) => { setDeleting(false); setError(errorMessage(mutationError)); },
  });
  if (query.isError) return <><PageHeader title="智能体详情" /><EmptyState title="无法读取智能体" description={errorMessage(query.error)} /></>;
  if (!draft || query.isLoading) return <PageHeader title="智能体详情" description="正在读取…" />;
  const owned = draft.origin === "owned";
  const edit = (changes: Partial<Agent>) => { setDraft({ ...draft, ...changes }); setState("idle"); };
  const textField = (key: "name" | "purpose" | "domain" | "instructions" | "output_requirements" | "cautions", label: string, rows = 3) => (
    <label className="field" key={key}><span className="label">{label}</span>
      <textarea aria-label={label} rows={rows} disabled={!owned || save.isPending} value={draft[key]} onChange={(event) => edit({ [key]: event.target.value })} />
    </label>
  );
  return (
    <>
      <PageHeader title="智能体详情" description="概览、指令配置、知识与技能、示例对话。" actions={<>
        <Link className="btn btn-primary" to={agentCreationUrl(draft)}>去创作</Link>
        <Button onClick={() => copy.mutate()} disabled={copy.isPending}>复制为我的智能体</Button>
        {owned && <Button variant="danger" onClick={() => setDeleting(true)}>删除</Button>}
      </>} />
      <div className="card-meta"><strong>{draft.name}</strong><span>{draft.origin === "shared" ? "与我共享的" : "我创建的"} · {draft.author}</span></div>
      <div className="segmented" role="tablist" aria-label="智能体资料">
        {TABS.map((item) => <button type="button" role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}
      </div>
      <article className="card" role="tabpanel" aria-label={tab}>
        {tab === "概览" && <>{textField("name", "名称", 1)}{textField("purpose", "用途")}{textField("domain", "创作领域", 1)}</>}
        {tab === "指令配置" && <>{textField("instructions", "角色指令", 8)}{textField("output_requirements", "输出要求")}{textField("cautions", "注意事项")}</>}
        {tab === "知识与技能" && ([
          { key: "skills", label: "技能" }, { key: "products", label: "商品知识" }, { key: "assets", label: "素材资料" },
        ] as const).map((group) => <fieldset key={group.key} disabled={!owned || save.isPending}>
          <legend>{group.label}</legend>
          {(query.data?.[group.key] ?? []).map((resource) => <label className="field" key={resource.id}>
            <span><input type="checkbox" aria-label={resource.name} checked={draft[group.key].some((item) => item.id === resource.id)} onChange={(event) => {
              edit({ [group.key]: event.target.checked ? [...draft[group.key], resource] : draft[group.key].filter((item) => item.id !== resource.id) });
            }} /> {resource.name}</span>
          </label>)}
          {query.data?.[group.key].length === 0 && <p className="hint">尚无可关联资料，请先到对应目录创建。</p>}
        </fieldset>)}
        {tab === "示例对话" && <>
          <p className="hint">预设问题与示例回复，未调用真实模型。</p>
          {draft.example_dialog.map((dialog, index) => <section key={index} className="section">
            <Button onClick={() => setAnswer(index)}>{dialog.question || "查看示例回复"}</Button>
            {answer === index && <p role="status">示例回复（未调用真实模型） {dialog.answer}</p>}
            {owned && <>
              <label className="field">问题<input aria-label={`示例问题 ${index + 1}`} value={dialog.question} disabled={save.isPending} onChange={(event) => edit({ example_dialog: draft.example_dialog.map((item, position) => position === index ? { ...item, question: event.target.value } : item) })} /></label>
              <label className="field">回复<textarea aria-label={`示例回复 ${index + 1}`} value={dialog.answer} disabled={save.isPending} onChange={(event) => edit({ example_dialog: draft.example_dialog.map((item, position) => position === index ? { ...item, answer: event.target.value } : item) })} /></label>
              <Button disabled={save.isPending} onClick={() => edit({ example_dialog: draft.example_dialog.filter((_, position) => position !== index) })}>移除示例 {index + 1}</Button>
            </>}
          </section>)}
          {draft.example_dialog.length === 0 && <p>尚无示例对话。</p>}
          {owned && <Button disabled={save.isPending} onClick={() => edit({ example_dialog: [...draft.example_dialog, { question: "", answer: "" }] })}>添加示例对话</Button>}
        </>}
        <div className="card-actions">
          {owned && <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>保存智能体</Button>}
          <SaveStatus state={state} detail={error ?? undefined} onRetry={() => save.mutate()} />
        </div>
        {error && state !== "error" && <p role="alert">{error}</p>}
      </article>
      <ConfirmDialog open={deleting} title="删除智能体" description="请确认删除。仍被草稿引用时，请先解除引用。" danger confirmLabel="确认删除" onCancel={() => setDeleting(false)} onConfirm={() => remove.mutate()} />
    </>
  );
}
