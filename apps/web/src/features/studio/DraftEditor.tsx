import { useEffect, useMemo, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { SaveStatus } from "../../components/SaveStatus.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { Agent, AssetView, Draft, Skill, Workflow } from "../../lib/types.ts";
import { DraftSaveQueue } from "./DraftSaveQueue.ts";

export function DraftEditor({ initial, datasetId, onNew }: { initial: Draft; datasetId: string; onNew: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [, update] = useState(0);
  const queue = useMemo(() => new DraftSaveQueue(initial, async (draft) => {
    const data = await api<{ draft: Draft }>(`/api/drafts/${draft.id}`, { method: "PATCH", datasetId, body: draft });
    void client.invalidateQueries({ queryKey: ["drafts"] });
    return data.draft;
  }, () => update((value) => value + 1)), [initial.id, datasetId, client]);
  const draft = queue.draft;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => queue.dirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useEffect(() => {
    queue.activate();
    const beforeUnload = (event: BeforeUnloadEvent) => { if (queue.dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("beforeunload", beforeUnload); queue.dispose(); };
  }, [queue]);
  const agents = useQuery({ queryKey: ["agents", "draft-picker"], queryFn: () => api<{ items: Agent[] }>("/api/agents") });
  const skills = useQuery({ queryKey: ["skills", "draft-picker"], queryFn: () => api<{ items: Skill[] }>("/api/skills") });
  const assets = useQuery({ queryKey: ["assets", "draft-picker"], queryFn: () => api<{ items: AssetView[] }>("/api/assets") });
  const products = useQuery({ queryKey: ["products"], queryFn: () => api<{ items: Array<{ id: string; name: string }> }>("/api/products") });
  const workflows = useQuery({ queryKey: ["workflows", "draft-picker"], queryFn: () => api<{ items: Workflow[] }>("/api/workflows") });
  const drafts = useQuery({ queryKey: ["drafts", draft.creationType], queryFn: () => api<{ items: Draft[] }>(`/api/drafts?creationType=${draft.creationType}`) });
  return <>
    <div className="toolbar">
      <select aria-label="选择草稿" value={draft.id} onChange={(event) => navigate(`/studio/${draft.creationType}/${event.target.value}`)}>
        {drafts.data?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <Button onClick={() => { void queue.flush().then(onNew).catch(() => {}); }}>新建草稿</Button>
      <Button onClick={() => { void queue.flush().catch(() => {}); }}>保存草稿</Button>
      <SaveStatus state={queue.state} detail={queue.error?.message} onRetry={() => { void queue.flush().catch(() => {}); }} />
    </div>
    {queue.conflictRevision && <div className="card">
      <p>另一页面已保存修订 {queue.conflictRevision}。请选择如何处理本次输入。</p>
      <Button onClick={() => { void queue.overwriteLatest().catch(() => {}); }}>保留本次输入并覆盖最新版本</Button>
      <Button onClick={() => window.location.reload()}>加载已保存版本</Button>
    </div>}
    {queue.error?.message.includes("数据集") && <Button onClick={() => window.location.reload()}>加载当前数据集</Button>}
    <div className="detail-grid">
      <article className="card">
        <h2>创作要求</h2>
        <label className="field">草稿名称<input aria-label="草稿名称" value={draft.name} onChange={(event) => queue.edit({ name: event.target.value })} /></label>
        <label className="field">创作要求<textarea rows={8} aria-label="创作要求" value={draft.requirements} onChange={(event) => queue.edit({ requirements: event.target.value })} /></label>
        <p className="hint">修订 {draft.revision} · 保存在本机</p>
      </article>
      <article className="card">
        <h2>关联资源</h2>
        <label className="field">智能体<select aria-label="选择智能体" value={draft.agentId ?? ""} onChange={(event) => {
          const agent = agents.data?.items.find((item) => item.id === event.target.value);
          queue.edit({ agentId: agent?.id ?? null, productId: draft.productId ?? agent?.products[0]?.id ?? null, skillIds: Array.from(new Set([...draft.skillIds, ...(agent?.skills.map((item) => item.id) ?? [])])), assetIds: Array.from(new Set([...draft.assetIds, ...(agent?.assets.map((item) => item.id) ?? [])])) });
        }}><option value="">未选择</option>{agents.data?.items.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <label className="field">商品知识<select aria-label="选择商品" value={draft.productId ?? ""} onChange={(event) => queue.edit({ productId: event.target.value || null })}>
          <option value="">未选择</option>{products.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select></label>
        <label className="field">团队工作流<select aria-label="选择工作流" value={draft.workflowId ?? ""} onChange={(event) => {
          const workflow = workflows.data?.items.find((item) => item.id === event.target.value);
          queue.edit({ workflowId: workflow?.id ?? null, parameters: { ...workflow?.default_parameters, ...draft.parameters }, skillIds: Array.from(new Set([...draft.skillIds, ...(workflow?.skills.map((item) => item.id) ?? [])])), assetIds: Array.from(new Set([...draft.assetIds, ...(workflow?.assets.map((item) => item.id) ?? [])])) });
        }}><option value="">未选择</option>{workflows.data?.items.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label>
        <fieldset><legend>技能</legend>{skills.data?.items.map((skill) => <label className="field" key={skill.id}><span>
          <input type="checkbox" aria-label={`技能 ${skill.name}`} checked={draft.skillIds.includes(skill.id)} onChange={(event) => queue.edit({ skillIds: event.target.checked ? [...draft.skillIds, skill.id] : draft.skillIds.filter((id) => id !== skill.id) })} /> {skill.name}
        </span></label>)}</fieldset>
        <fieldset><legend>素材</legend>{assets.data?.items.map((asset) => <label className="field" key={asset.id}><span>
          <input type="checkbox" aria-label={`素材 ${asset.name}`} checked={draft.assetIds.includes(asset.id)} onChange={(event) => queue.edit({ assetIds: event.target.checked ? [...draft.assetIds, asset.id] : draft.assetIds.filter((id) => id !== asset.id) })} /> {asset.name}
        </span></label>)}</fieldset>
        {[agents, skills, assets, products, workflows].some((query) => query.isError) && <p role="alert">资源读取失败，请刷新重试。</p>}
      </article>
    </div>
    <Modal open={blocker.state === "blocked"} title="保存草稿后离开" onClose={() => blocker.reset?.()} footer={<>
      <Button onClick={() => blocker.reset?.()}>留在当前页</Button>
      <Button variant="primary" onClick={() => { void queue.flush().then(() => blocker.proceed?.()).catch(() => {}); }}>保存并离开</Button>
    </>}><p>当前有待保存的创作输入。保存成功后继续跳转。</p>{queue.error && <p>{errorMessage(queue.error)}</p>}</Modal>
  </>;
}
