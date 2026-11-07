import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Button } from "../../components/Button.tsx";
import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <>
      <PageHeader
        title="首页总览"
        description="团队共享内容、数量概览、最近动态与快捷入口。"
        actions={<Link className="btn btn-primary" to="/studio">开始创作</Link>}
      />
      <section aria-label="数量看板" className="stat-grid">
        {[
          { label: "团队智能体", to: "/agents" },
          { label: "团队技能", to: "/skills" },
          { label: "共享文件", to: "/assets?origin=shared" },
          { label: "团队工作流", to: "/workflows" },
        ].map((item) => (
          <Link key={item.label} className="stat-card" to={item.to}>
            <span>{item.label}</span>
            <strong>—</strong>
          </Link>
        ))}
      </section>
      <EmptyState
        title="正在加载团队内容"
        description="本地数据准备完成后，这里会显示共享内容、最近使用和本机动态。"
        action={<Button onClick={() => window.location.reload()}>重新加载</Button>}
      />
    </>
  );
}
