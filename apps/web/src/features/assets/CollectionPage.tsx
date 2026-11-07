import { useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

export function CollectionPage() {
  const { id } = useParams();
  return (
    <>
      <PageHeader title="案例集详情" description="引用的资产、分类与说明。" />
      <EmptyState title="案例集待加载" description={`资源标识：${id}`} />
    </>
  );
}
