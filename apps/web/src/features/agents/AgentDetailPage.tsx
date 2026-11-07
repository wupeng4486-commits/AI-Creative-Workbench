import { useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

export function AgentDetailPage() {
  const { id } = useParams();
  return (
    <>
      <PageHeader title="智能体详情" description="概览、指令配置、知识与技能、示例对话。" />
      <EmptyState title="智能体详情待加载" description={`资源标识：${id}`} />
    </>
  );
}
