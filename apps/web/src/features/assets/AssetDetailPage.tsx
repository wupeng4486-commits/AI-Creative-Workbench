import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Badge } from "../../components/Badge.tsx";
import { MediaPreview } from "../../components/MediaPreview.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { errorMessage } from "../../lib/api.ts";
import { formatBytes, formatDuration } from "@workbench/shared";
import { useAsset } from "./useAssets.ts";

export function AssetDetailPage() {
  const { id } = useParams();
  const query = useAsset(id);
  if (query.isLoading) return <PageHeader title="资产详情" description="正在读取本机文件…" />;
  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="资产详情" />
        <EmptyState title="资产不存在" description={errorMessage(query.error)} />
      </>
    );
  }
  const { asset, references } = query.data;
  return (
    <>
      <PageHeader
        title="资产详情"
        description="实际类型、大小、来源与备注。"
        actions={
          <><Link className="btn btn-primary" to={`/studio?assetId=${asset.id}`}>用于创作</Link>{asset.downloadUrl ? (
            <a className="btn" href={asset.downloadUrl} download>
              下载原文件
            </a>
          ) : null}</>
        }
      />
      <div className="detail-grid">
        <article className="card">
          <h3>{asset.name}</h3>
          <MediaPreview kind={asset.previewKind} url={asset.contentUrl} name={asset.name} downloadUrl={asset.downloadUrl} />
        </article>
        <article className="card">
          <h3>文件信息</h3>
          <dl className="kv">
            <dt>类型</dt>
            <dd>{asset.file?.mime_type ?? "—"}</dd>
            <dt>大小</dt>
            <dd>{formatBytes(asset.file?.size)}</dd>
            <dt>时长</dt>
            <dd>{formatDuration(asset.file?.duration)}</dd>
            <dt>尺寸</dt>
            <dd>{asset.file?.width ? `${asset.file.width}×${asset.file.height}` : "—"}</dd>
            <dt>来源</dt>
            <dd>{asset.origin === "shared" ? "与我共享的" : "我创建的"}</dd>
            <dt>出处</dt>
            <dd>{asset.provenance}</dd>
            <dt>校验值</dt>
            <dd>
              <code>{asset.file?.sha256.slice(0, 16)}…</code>
            </dd>
          </dl>
          <div className="card-meta">
            {asset.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
          {references.length > 0 && (
            <div>
              <h3>当前引用</h3>
              <ul>
                {references.map((ref) => (
                  <li key={ref.id + ref.label}>{ref.label}</li>
                ))}
              </ul>
            </div>
          )}
        </article>
      </div>
    </>
  );
}
