import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { type HomeOverview, RESOURCE_LABELS } from "./types.ts";

export function HomePage() {
  const [params, setParams] = useSearchParams();
  const type = params.get("type") ?? "all";
  const query = useQuery({ queryKey: ["home", type], queryFn: () => api<HomeOverview>(`/api/home?type=${type}`) });
  const data = query.data;
  return <>
    <PageHeader title="首页总览" description="团队共享内容、数量概览、最近动态与快捷入口。" />
    <section aria-label="快捷操作" className="toolbar">
      <Link className="btn btn-primary" to="/studio">开始创作</Link>
      <Link className="btn" to="/agents?new=1">新建智能体</Link>
      <Link className="btn" to="/skills?new=1">新建技能</Link>
      <Link className="btn" to="/assets?import=1">导入文件</Link>
    </section>
    <section aria-label="数量看板" className="stat-grid">
      {[
        { label: "团队智能体", to: "/agents", count: data?.counts.agents },
        { label: "团队技能", to: "/skills", count: data?.counts.skills },
        { label: "共享文件", to: "/assets?origin=shared&filesOnly=1", count: data?.counts.sharedFiles },
        { label: "团队工作流", to: "/workflows", count: data?.counts.workflows },
      ].map((item) => <Link key={item.label} className="stat-card" to={item.to}><span>{item.label}</span><strong>{item.count ?? "—"}</strong></Link>)}
    </section>
    {query.isError && <EmptyState title="无法读取首页" description={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
    {query.isLoading && <p role="status">正在读取本机内容…</p>}
    <section aria-label="团队共享内容" className="section">
      <h2>团队共享内容</h2>
      <div className="segmented" aria-label="共享类型">
        {Object.entries({ all: "全部", ...RESOURCE_LABELS }).map(([value, label]) => <Button key={value} aria-pressed={type === value} onClick={() => setParams(value === "all" ? {} : { type: value })}>{label}</Button>)}
      </div>
      <div className="grid-cards">
        {data?.shared.map((item) => <article className="card" key={`${item.type}:${item.id}`}>
          <Badge tone="shared">与我共享的</Badge> <Badge>{RESOURCE_LABELS[item.type]}</Badge> {item.demo && <Badge tone="demo">示例</Badge>}
          <h3><Link to={item.href}>{item.name}</Link></h3><p>{item.description}</p><time>{item.updatedAt}</time>
          <div className="toolbar"><Link className="btn" to={item.href}>{item.type === "asset" || item.type === "workflow" ? "预览" : "查看"}</Link>
            {item.type === "agent" && <Link className="btn" to={`/studio?agentId=${item.id}`}>去创作</Link>}
            {item.type === "workflow" && <Link className="btn" to={`${item.href}?use=1`}>使用流程</Link>}
          </div>
        </article>)}
      </div>
      {data && !data.shared.length && <EmptyState title="暂无共享内容" description="选择其他类型查看。" action={<Button onClick={() => setParams({})}>查看全部</Button>} />}
    </section>
    <div className="detail-grid">
      <section className="card" aria-label="最近使用"><h2>最近使用</h2><ul>{data?.recent.map((item) => <li key={`${item.type}:${item.id}`}><Link to={item.href}>{item.name}</Link> {item.demo && <Badge tone="demo">示例</Badge>}</li>)}</ul>{data && !data.recent.length && <p>尚无使用记录</p>}</section>
      <section className="card" aria-label="本机动态"><h2>本机动态</h2><ul>{data?.activities.map((item) => <li key={item.id}>{item.href ? <Link to={item.href}>{item.action}</Link> : <span>{item.action}（记录已移除）</span>} <Badge tone={item.demo ? "demo" : "neutral"}>{item.demo ? "示例 / 演示" : "本机操作"}</Badge><p className="hint">{item.createdAt}</p></li>)}</ul>{data && !data.activities.length && <p>尚无本机动态</p>}</section>
    </div>
  </>;
}
