import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import type { AssetView, Workflow } from "../../lib/types.ts";

export function ArchiveResultButton({ runId, itemId, initialName, datasetId }: { runId: string; itemId: string; initialName: string; datasetId: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [tags, setTags] = useState("");
  const [catalog, setCatalog] = useState("result");
  const [saved, setSaved] = useState<{ asset: AssetView; replayed: boolean } | null>(null);
  const archive = useMutation({
    mutationFn: () => api<{ asset: AssetView; replayed: boolean }>("/api/results/archive", { method: "POST", datasetId, body: { runId, resultItemId: itemId, name, catalog, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) } }),
    onSuccess: (data) => {
      setSaved(data); setOpen(false);
      for (const key of ["assets", "home", "search"]) void client.invalidateQueries({ queryKey: [key] });
    },
  });
  return <>
    <Button onClick={() => setOpen(true)}>归档成果</Button>
    {saved && <p role="status">{saved.replayed ? "该成果已归档" : "已归档到资产库"} <Link to={`/assets/${saved.asset.id}`}>查看归档资产</Link></p>}
    <Modal open={open} title="归档成果" onClose={() => setOpen(false)} footer={<Button variant="primary" disabled={archive.isPending} onClick={() => archive.mutate()}>确认归档</Button>}>
      <label className="field">成果名称<input aria-label="成果名称" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field">标签<input aria-label="成果标签" value={tags} onChange={(event) => setTags(event.target.value)} /></label>
      <label className="field">分类<select aria-label="成果分类" value={catalog} onChange={(event) => setCatalog(event.target.value)}>{[["result", "创作成果"], ["reference", "参考资料"], ["excellent", "优秀案例"], ["counter", "反例"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {archive.isError && <p role="alert">{errorMessage(archive.error)}</p>}
    </Modal>
  </>;
}

export function SaveWorkflowButton({ runId, initialName, datasetId }: { runId: string; initialName: string; datasetId: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState<Workflow | null>(null);
  const save = useMutation({
    mutationFn: () => api<{ workflow: Workflow }>("/api/results/save-workflow", { method: "POST", datasetId, body: { runId, name } }),
    onSuccess: (data) => {
      setSaved(data.workflow); setOpen(false);
      for (const key of ["workflows", "home", "search"]) void client.invalidateQueries({ queryKey: [key] });
    },
  });
  return <>
    <Button onClick={() => setOpen(true)}>另存为团队工作流</Button>
    {saved && <p role="status">已保存团队工作流 <Link to={`/workflows/${saved.id}`}>查看保存的工作流</Link></p>}
    <Modal open={open} title="另存为团队工作流" onClose={() => setOpen(false)} footer={<Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>确认另存</Button>}>
      <label className="field">工作流名称<input aria-label="另存工作流名称" value={name} onChange={(event) => setName(event.target.value)} /></label>
      {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
    </Modal>
  </>;
}
