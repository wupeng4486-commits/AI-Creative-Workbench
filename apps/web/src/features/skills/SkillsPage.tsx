import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

export function SkillsPage() {
  return (
    <>
      <PageHeader title="技能" description="用户创建或与用户共享的方法、指令和规范。" />
      <EmptyState title="技能目录待加载" />
    </>
  );
}
