import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { CREATION_TYPE_LABELS, type CreationType } from "@workbench/shared";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { Draft } from "../../lib/types.ts";
import { DraftEditor } from "./DraftEditor.tsx";

export function StudioPage() {
  const { type, draftId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const previousType = localStorage.getItem("activeCreationType");
  const creation = (type && type in CREATION_TYPE_LABELS ? type : previousType && previousType in CREATION_TYPE_LABELS ? previousType : "ai_video") as CreationType;
  const creationKey = useRef<string | null>(null);
  const list = useQuery({ queryKey: ["drafts", creation], queryFn: () => api<{ datasetId: string; items: Draft[] }>(`/api/drafts?creationType=${creation}`) });
  const detail = useQuery({ queryKey: ["draft", draftId], queryFn: () => api<{ datasetId: string; draft: Draft }>(`/api/drafts/${draftId}`), enabled: Boolean(draftId) });
  const draft = draftId ? detail.data?.draft : list.data?.items[0];
  const datasetId = detail.data?.datasetId ?? list.data?.datasetId;
  const carry: Partial<Draft> = {};
  for (const key of ["agentId", "productId", "workflowId"] as const) {
    if (params.get(key)) carry[key] = params.get(key);
  }
  if (params.get("assetId")) carry.assetIds = [params.get("assetId")!];
  if (params.get("skillId")) carry.skillIds = [params.get("skillId")!];
  const hasIncoming = Object.keys(carry).length > 0;
  useEffect(() => {
    localStorage.setItem("activeCreationType", creation);
    if (!type) { navigate(`/studio/${creation}${params.size ? `?${params}` : ""}`, { replace: true }); return; }
    if (draft && draft.creationType !== creation) { navigate(`/studio/${draft.creationType}/${draft.id}`, { replace: true }); return; }
    if (!draftId && !hasIncoming && draft) navigate(`/studio/${creation}/${draft.id}`, { replace: true });
  }, [creation, draftId, draft, hasIncoming, navigate, params, type]);
  const create = useMutation({
    mutationFn: (withIncoming: boolean) => {
      creationKey.current ??= crypto.randomUUID();
      return api<{ datasetId: string; draft: Draft }>("/api/drafts", { method: "POST", datasetId, idempotencyKey: creationKey.current, body: { creationType: creation, ...(withIncoming ? carry : {}) } });
    },
    onSuccess: (data) => {
      creationKey.current = null;
      client.setQueryData(["draft", data.draft.id], data);
      void client.invalidateQueries({ queryKey: ["drafts"] });
      navigate(`/studio/${data.draft.creationType}/${data.draft.id}`, { replace: true });
    },
  });
  const join = useMutation({
    mutationFn: () => api<{ datasetId: string; draft: Draft }>(`/api/drafts/${draft?.id}/carry`, { method: "POST", datasetId, body: { ...carry, revision: draft?.revision } }),
    onSuccess: (data) => {
      client.setQueryData(["draft", data.draft.id], data);
      void client.invalidateQueries({ queryKey: ["drafts"] });
      navigate(`/studio/${data.draft.creationType}/${data.draft.id}`, { replace: true });
    },
  });
  return (
    <>
      <PageHeader title={CREATION_TYPE_LABELS[creation]} description="组织需求、素材、制作演示和成果。" />
      <div className="toolbar" aria-label="创作类型">
        {Object.entries(CREATION_TYPE_LABELS).map(([key, label]) => <Link className="btn btn-secondary" key={key} to={`/studio/${key}`}>{label}</Link>)}
      </div>
      {(list.isError || detail.isError) && <p role="alert">{errorMessage(list.error ?? detail.error)}</p>}
      {create.isError && !hasIncoming && <p role="alert">{errorMessage(create.error)}</p>}
      {draft && datasetId ? <DraftEditor key={`${draft.id}-${draft.revision}`} initial={draft} datasetId={datasetId} onNew={() => create.mutate(false)} /> : (
        <EmptyState title={list.isLoading ? "正在读取草稿" : "还没有草稿"} description="新建草稿后可组织需求、选择资料并自动保存。" action={<Button variant="primary" disabled={list.isLoading || create.isPending} onClick={() => create.mutate(hasIncoming)}>新建草稿</Button>} />
      )}
      <Modal open={hasIncoming && !list.isLoading && !detail.isLoading} title="带入创作资料" onClose={() => {
        navigate(draft ? `/studio/${draft.creationType}/${draft.id}` : `/studio/${creation}`, { replace: true });
      }} footer={<>
        {draft && <Button disabled={join.isPending} onClick={() => join.mutate()}>加入当前草稿</Button>}
        <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate(true)}>新建草稿并带入</Button>
      </>}>
        <p>{draft ? `当前草稿为「${draft.name}」。请选择加入当前草稿或新建草稿。` : "选择新建草稿并带入本次资料。"}</p>
        {(create.isError || join.isError) && <p role="alert">{errorMessage(create.error ?? join.error)}</p>}
      </Modal>
    </>
  );
}
