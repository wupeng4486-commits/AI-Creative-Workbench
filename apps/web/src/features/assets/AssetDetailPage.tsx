import { useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

export function AssetDetailPage() {
  const { id } = useParams();
  return (
    <>
      <PageHeader title="资产详情" description="实际类型、大小、来源与备注。" />
      <EmptyState title="资产详情待加载" description={`资源标识：${id}`} />
    </>
  );
}
