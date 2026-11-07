import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Button } from "../../components/Button.tsx";
import { Badge } from "../../components/Badge.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { formatBytes, formatDuration } from "@workbench/shared";

interface CollectionItem {
  id: string;
  name: string;
  category: string;
  mime_type: string | null;
  size: number | null;
  duration: number | null;
  tags: string[];
}

interface CollectionDetail {
  collection: { id: string; name: string; purpose: string; category: string; description: string };
  items: CollectionItem[];
}

export function CollectionPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const [assetId, setAssetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["collection", id],
    queryFn: () => api<CollectionDetail>(`/api/collections/${id}`),
    enabled: Boolean(id),
  });
  const assets = useQuery({
    queryKey: ["assets", "collection-picker"],
    queryFn: () => api<{ items: Array<{ id: string; name: string }> }>("/api/assets"),
  });
  const add = useMutation({
    mutationFn: () =>
      api(`/api/collections/${id}/items`, { method: "POST", body: { assetId } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["collection", id] });
      void client.invalidateQueries({ queryKey: ["collections"] });
      setAssetId("");
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const remove = useMutation({
    mutationFn: (itemId: string) =>
      api(`/api/collections/${id}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["collection", id] });
      void client.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  if (query.isLoading) return <PageHeader title="案例集详情" description="正在读取…" />;
  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="案例集详情" />
        <EmptyState title="案例集不存在" description={errorMessage(query.error)} />
      </>
    );
  }
  const { collection, items } = query.data;
  return (
    <>
      <PageHeader
        title="案例集详情"
        description={collection.purpose || collection.description || "引用的资产、分类与说明。"}
      />
      <div className="toolbar">
        <select aria-label="选择资产" value={assetId} onChange={(event) => setAssetId(event.target.value)}>
          <option value="">选择要加入的资产</option>
          {(assets.data?.items ?? []).map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
        <Button variant="primary" disabled={!assetId} onClick={() => add.mutate()}>
          加入案例集
        </Button>
        <Badge>{collection.category}</Badge>
      </div>
      {error && <p role="alert">{error}</p>}
      {items.length === 0 ? (
        <EmptyState title="案例集还没有资产" description="从上方选择资产加入，原文件不会被复制。" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>大小</th>
              <th>时长</th>
              <th>标签</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.mime_type ?? "—"}</td>
                <td>{formatBytes(item.size)}</td>
                <td>{formatDuration(item.duration)}</td>
                <td>
                  {item.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </td>
                <td>
                  <Button variant="ghost" onClick={() => remove.mutate(item.id)}>
                    移出
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
