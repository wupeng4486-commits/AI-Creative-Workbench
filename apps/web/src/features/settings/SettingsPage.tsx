import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

export function SettingsPage() {
  return (
    <>
      <PageHeader title="数据与设置" description="本地数据概况、备份恢复、集成配置与显示偏好。" />
      <EmptyState title="设置待加载" />
    </>
  );
}
