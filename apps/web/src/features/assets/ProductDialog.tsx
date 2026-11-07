import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Modal } from "../../components/Modal.tsx";
import { Button } from "../../components/Button.tsx";
import { FieldError } from "../../components/FieldError.tsx";
import { api, errorMessage } from "../../lib/api.ts";

export function ProductDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    sku: "",
    description: "",
    sellingPoints: "",
    packageVersion: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api("/api/products", {
        method: "POST",
        body: {
          ...form,
          sellingPoints: form.sellingPoints
            .split("\n")
            .map((point) => point.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["products"] });
      void client.invalidateQueries({ queryKey: ["assets"] });
      void client.invalidateQueries({ queryKey: ["home"] });
      onSaved?.();
      setForm({ name: "", sku: "", description: "", sellingPoints: "", packageVersion: "", notes: "" });
      onClose();
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });
  return (
    <Modal
      open={open}
      title="新建商品知识"
      onClose={onClose}
      size="large"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!form.name.trim()) {
                setError("商品名称不能为空。");
                return;
              }
              setError(null);
              create.mutate();
            }}
          >
            保存商品知识
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span className="label">名称 *</span>
          <input
            aria-label="商品名称"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">货号</span>
          <input
            aria-label="货号"
            value={form.sku}
            onChange={(event) => setForm({ ...form, sku: event.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">包装版本</span>
          <input
            aria-label="包装版本"
            value={form.packageVersion}
            onChange={(event) => setForm({ ...form, packageVersion: event.target.value })}
          />
        </label>
      </div>
      <label className="field">
        <span className="label">简介</span>
        <textarea
          aria-label="商品简介"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </label>
      <label className="field">
        <span className="label">卖点（每行一条）</span>
        <textarea
          aria-label="卖点"
          value={form.sellingPoints}
          onChange={(event) => setForm({ ...form, sellingPoints: event.target.value })}
        />
      </label>
      <label className="field">
        <span className="label">注意事项</span>
        <textarea
          aria-label="注意事项"
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
      </label>
      <FieldError message={error} />
    </Modal>
  );
}
