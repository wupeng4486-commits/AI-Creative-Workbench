import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { type HomeOverview, RESOURCE_LABELS } from "./types.ts";
import { BookOpen, Clock3, Files, GitBranch, Plus, Sparkles, Users } from "lucide-react";

const updatedTime = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" });

export function HomePage() {
  const [params, setParams] = useSearchParams();
  const type = params.get("type") ?? "all";
  const query = useQuery({ queryKey: ["home", type], queryFn: () => api<HomeOverview>(`/api/home?type=${type}`) });
  const data = query.data;
  return <>
    <PageHeader title="团队动态" eyebrow="团队工作空间" description="发现团队的经验与灵感，让每一次协作都有迹可循。" />
    <section aria-label="快捷操作" className="toolbar">
      <Link className="btn btn-primary" to="/studio"><Sparkles size={15} aria-hidden />开始创作</Link>
      <Link className="btn" to="/agents?new=1"><Plus size={15} aria-hidden />新建智能体</Link>
      <Link className="btn" to="/skills?new=1"><Plus size={15} aria-hidden />新建技能</Link>
      <Link className="btn" to="/assets?import=1"><Files size={15} aria-hidden />导入文件</Link>
    </section>
    <section aria-label="数量看板" className="stat-grid">
      {[
        { label: "团队智能体", to: "/agents", count: data?.counts.agents, icon: Users },
        { label: "团队技能", to: "/skills", count: data?.counts.skills, icon: BookOpen },
        { label: "共享文件", to: "/assets?origin=shared&filesOnly=1", count: data?.counts.sharedFiles, icon: Files },
        { label: "团队工作流", to: "/workflows", count: data?.counts.workflows, icon: GitBranch },
      ].map(({ label, to, count, icon: Icon }) => <Link key={label} className="stat-card" to={to}><span className="stat-label">{label}<Icon size={17} aria-hidden /></span><strong>{count ?? "—"}</strong><span className="stat-caption">查看团队资源</span></Link>)}
    </section>
    {query.isError && <EmptyState title="无法读取团队动态" description={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
    {query.isLoading && <p role="status">正在读取本机内容…</p>}
    <section aria-label="团队共享内容" className="section">
      <div className="section-title"><div><h2>团队共享内容</h2><p className="hint">好经验，值得被团队里的更多人看见。</p></div></div>
      <div className="segmented" aria-label="共享类型">
        {Object.entries({ all: "全部", ...RESOURCE_LABELS }).map(([value, label]) => <Button key={value} aria-pressed={type === value} onClick={() => setParams(value === "all" ? {} : { type: value })}>{label}</Button>)}
      </div>
      <div className="grid-cards">
        {data?.shared.map((item) => <article className="card shared-resource-card" key={`${item.type}:${item.id}`}>
          <div className="card-meta"><Badge tone="shared">与我共享的</Badge><Badge>{RESOURCE_LABELS[item.type]}</Badge>{item.demo && <Badge tone="demo">示例</Badge>}</div>
          <h3><Link to={item.href}>{item.name}</Link></h3><p className="resource-description">{item.description}</p><time className="resource-time" dateTime={item.updatedAt}><Clock3 size={12} aria-hidden />{updatedTime.format(new Date(item.updatedAt))}</time>
          <div className="card-actions"><Link className="btn" to={item.href}>{item.type === "asset" || item.type === "workflow" ? "预览" : "查看"}</Link>
            {item.type === "agent" && <Link className="btn" to={`/studio?agentId=${item.id}`}>去创作</Link>}
            {item.type === "workflow" && <Link className="btn" to={`${item.href}?use=1`}>使用流程</Link>}
          </div>
        </article>)}
      </div>
      {data && !data.shared.length && <EmptyState title="暂无共享内容" description="选择其他类型查看。" action={<Button onClick={() => setParams({})}>查看全部</Button>} />}
    </section>
    <div className="detail-grid">
      <section className="card" aria-label="最近使用"><h2>最近使用</h2><ul className="workspace-list">{data?.recent.map((item) => <li key={`${item.type}:${item.id}`}><Link to={item.href}>{item.name}</Link> {item.demo && <Badge tone="demo">示例</Badge>}</li>)}</ul>{data && !data.recent.length && <p className="hint">尚无使用记录</p>}</section>
      <section className="card" aria-label="本机动态"><h2>本机动态</h2><ul className="workspace-list">{data?.activities.map((item) => <li key={item.id}>{item.href ? <Link to={item.href}>{item.action}</Link> : <span>{item.action}（记录已移除）</span>} <Badge tone={item.demo ? "demo" : "neutral"}>{item.demo ? "示例 / 演示" : "本机操作"}</Badge><p className="hint">{updatedTime.format(new Date(item.createdAt))}</p></li>)}</ul>{data && !data.activities.length && <p className="hint">尚无本机动态</p>}</section>
    </div>
  </>;
}
