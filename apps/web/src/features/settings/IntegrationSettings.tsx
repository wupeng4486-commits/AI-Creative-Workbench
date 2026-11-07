import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api.ts";
import { Button } from "../../components/Button.tsx";
import { NasPanel } from "../assets/NasPanel.tsx";
import type { UiPreferences } from "../../lib/types.ts";

function EntryForm({ name, settingKey, initial }: { name: string; settingKey: string; initial: { url: string; note: string } }) {
  const [form, setForm] = useState(initial);
  const save = useMutation({ mutationFn: () => api(`/api/settings/integrations/${settingKey}`, { method: "PATCH", body: form }) });
  return <article className="card"><h3>{name} 共用入口</h3>
    <label className="field">{name} 网页地址<input aria-label={`${name} 网页地址`} value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /></label>
    <label className="field">{name} 备注<input aria-label={`${name} 备注`} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
    <Button disabled={save.isPending} onClick={() => save.mutate()}>保存{name}入口</Button>
    {save.isSuccess && <p role="status">{name}入口已保存</p>}{save.isError && <p role="alert">{errorMessage(save.error)}</p>}
  </article>;
}

export function IntegrationSettings() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<{ integrations: { libtv: { url: string; note: string }; jianying: { url: string; note: string } }; preferences: UiPreferences }>("/api/settings") });
  const prefs = useMutation({ mutationFn: (body: Partial<UiPreferences>) => api("/api/settings/preferences", { method: "PATCH", body }) });
  return <section className="section" aria-label="共用配置与偏好"><h2>共用配置与偏好</h2>
    {settings.isError && <p role="alert">{errorMessage(settings.error)}</p>}
    {settings.data && <div className="grid-cards">
      <EntryForm name="LibTV" settingKey="libtv" initial={settings.data.integrations.libtv} />
      <EntryForm name="剪映" settingKey="jianying" initial={settings.data.integrations.jianying} />
      <article className="card"><h3>显示偏好</h3>
        <label className="field">资产显示方式<select aria-label="资产显示方式" value={settings.data.preferences.assetView} disabled={prefs.isPending} onChange={(event) => prefs.mutate({ assetView: event.target.value as "list" | "grid" })}><option value="list">列表</option><option value="grid">网格</option></select></label>
        <label><input type="checkbox" aria-label="收起导航侧栏" checked={settings.data.preferences.sidebarCollapsed} disabled={prefs.isPending} onChange={(event) => prefs.mutate({ sidebarCollapsed: event.target.checked })} />收起导航侧栏</label>
        {prefs.isError && <p role="alert">{errorMessage(prefs.error)}</p>}
      </article>
    </div>}
    <h3>NAS 入口</h3><NasPanel />
  </section>;
}
