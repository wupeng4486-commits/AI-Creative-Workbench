import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { formatBytes } from "@workbench/shared";
import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { BackupPanel, reloadDataset } from "./BackupPanel.tsx";
import { IntegrationSettings } from "./IntegrationSettings.tsx";

export function SettingsPage() {
  const [clearing, setClearing] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(() => sessionStorage.getItem("dataset-operation") ?? "");
  const [error, setError] = useState("");
  const info = useQuery({
    queryKey: ["system-info"],
    queryFn: () =>
      api<{
        dataDir: string;
        datasetId: string;
        version: string;
        counts: Record<string, number>;
        disk: { freeBytes: number | null };
        lastBackup: { createdAt: string; size: number } | null;
      }>("/api/system/info"),
  });
  return (
    <>
      <PageHeader title="数据与设置" description="本地数据概况、备份恢复、集成配置与显示偏好。" />
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
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
            <h3>最近备份</h3><p>{info.data.lastBackup ? `${info.data.lastBackup.createdAt} · ${formatBytes(info.data.lastBackup.size)}` : "尚无完整备份"}</p>
          </article>
        </section>
      )}
      {info.data && <BackupPanel datasetId={info.data.datasetId} />}
      <IntegrationSettings />
      <section className="card" aria-label="数据维护"><h2>数据维护</h2><p>补充缺失示例会保留已有资料及其修改。清空将启用新的空数据集，原完整数据集保留在本机。</p>
        <Button disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { const result = await api<{ message: string }>("/api/system/seed", { method: "POST" }); setMessage(result.message); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
        }}>补充缺失示例</Button> <Button variant="danger" disabled={busy || !info.data} onClick={() => { setClearing(true); setConfirmation(""); }}>清空本机数据</Button>
      </section>
      <Modal open={clearing} title="二次确认清空数据" onClose={() => { if (!busy) setClearing(false); }} footer={<><Button disabled={busy} onClick={() => setClearing(false)}>取消</Button><Button variant="danger" disabled={busy || confirmation !== "清空本机数据"} onClick={async () => {
        setBusy(true); setError("");
        try { await api("/api/system/reset", { method: "POST", datasetId: info.data!.datasetId, body: { datasetId: info.data!.datasetId, confirmation } }); reloadDataset("已启用空数据集，可按需补充示例或恢复完整备份。"); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
      }}>确认清空并切换</Button></>}><p>当前资料、草稿、文件、历史与配置将从工作区清空。可先取消并导出完整备份。</p><label className="field">输入“清空本机数据”<input aria-label="清空确认文字" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{error && <p role="alert">{error}</p>}</Modal>
    </>
  );
}
