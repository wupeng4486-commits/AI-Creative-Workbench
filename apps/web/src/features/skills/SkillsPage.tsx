import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SearchInput } from "../../components/SearchInput.tsx";
import { SourceFilter, type SourceValue } from "../../components/SourceFilter.tsx";
import { Button } from "../../components/Button.tsx";
import { Badge } from "../../components/Badge.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Modal } from "../../components/Modal.tsx";
import { FieldError } from "../../components/FieldError.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { Skill } from "../../lib/types.ts";

const SCENARIOS = ["AI 视频", "AI 图片", "美工", "素材整理", "交付检查"];

export function SkillsPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [origin, setOrigin] = useState<SourceValue>((params.get("origin") as SourceValue) ?? "all");
  const [scenario, setScenario] = useState(params.get("scenario") ?? "");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [form, setForm] = useState({ name: "", scenario: "AI 视频", skillType: "platform" });
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["skills", search, origin, scenario],
    queryFn: () => {
      const queryParams = new URLSearchParams();
      if (search) queryParams.set("search", search);
      if (origin !== "all") queryParams.set("origin", origin);
      if (scenario) queryParams.set("scenario", scenario);
      return api<{ items: Skill[]; scenarios: string[] }>(`/api/skills?${queryParams.toString()}`);
    },
  });
  const create = useMutation({
    mutationFn: () =>
      api<{ skill: Skill }>("/api/skills", {
        method: "POST",
        body: {
          name: form.name,
          scenario: form.scenario,
          skillType: form.skillType,
          tags: [],
          inputSpec: "",
          steps: "",
          outputSpec: "",
          examples: "",
        },
      }),
    onSuccess: (data) => {
      void client.invalidateQueries({ queryKey: ["skills"] });
      setCreating(false);
      navigate(`/skills/${data.skill.id}`);
    },
    onError: (mutationError) => setCreateError(errorMessage(mutationError)),
  });
  const copy = useMutation({
    mutationFn: (id: string) => api<{ skill: Skill }>(`/api/skills/${id}/copy`, { method: "POST" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["skills"] }),
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  const syncQuery = (next: { search?: string; origin?: SourceValue; scenario?: string }) => {
    const merged = { search, origin, scenario, ...next };
    const nextParams = new URLSearchParams();
    if (merged.search) nextParams.set("search", merged.search);
    if (merged.origin !== "all") nextParams.set("origin", merged.origin);
    if (merged.scenario) nextParams.set("scenario", merged.scenario);
    setParams(nextParams, { replace: true });
  };
  const items = query.data?.items ?? [];
  const hasFilter = Boolean(search || scenario || origin !== "all");

  return (
    <>
      <PageHeader
        title="技能"
        description="沉淀可复用的指令、方法、规范与示例。平台技能与 LibTV 引用分别标识。"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> 新建技能
          </Button>
        }
      />
      <div className="toolbar">
        <SearchInput
          label="搜索技能"
          value={search}
          placeholder="名称、场景或正文"
          onChange={(value) => {
            setSearch(value);
            syncQuery({ search: value });
          }}
        />
        <SourceFilter
          value={origin}
          onChange={(value) => {
            setOrigin(value);
            syncQuery({ origin: value });
          }}
        />
        <select
          aria-label="场景筛选"
          value={scenario}
          onChange={(event) => {
            setScenario(event.target.value);
            syncQuery({ scenario: event.target.value });
          }}
        >
          <option value="">全部场景</option>
          {(query.data?.scenarios ?? SCENARIOS).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      {items.length === 0 ? (
        <EmptyState
          title={hasFilter ? "没有符合筛选的技能" : "还没有技能"}
          description={hasFilter ? "尝试清除筛选，或新建一条技能。" : "把团队的方法写成可复用的正文。"}
          action={
            hasFilter ? (
              <Button
                onClick={() => {
                  setSearch("");
                  setScenario("");
                  setOrigin("all");
                  setParams({}, { replace: true });
                }}
              >
                清除筛选
              </Button>
            ) : (
              <Button onClick={() => setCreating(true)}>新建技能</Button>
            )
          }
        />
      ) : (
        <div className="grid-cards">
          {items.map((skill) => (
            <article className="card" key={skill.id}>
              <div className="card-head">
                <div>
                  <h3>
                    <Link to={`/skills/${skill.id}`}>{skill.name}</Link>
                  </h3>
                  <p>{skill.scenario}</p>
                </div>
                <Badge tone={skill.skill_type === "libtv_reference" ? "demo" : "neutral"}>
                  {skill.skill_type === "libtv_reference" ? "LibTV 引用" : "平台技能"}
                </Badge>
              </div>
              <p className="hint">{skill.steps.slice(0, 80) || skill.input_spec || "尚未填写正文"}</p>
              <div className="card-meta">
                <Badge tone={skill.origin === "shared" ? "shared" : "neutral"}>
                  {skill.origin === "shared" ? "与我共享的" : "我创建的"}
                </Badge>
                {skill.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
                <span>{skill.agents.length} 个智能体</span>
              </div>
              <div className="card-actions">
                <Button variant="ghost" onClick={() => copy.mutate(skill.id)}>
                  <Copy size={14} /> 复制
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal
        open={creating}
        title="新建技能"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!form.name.trim()) {
                  setCreateError("技能名称不能为空。");
                  return;
                }
                setCreateError(null);
                create.mutate();
              }}
            >
              创建并编辑
            </Button>
          </>
        }
      >
        <label className="field">
          <span className="label">名称 *</span>
          <input aria-label="技能名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <FieldError message={createError} />
        </label>
        <label className="field">
          <span className="label">适用场景 *</span>
          <select aria-label="适用场景" value={form.scenario} onChange={(event) => setForm({ ...form, scenario: event.target.value })}>
            {SCENARIOS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">技能类型</span>
          <select aria-label="技能类型" value={form.skillType} onChange={(event) => setForm({ ...form, skillType: event.target.value })}>
            <option value="platform">平台技能</option>
            <option value="libtv_reference">LibTV 引用</option>
          </select>
        </label>
      </Modal>
    </>
  );
}
