import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { DraftSaveQueue } from "./DraftSaveQueue.ts";

export function JianyingButton({ queue, datasetId }: { queue: DraftSaveQueue; datasetId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["settings"], queryFn: () => api<{ integrations: { jianying: { url: string; note: string } } }>("/api/settings") });
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      if (!url.trim()) throw new Error("请填写剪映网页地址。");
      return api("/api/settings/integrations/jianying", { method: "PATCH", datasetId, body: { url: url.trim(), note: "从工作室配置的网页入口" } });
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["settings"] }); setOpen(false); setError(null); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const launch = async () => {
    const target = query.data?.integrations.jianying.url;
    if (!target) { setError(null); setOpen(true); return; }
    const popup = window.open("about:blank", "_blank");
    try {
      await queue.flush();
      if (!popup) throw new Error("浏览器未能打开新标签页，请允许此入口打开页面后重试。");
      popup.opener = null;
      popup.location.href = target;
      setError(null);
    } catch (failure) { popup?.close(); setError(errorMessage(failure)); }
  };
  return <>
    <Button onClick={() => { void launch(); }}>前往剪映</Button>
    {error && !open && <span role="alert">{error}</span>}
    <Modal open={open} title="配置剪映入口" onClose={() => setOpen(false)} footer={<Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>保存入口</Button>}>
      <p>请先配置剪映网页入口。打开前会保存当前草稿。</p>
      <label className="field">剪映网页地址<input aria-label="剪映网页地址" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
    </Modal>
  </>;
}
