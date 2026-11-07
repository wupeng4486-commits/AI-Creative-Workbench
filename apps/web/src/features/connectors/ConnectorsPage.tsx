import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { DemoRun } from "../runs/RunPanel.tsx";

interface Connector {
  id: string;
  name: string;
  service_type: string;
  enabled: boolean;
  demo_config: { label: string; endpoint: string; note: string };
  simulation_status: string;
  last_simulated_at: string | null;
}
const STATUS: Record<string, string> = { unconfigured: "未配置", pending: "待模拟连接", connecting: "正在模拟连接", connected: "模拟连接成功", failed: "模拟连接失败", disabled: "已停用", syncing: "正在模拟同步" };
const RUN_STATUS: Record<string, string> = { queued: "已排队", running: "正在模拟", completed: "模拟完成", failed: "模拟失败", stopped: "已停止", interrupted: "已中断" };

export function ConnectorsPage() {
  const client = useQueryClient();
  const [editing, setEditing] = useState<Connector | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [serviceType, setServiceType] = useState("shopify");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const runs = useQuery({
    queryKey: ["connector-runs"], queryFn: () => api<{ items: DemoRun[] }>("/api/runs?owner=connector"),
    refetchInterval: (query) => query.state.data?.items.some((run) => ["queued", "running"].includes(run.status)) ? 300 : false,
  });
  const query = useQuery({
    queryKey: ["connectors"], queryFn: () => api<{ items: Connector[] }>("/api/connectors"),
    refetchInterval: runs.data?.items.some((run) => ["queued", "running"].includes(run.status)) ? 300 : false,
  });
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ["connectors"] });
  }, [runs.data, client]);
  const refresh = () => {
    for (const key of ["connectors", "connector-runs", "settings", "assets", "home"]) void client.invalidateQueries({ queryKey: [key] });
    setError(null);
  };
  const update = useMutation({
    mutationFn: (input: { id: string; enabled?: boolean; name?: string; config?: Connector["demo_config"] }) => api(`/api/connectors/${input.id}`, { method: "PATCH", body: input }),
    onSuccess: () => { setEditing(null); refresh(); }, onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const create = useMutation({
    mutationFn: () => api("/api/connectors", { method: "POST", body: { name: newName, serviceType } }),
    onSuccess: () => { setCreating(false); setNewName(""); refresh(); }, onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const simulate = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "connect" | "sync" }) => api(`/api/connectors/${id}/${action}`, { method: "POST", body: {} }),
    onSuccess: refresh, onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const stop = useMutation({ mutationFn: (id: string) => api(`/api/runs/${id}/stop`, { method: "POST" }), onSuccess: refresh, onError: (mutationError) => setError(errorMessage(mutationError)) });
  const retry = useMutation({ mutationFn: (id: string) => api(`/api/runs/${id}/retry`, { method: "POST" }), onSuccess: refresh, onError: (mutationError) => setError(errorMessage(mutationError)) });
  const importBatch = useMutation({
    mutationFn: (run: DemoRun) => api<{ importedCount: number; replayedCount: number }>(`/api/connectors/${run.ownerId}/import`, { method: "POST", body: { runId: run.id } }),
    onSuccess: (data) => { refresh(); setNotice(`本次导入 ${data.importedCount} 项示例，已有 ${data.replayedCount} 项无需重复导入。`); },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  return (
    <>
      <PageHeader title="连接器" description="软件与创作工具目录、演示配置及模拟记录。" actions={<Button variant="primary" onClick={() => { setError(null); setCreating(true); }}>添加演示连接</Button>} />
      <p className="hint">所有连接和同步均为本地模拟。这里只填写演示名称、接口位置和用途说明。</p>
      {(error || query.isError || runs.isError) && !editing && !creating && <p role="alert">{error ?? errorMessage(query.error ?? runs.error)}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="grid-cards">{query.data?.items.map((connector) => <article className="card" key={connector.id} aria-label={connector.name}>
        <h3>{connector.name}</h3><p>{connector.service_type}</p>
        <p>{STATUS[connector.simulation_status] ?? connector.simulation_status}</p>
        <p className="hint">{connector.demo_config.note || "配置后可模拟连接与同步。"}</p>
        <p>最近模拟 {connector.last_simulated_at ?? "尚未模拟"}</p>
        <div className="card-actions">
          <Button onClick={() => { setError(null); setEditing(structuredClone(connector)); }}>演示配置</Button>
          <Button onClick={() => update.mutate({ id: connector.id, enabled: !connector.enabled })} disabled={update.isPending}>{connector.enabled ? "停用" : "启用"}</Button>
          <Button disabled={!connector.enabled || simulate.isPending || ["connecting", "syncing"].includes(connector.simulation_status)} onClick={() => simulate.mutate({ id: connector.id, action: "connect" })}>模拟连接</Button>
          <Button disabled={!connector.enabled || connector.simulation_status !== "connected" || simulate.isPending} onClick={() => simulate.mutate({ id: connector.id, action: "sync" })}>模拟同步</Button>
        </div>
      </article>)}</div>
      <h2>模拟同步与连接记录</h2>
      {runs.data?.items.map((run) => <article className="card" key={run.id} aria-label={`模拟记录 ${run.id}`}>
        <h3>{RUN_STATUS[run.status] ?? run.status} · {run.parameters.action === "sync" ? "模拟同步" : "模拟连接"}</h3>
        <p>{run.message}</p><p className="hint">{run.id}</p>
        <ul>{run.items.map((item) => <li key={item.id}>{item.label} · {RUN_STATUS[item.status] ?? item.status} · {item.message}</li>)}</ul>
        <details><summary>模拟日志</summary><ul>{run.result.logs?.map((log, index) => <li key={index}>{log}</li>)}</ul></details>
        {["queued", "running"].includes(run.status) && <Button onClick={() => stop.mutate(run.id)}>停止模拟</Button>}
        {["failed", "stopped", "interrupted"].includes(run.status) && <Button onClick={() => retry.mutate(run.id)}>重试模拟</Button>}
        {run.parameters.action === "sync" && run.items.some((item) => item.status === "completed") && <Button disabled={importBatch.isPending} onClick={() => importBatch.mutate(run)}>将示例导入资产库</Button>}
      </article>)}
      <Modal open={Boolean(editing)} title="演示配置" onClose={() => setEditing(null)} footer={<Button variant="primary" disabled={update.isPending} onClick={() => { if (editing) update.mutate({ id: editing.id, name: editing.name, config: editing.demo_config }); }}>保存配置</Button>}>
        {editing && <>
          <label className="field">连接名称<input aria-label="连接名称" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
          <label className="field">演示配置名称<input aria-label="演示配置名称" value={editing.demo_config.label} onChange={(event) => setEditing({ ...editing, demo_config: { ...editing.demo_config, label: event.target.value } })} /></label>
          <label className="field">接口位置<input aria-label="接口位置" value={editing.demo_config.endpoint} onChange={(event) => setEditing({ ...editing, demo_config: { ...editing.demo_config, endpoint: event.target.value } })} /></label>
          <label className="field">用途说明<textarea aria-label="用途说明" value={editing.demo_config.note} onChange={(event) => setEditing({ ...editing, demo_config: { ...editing.demo_config, note: event.target.value } })} /></label>
          {error && <p role="alert">{error}</p>}
        </>}
      </Modal>
      <Modal open={creating} title="添加演示连接" onClose={() => setCreating(false)} footer={<Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>添加</Button>}>
        <label className="field">连接名称<input aria-label="新连接名称" value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
        <label className="field">服务类型<select aria-label="服务类型" value={serviceType} onChange={(event) => setServiceType(event.target.value)}>{["shopify", "gmail", "github", "creation_tool"].map((type) => <option key={type}>{type}</option>)}</select></label>
        {error && <p role="alert">{error}</p>}
      </Modal>
    </>
  );
}
