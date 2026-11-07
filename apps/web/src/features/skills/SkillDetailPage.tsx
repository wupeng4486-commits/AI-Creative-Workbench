import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Button } from "../../components/Button.tsx";
import { Badge } from "../../components/Badge.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { SaveStatus, type SaveState } from "../../components/SaveStatus.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { Skill } from "../../lib/types.ts";

interface SkillDetail {
  skill: Skill;
  agents: Array<{ id: string; name: string }>;
  workflows: Array<{ id: string; name: string }>;
}

const TEXT_FIELDS: Array<{ key: keyof Skill; label: string }> = [
  { key: "input_spec", label: "输入要求" },
  { key: "steps", label: "步骤或指令正文" },
  { key: "output_spec", label: "输出格式" },
  { key: "examples", label: "示例" },
];

export function SkillDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["skill", id],
    queryFn: () => api<SkillDetail>(`/api/skills/${id}`),
    enabled: Boolean(id),
  });
  const [draft, setDraft] = useState<Skill | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkAgent, setLinkAgent] = useState("");

  useEffect(() => {
    const skill = query.data?.skill;
    if (!skill) return;
    setDraft((current) =>
      current?.id === skill.id
        ? { ...current, agents: skill.agents, workflows: skill.workflows }
        : skill,
    );
  }, [query.data]);

  useEffect(() => {
    setState("idle");
    setError(null);
    setLinkAgent("");
  }, [id]);

  const save = useMutation({
    onMutate: () => setState("saving"),
    mutationFn: () =>
      api<{ skill: Skill }>(`/api/skills/${id}`, {
        method: "PATCH",
        body: {
          name: draft?.name,
          scenario: draft?.scenario,
          tags: draft?.tags,
          inputSpec: draft?.input_spec,
          steps: draft?.steps,
          outputSpec: draft?.output_spec,
          examples: draft?.examples,
          externalRef: draft?.external_ref,
          skillType: draft?.skill_type,
        },
      }),
    onSuccess: (data) => {
      setState("saved");
      setDraft(data.skill);
      setError(null);
      void client.invalidateQueries({ queryKey: ["skill", id] });
      void client.invalidateQueries({ queryKey: ["skills"] });
    },
    onError: (mutationError) => {
      setState("error");
      setError(errorMessage(mutationError));
    },
  });
  const link = useMutation({
    mutationFn: () =>
      api(`/api/skills/${id}/links`, {
        method: "PUT",
        body: {
          agentIds: Array.from(new Set([
            ...(draft?.agents.map((agent) => agent.id) ?? []),
            linkAgent,
          ])),
        },
      }),
    onSuccess: () => {
      setLinkAgent("");
      void client.invalidateQueries({ queryKey: ["skill", id] });
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const copy = useMutation({
    mutationFn: () => api<{ skill: Skill }>(`/api/skills/${id}/copy`, { method: "POST" }),
    onSuccess: (data) => {
      void client.invalidateQueries({ queryKey: ["skills"] });
      navigate(`/skills/${data.skill.id}`);
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/skills/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["skills"] });
      navigate("/skills");
    },
    onError: (mutationError) => {
      setConfirmDelete(false);
      setError(errorMessage(mutationError));
    },
  });

  if (query.isLoading || (!draft && !query.isError)) {
    return <PageHeader title="技能详情" description="正在读取正文…" />;
  }
  if (query.isError || !draft) {
    return (
      <>
        <PageHeader title="技能详情" />
        <EmptyState title="技能不存在" description={errorMessage(query.error)} />
      </>
    );
  }
  const owned = draft.origin === "owned";
  const bind = (key: keyof Skill, label: string) => ({
    "aria-label": label,
    value: key === "tags" ? draft.tags.join(", ") : String(draft[key] ?? ""),
    disabled: !owned || save.isPending,
    onChange: (event: { target: { value: string } }) => {
      setState("idle");
      setDraft(
        key === "tags"
          ? {
              ...draft,
              tags: event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            }
          : { ...draft, [key]: event.target.value },
      );
    },
  });

  return (
    <>
      <PageHeader
        title="技能详情"
        description="输入要求、步骤、输出格式与示例。"
        actions={
          <>
            <Button onClick={() => copy.mutate()}>
              <Copy size={15} /> 复制为我的技能
            </Button>
            {owned && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} /> 删除
              </Button>
            )}
          </>
        }
      />
      <div className="detail-grid">
        <article className="card">
          <div className="card-meta">
            <Badge tone={draft.origin === "shared" ? "shared" : "neutral"}>
              {draft.origin === "shared" ? "与我共享的" : "我创建的"}
            </Badge>
            <Badge tone={draft.skill_type === "libtv_reference" ? "demo" : "neutral"}>
              {draft.skill_type === "libtv_reference" ? "LibTV 引用" : "平台技能"}
            </Badge>
            <span>{draft.author}</span>
          </div>
          <div className="form-grid">
            <label className="field">
              <span className="label">名称</span>
              <input {...bind("name", "名称")} />
            </label>
            <label className="field">
              <span className="label">适用场景</span>
              <input {...bind("scenario", "适用场景")} />
            </label>
            <label className="field">
              <span className="label">标签</span>
              <input {...bind("tags", "标签")} />
            </label>
          </div>
          {TEXT_FIELDS.map((field) => (
            <label className="field" key={String(field.key)}>
              <span className="label">{field.label}</span>
              <textarea rows={field.key === "steps" ? 10 : 4} {...bind(field.key, field.label)} />
            </label>
          ))}
          <label className="field">
            <span className="label">外部引用（LibTV 引用信息）</span>
            <input {...bind("external_ref", "外部引用（LibTV 引用信息）")} />
          </label>
          <div className="card-actions">
            <Button variant="primary" disabled={!owned || save.isPending} onClick={() => save.mutate()}>
              保存正文
            </Button>
            <SaveStatus state={state} detail={error ?? undefined} onRetry={() => save.mutate()} />
          </div>
          {error && state !== "error" && <p role="alert">{error}</p>}
        </article>
        <article className="card">
          <h3>关联使用</h3>
          <div>
            <strong>智能体</strong>
            <ul>
              {draft.agents.map((agent) => (
                <li key={agent.id}><Link to={`/agents/${agent.id}`}>{agent.name}</Link></li>
              ))}
              {draft.agents.length === 0 && <li className="hint">尚未关联智能体</li>}
            </ul>
            <div className="toolbar">
              <select
                aria-label="选择智能体"
                value={linkAgent}
                onChange={(event) => setLinkAgent(event.target.value)}
              >
                <option value="">选择智能体</option>
                {(query.data?.agents ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <Button disabled={!linkAgent || link.isPending} onClick={() => link.mutate()}>
                关联
              </Button>
            </div>
          </div>
          <div>
            <strong>工作流</strong>
            <ul>
              {draft.workflows.map((workflow) => (
                <li key={workflow.id}><Link to={`/workflows/${workflow.id}`}>{workflow.name}</Link></li>
              ))}
              {draft.workflows.length === 0 && <li className="hint">尚未关联流程</li>}
            </ul>
          </div>
          <p className="hint">共享技能可查看与复制；编辑与删除仅对自己创建的版本开放。</p>
        </article>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="删除技能"
        description="删除后不可恢复。仍被智能体、流程或草稿引用时会先提示引用位置。"
        danger
        confirmLabel="确认删除"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
