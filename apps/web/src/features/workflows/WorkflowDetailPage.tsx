import { useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

export function WorkflowDetailPage() {
  const { id } = useParams();
  return (
    <>
      <PageHeader title="工作流详情" description="用途、流程预览、输入要求与默认参数。" />
      <EmptyState title="工作流详情待加载" description={`资源标识：${id}`} />
    </>
  );
}
