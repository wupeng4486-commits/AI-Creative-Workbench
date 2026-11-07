import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

export function ConnectorsPage() {
  return (
    <>
      <PageHeader title="连接器" description="软件与创作工具目录、演示配置及模拟记录。" />
      <EmptyState title="连接器目录待加载" description="所有状态均为本地演示。" />
    </>
  );
}
