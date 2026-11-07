import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

export function WorkflowsPage() {
  return (
    <>
      <PageHeader title="工作流" description="团队工作流与 LibTV 工作流入口。" />
      <EmptyState title="工作流目录待加载" />
    </>
  );
}
