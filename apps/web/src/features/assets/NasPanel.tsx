import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Badge } from "../../components/Badge.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { NasEntry } from "../../lib/types.ts";

export function NasPanel() {
  const client = useQueryClient();
  const [form, setForm] = useState<{ name: string; type: "web" | "windows_path"; address: string; note: string }>({
    name: "",
    type: "web",
    address: "",
    note: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["integrations"],
    queryFn: () =>
      api<{ integrations: { nas: NasEntry[]; libtv: { url: string }; jianying: { url: string } } }>(
        "/api/system/settings",
      ),
  });
  const save = useMutation({
    mutationFn: () =>
      api("/api/settings/nas", { method: "POST", body: form }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["integrations"] });
      setForm({ name: "", type: "web", address: "", note: "" });
      setMessage("NAS 入口已保存。");
      setError(null);
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const entries = query.data?.integrations.nas ?? [];
  return (
    <section className="section" style={{ marginTop: 16 }}>
      <div className="grid-cards">
        {entries.map((entry) => (
          <article className="card" key={entry.id}>
            <div className="card-head">
              <div>
                <h3>{entry.name}</h3>
                <p className="hint">{entry.note}</p>
              </div>
              <Badge tone={entry.type === "web" ? "shared" : "neutral"}>
                {entry.type === "web" ? "网页入口" : "Windows 路径"}
              </Badge>
            </div>
            <code className="hint">{entry.address}</code>
            <div className="card-actions">
              {entry.type === "web" ? (
                <a className="btn" href={entry.address} target="_blank" rel="noreferrer">
                  打开网页
                </a>
              ) : (
                <Button
                  onClick={async () => {
                    await navigator.clipboard?.writeText(entry.address);
                    setMessage(`已复制路径：${entry.address}`);
                  }}
                >
                  复制路径
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {entries.length === 0 && (
        <EmptyState title="尚未配置 NAS 入口" description="仅保存地址或路径，不扫描、不同步 NAS 文件。" />
      )}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>新增 NAS 入口</h3>
        <div className="form-grid">
          <label className="field">
            <span className="label">名称</span>
            <input aria-label="NAS 名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="field">
            <span className="label">地址类型</span>
            <select aria-label="地址类型" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as "web" | "windows_path" })}>
              <option value="web">网页地址</option>
              <option value="windows_path">Windows 路径</option>
            </select>
          </label>
          <label className="field">
            <span className="label">地址或路径</span>
            <input aria-label="NAS 地址" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </label>
        </div>
        <label className="field">
          <span className="label">备注</span>
          <input aria-label="NAS 备注" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
        <div>
          <Button
            variant="primary"
            onClick={() => {
              if (!form.name.trim() || !form.address.trim()) {
                setError("名称与地址不能为空。");
                return;
              }
              setMessage(null);
              setError(null);
              save.mutate();
            }}
          >
            保存入口
          </Button>
        </div>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        <p className="hint">复制路径或打开 NAS 不代表文件已经导入本机。</p>
      </div>
    </section>
  );
}
