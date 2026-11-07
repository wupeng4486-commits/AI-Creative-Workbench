import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

export function AssetsPage() {
  return (
    <>
      <PageHeader title="资产库" description="商品知识、共享文件、媒体、案例与 NAS 入口。" />
      <EmptyState title="正在加载资产" description="导入文件后会在这里显示。" />
    </>
  );
}
