import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api.ts";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { formatBytes } from "@workbench/shared";

interface Backup { id: string; status: string; file_name: string; size: number; message: string; created_at: string }
interface Preview { id: string; sourceName: string; exportedAt: string; recordCounts: Record<string, number>; fileCount: number; status: string }

export function reloadDataset(message: string) {
  sessionStorage.setItem("dataset-operation", message);
  window.location.assign("/settings");
}

export function BackupPanel({ datasetId }: { datasetId: string }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [backupFirst, setBackupFirst] = useState(true);
  const backups = useQuery({ queryKey: ["backups"], queryFn: () => api<{ items: Backup[] }>("/api/backups") });
  const restores = useQuery({ queryKey: ["restores"], queryFn: () => api<{ items: Preview[] }>("/api/restores") });
  const refresh = () => { void client.invalidateQueries({ queryKey: ["backups"] }); void client.invalidateQueries({ queryKey: ["restores"] }); };
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); refresh(); }
  }
  const cancel = () => void run(async () => {
    await api(`/api/restores/${preview!.id}/cancel`, { method: "POST", datasetId });
    setPreview(null); setMessage("已取消恢复，当前数据继续使用。");
  });
  return <section className="card section" aria-label="完整备份与恢复">
    <h2>完整备份与恢复</h2>
    <p>完整包包含数据库、原文件、草稿、历史及共用配置。恢复确认后切换整个数据集。</p>
    <div className="toolbar">
      <Button variant="primary" disabled={busy} onClick={() => void run(async () => {
        await api("/api/backups", { method: "POST", datasetId }); setMessage("完整备份已生成，可下载保存。");
      })}>导出完整备份</Button>
      <label className="field">上传备份并校验<input aria-label="上传备份并校验" type="file" accept=".zip" disabled={busy || Boolean(preview)} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void run(async () => {
          const form = new FormData(); form.append("file", file);
          const result = await api<{ preview: Preview }>("/api/restores/upload", { method: "POST", datasetId, body: form });
          setPreview(result.preview);
        });
      }} /></label>
    </div>
    {busy && <p role="status">正在处理，请等待完成…</p>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {backups.isError && <p role="alert">{errorMessage(backups.error)}</p>}
    <ul>{backups.data?.items.map((item) => <li key={item.id}>{item.created_at} · {formatBytes(item.size)} · {item.status === "ready" ? <a href={`/api/backups/${item.id}/download`} download>下载完整备份</a> : <span>{item.status === "failed" ? `失败 ${item.message}` : "正在备份"}</span>}</li>)}</ul>
    <h3>恢复记录</h3>
    {restores.isError && <p role="alert">{errorMessage(restores.error)}</p>}
    <ul>{restores.data?.items.map((item) => <li key={item.id}>{item.sourceName} · {item.status} {item.status === "preview" && <Button disabled={busy} onClick={() => setPreview(item)}>查看恢复预览</Button>}</li>)}</ul>
    <Modal open={Boolean(preview)} title="确认完整恢复" onClose={() => { if (!busy) cancel(); }} footer={<><Button disabled={busy} onClick={cancel}>取消恢复</Button><Button variant="danger" disabled={busy} onClick={() => void run(async () => {
      await api(`/api/restores/${preview!.id}/confirm`, { method: "POST", datasetId, body: { datasetId, backupFirst } });
      reloadDataset("完整恢复成功，已重新读取当前数据集。");
    })}>确认替换当前数据集</Button></>}>
      <p>将以这个完整备份替换当前资料、原文件、草稿、顺序、历史和设置。</p>
      <p>备份时间 {preview?.exportedAt}</p><p>原文件 {preview?.fileCount} 个</p>
      <dl className="kv">{Object.entries(preview?.recordCounts ?? {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      <label><input type="checkbox" checked={backupFirst} disabled={busy} onChange={(event) => setBackupFirst(event.target.checked)} />恢复前先导出当前完整备份</label>
      {error && <p role="alert">{error}</p>}
    </Modal>
  </section>;
}
