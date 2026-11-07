import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Button } from "../../components/Button.tsx";

export function AgentsPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="智能体"
        description="用户创建或与用户共享的团队智能体目录。"
        actions={<Button variant="primary" onClick={() => navigate("/agents?new=1")}>新建智能体</Button>}
      />
      <EmptyState title="尚未选择筛选条件" description="本机示例智能体会在加载后显示。" />
    </>
  );
}
