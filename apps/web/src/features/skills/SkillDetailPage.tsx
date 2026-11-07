import { useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

export function SkillDetailPage() {
  const { id } = useParams();
  return (
    <>
      <PageHeader title="技能详情" description="输入要求、步骤、输出格式与示例。" />
      <EmptyState title="技能详情待加载" description={`资源标识：${id}`} />
    </>
  );
}
