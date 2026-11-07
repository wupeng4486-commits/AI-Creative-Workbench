import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Modal } from "../../components/Modal.tsx";
import { api, errorMessage } from "../../lib/api.ts";

interface Collection {
  id: string;
  name: string;
  purpose: string;
  category: string;
  description: string;
  itemCount: number;
}

export function CollectionsPanel() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", purpose: "", category: "reference", description: "" });
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["collections"],
    queryFn: () => api<{ items: Collection[] }>("/api/collections"),
  });
  const create = useMutation({
    mutationFn: () => api<{ collection: Collection }>("/api/collections", { method: "POST", body: form }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["collections"] });
      setOpen(false);
      setForm({ name: "", purpose: "", category: "reference", description: "" });
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  const items = query.data?.items ?? [];
  return (
    <section className="section" style={{ marginTop: 16 }}>
      <div className="section-title">
        <p className="hint">案例集用于归档参考、优秀案例与反例，不触发智能体训练。</p>
        <Button onClick={() => setOpen(true)}>新建案例集</Button>
      </div>
      {items.length === 0 ? (
        <EmptyState title="还没有案例集" description="把一组参考资产归档为案例集，便于复用。" action={<Button onClick={() => setOpen(true)}>新建案例集</Button>} />
      ) : (
        <div className="grid-cards">
          {items.map((item) => (
            <article className="card" key={item.id}>
              <h3>
                <Link to={`/assets/collections/${item.id}`}>{item.name}</Link>
              </h3>
              <p className="hint">{item.purpose || item.description}</p>
              <div className="card-meta">
                <span>{item.itemCount} 个资产</span>
                <span>{item.category}</span>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal
        open={open}
        title="新建案例集"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!form.name.trim()) {
                  setError("案例集名称不能为空。");
                  return;
                }
                setError(null);
                create.mutate();
              }}
            >
              创建
            </Button>
          </>
        }
      >
        <label className="field">
          <span className="label">名称 *</span>
          <input aria-label="案例集名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label className="field">
          <span className="label">用途</span>
          <input aria-label="案例集用途" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} />
        </label>
        <label className="field">
          <span className="label">分类</span>
          <select aria-label="案例分类" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
            <option value="reference">参考</option>
            <option value="excellent">优秀案例</option>
            <option value="counter">反例</option>
          </select>
        </label>
        <label className="field">
          <span className="label">说明</span>
          <textarea aria-label="案例集说明" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
        {error && <p role="alert">{error}</p>}
      </Modal>
    </section>
  );
}
