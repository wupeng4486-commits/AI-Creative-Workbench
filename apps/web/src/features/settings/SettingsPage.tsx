import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { formatBytes } from "@workbench/shared";

export function SettingsPage() {
  const info = useQuery({
    queryKey: ["system-info"],
    queryFn: () =>
      api<{
        dataDir: string;
        datasetId: string;
        version: string;
        counts: Record<string, number>;
        disk: { freeBytes: number | null };
      }>("/api/system/info"),
  });
  return (
    <>
      <PageHeader title="数据与设置" description="本地数据概况、备份恢复、集成配置与显示偏好。" />
      {info.isLoading ? (
        <EmptyState title="正在读取本机数据" />
      ) : info.isError || !info.data ? (
        <EmptyState title="无法读取本机数据" description={errorMessage(info.error)} />
      ) : (
        <section className="grid-cards">
          <article className="card">
            <h3>数据位置</h3>
            <code>{info.data.dataDir}</code>
          </article>
          <article className="card">
            <h3>数据集</h3>
            <code>{info.data.datasetId}</code>
            <p className="hint">版本 {info.data.version}</p>
          </article>
          <article className="card">
            <h3>记录数量</h3>
            <ul>
              {Object.entries(info.data.counts).map(([key, value]) => (
                <li key={key}>
                  {key}: {value}
                </li>
              ))}
            </ul>
          </article>
          <article className="card">
            <h3>可用空间</h3>
            <p>{formatBytes(info.data.disk.freeBytes)}</p>
          </article>
        </section>
      )}
    </>
  );
}
