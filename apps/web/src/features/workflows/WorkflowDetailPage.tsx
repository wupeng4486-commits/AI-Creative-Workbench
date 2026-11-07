import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { SaveStatus, type SaveState } from "../../components/SaveStatus.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { AssetView, Workflow } from "../../lib/types.ts";
import { RunPanel } from "../runs/RunPanel.tsx";

export function WorkflowDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["workflow", id], queryFn: () => api<{ workflow: Workflow; skills: Array<{ id: string; name: string }> }>(`/api/workflows/${id}`) });
  const assets = useQuery({ queryKey: ["assets", "workflow-picker"], queryFn: () => api<{ items: AssetView[] }>("/api/assets") });
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [parameters, setParameters] = useState("{}");
  const [steps, setSteps] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!query.data) return;
    setDraft(query.data.workflow);
    setParameters(JSON.stringify(query.data.workflow.default_parameters, null, 2));
    setSteps(query.data.workflow.steps.join("\n"));
  }, [query.data]);
  useEffect(() => { setState("idle"); setError(null); }, [id]);
  const invalidate = () => {
    for (const key of ["workflows", "home", "search", "skills"]) void client.invalidateQueries({ queryKey: [key] });
  };
  const save = useMutation({
    mutationFn: () => {
      const parsed = JSON.parse(parameters) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("默认参数需要填写 JSON 对象。");
      return api<{ workflow: Workflow }>(`/api/workflows/${id}`, { method: "PATCH", body: {
        name: draft?.name, purpose: draft?.purpose, libtvRef: draft?.libtv_ref, inputSpec: draft?.input_spec,
        defaultParameters: parsed, steps: steps.split("\n").map((step) => step.trim()).filter(Boolean),
        coverFileId: draft?.cover_file_id, skillIds: draft?.skills.map((skill) => skill.id), assetIds: draft?.assets.map((asset) => asset.id),
      } });
    },
    onMutate: () => setState("saving"),
    onSuccess: (data) => { setDraft(data.workflow); setState("saved"); setError(null); invalidate(); },
    onError: (mutationError) => { setState("error"); setError(errorMessage(mutationError)); },
  });
  const copy = useMutation({
    mutationFn: () => api<{ workflow: Workflow }>(`/api/workflows/${id}/copy`, { method: "POST" }),
    onSuccess: (data) => { invalidate(); navigate(`/workflows/${data.workflow.id}`); },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/workflows/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); navigate("/workflows"); },
    onError: (mutationError) => { setDeleting(false); setError(errorMessage(mutationError)); },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api<{ asset: AssetView }>("/api/assets/import", { method: "POST", body });
    },
    onSuccess: (data) => {
      setDraft((current) => current && { ...current, assets: [...current.assets, data.asset] });
      setState("idle");
      void client.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  if (query.isError) return <><PageHeader title="工作流详情" /><EmptyState title="无法读取工作流" description={errorMessage(query.error)} /></>;
  if (query.isLoading || !draft) return <PageHeader title="工作流详情" description="正在读取…" />;
  const owned = draft.origin === "owned";
  const edit = (changes: Partial<Workflow>) => { setDraft({ ...draft, ...changes }); setState("idle"); };
  return (
    <>
      <PageHeader title="工作流详情" description="用途、流程预览、输入要求与默认参数。" actions={<>
        <Link className="btn btn-primary" to={`/studio?workflowId=${draft.id}`}>带入创作</Link>
        <Button onClick={() => copy.mutate()} disabled={copy.isPending}>复制为我的流程</Button>
        {owned && <Button variant="danger" onClick={() => setDeleting(true)}>删除</Button>}
      </>} />
      <div className="detail-grid">
        <article className="card">
          <p>{draft.origin === "shared" ? "与我共享的" : "我创建的"} · {draft.author}</p>
          <fieldset disabled={!owned || save.isPending}>
            <legend>流程资料</legend>
            <label className="field">名称<input aria-label="名称" value={draft.name} onChange={(event) => edit({ name: event.target.value })} /></label>
            <label className="field">用途<textarea aria-label="用途" value={draft.purpose} onChange={(event) => edit({ purpose: event.target.value })} /></label>
            <label className="field">LibTV 流程引用<input aria-label="LibTV 流程引用" value={draft.libtv_ref} placeholder="待关联" onChange={(event) => edit({ libtv_ref: event.target.value })} /></label>
            <label className="field">输入说明<textarea aria-label="输入说明" value={draft.input_spec} onChange={(event) => edit({ input_spec: event.target.value })} /></label>
            <label className="field">默认参数（JSON 对象）<textarea aria-label="默认参数" rows={6} value={parameters} onChange={(event) => { setParameters(event.target.value); setState("idle"); }} /></label>
            <label className="field">流程步骤（每行一步）<textarea aria-label="流程步骤" rows={6} value={steps} onChange={(event) => { setSteps(event.target.value); setState("idle"); }} /></label>
            <label className="field">封面<select aria-label="封面" value={draft.cover_file_id ?? ""} onChange={(event) => edit({ cover_file_id: event.target.value || null })}>
              <option value="">无封面</option>
              {(assets.data?.items ?? []).filter((asset) => asset.asset_type === "image" && asset.file_id).map((asset) => <option key={asset.id} value={asset.file_id!}>{asset.name}</option>)}
            </select></label>
            <fieldset><legend>关联技能</legend>{(query.data?.skills ?? []).map((skill) => <label className="field" key={skill.id}><span>
              <input type="checkbox" aria-label={skill.name} checked={draft.skills.some((item) => item.id === skill.id)} onChange={(event) => edit({ skills: event.target.checked ? [...draft.skills, skill] : draft.skills.filter((item) => item.id !== skill.id) })} /> {skill.name}
            </span></label>)}</fieldset>
            <fieldset><legend>示例与附件</legend>{(assets.data?.items ?? []).map((asset) => <label className="field" key={asset.id}><span>
              <input type="checkbox" aria-label={`附件 ${asset.name}`} checked={draft.assets.some((item) => item.id === asset.id)} onChange={(event) => edit({ assets: event.target.checked ? [...draft.assets, asset] : draft.assets.filter((item) => item.id !== asset.id) })} /> {asset.name}
            </span></label>)}
              <label className="field">导入流程附件<input type="file" aria-label="导入流程附件" disabled={upload.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); }} /></label>
            </fieldset>
          </fieldset>
          <div className="card-actions">
            {owned && <Button variant="primary" disabled={save.isPending || upload.isPending} onClick={() => save.mutate()}>保存工作流</Button>}
            <SaveStatus state={state} detail={error ?? undefined} onRetry={() => save.mutate()} />
          </div>
          {error && state !== "error" && <p role="alert">{error}</p>}
        </article>
        <article className="card" aria-label="流程预览">
          <h2>{draft.name}</h2>
          {draft.cover_file_id && <img className="media-image" src={`/api/files/${draft.cover_file_id}/content`} alt="工作流封面" />}
          <p>{draft.input_spec}</p>
          <ol>{steps.split("\n").filter(Boolean).map((step, index) => <li key={index}>{step}</li>)}</ol>
          <h3>示例与流程附件</h3>
          {draft.assets.map((asset) => <p key={asset.id}><a href={asset.downloadUrl ?? undefined} download>{asset.name}</a></p>)}
          <p className="hint">预览仅展示资料。LibTV 执行通过演示入口操作。</p>
        </article>
      </div>
      <RunPanel key={`${draft.id}-${JSON.stringify(draft.default_parameters)}`} ownerId={draft.id} parameters={draft.default_parameters} />
      {draft.sourceSnapshot && <article className="card" aria-label="工作流来源"><h2>制作来源</h2><p>来自制作记录 {draft.sourceSnapshot.runId}</p><details><summary>原始输入与参数</summary><pre>{JSON.stringify(draft.sourceSnapshot, null, 2)}</pre></details></article>}
      <ConfirmDialog open={deleting} title="删除工作流" description="请确认删除。仍被草稿引用时，请先解除引用。" danger confirmLabel="确认删除" onCancel={() => setDeleting(false)} onConfirm={() => remove.mutate()} />
    </>
  );
}
