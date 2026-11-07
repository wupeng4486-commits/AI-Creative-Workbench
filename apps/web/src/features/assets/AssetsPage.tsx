import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileUp, PackagePlus, Trash2, Pencil } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SearchInput } from "../../components/SearchInput.tsx";
import { SourceFilter, type SourceValue } from "../../components/SourceFilter.tsx";
import { Button } from "../../components/Button.tsx";
import { Badge } from "../../components/Badge.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Modal } from "../../components/Modal.tsx";
import { FieldError } from "../../components/FieldError.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { MediaPreview } from "../../components/MediaPreview.tsx";
import { SaveStatus, type SaveState } from "../../components/SaveStatus.tsx";
import { useAssets, useAssetMutations } from "./useAssets.ts";
import { ProductDialog } from "./ProductDialog.tsx";
import { CollectionsPanel } from "./CollectionsPanel.tsx";
import { NasPanel } from "./NasPanel.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useQuery } from "@tanstack/react-query";
import { formatBytes, formatDuration } from "@workbench/shared";

const TYPE_OPTIONS = [
  ["", "全部类型"],
  ["image", "图片"],
  ["video", "视频"],
  ["audio", "音频"],
  ["document", "文档"],
  ["file", "其他文件"],
] as const;

type Tab = "files" | "products" | "collections" | "nas";

export function AssetsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("files");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [type, setType] = useState(params.get("type") ?? "");
  const [origin, setOrigin] = useState<SourceValue>((params.get("origin") as SourceValue) ?? "all");
  const [tag, setTag] = useState(params.get("tag") ?? "");
  const [importOpen, setImportOpen] = useState(params.get("import") === "1");
  const [productOpen, setProductOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ file: null as File | null, tags: "", notes: "", origin: "owned" as "owned" | "shared" });

  const assets = useAssets({
    search,
    type,
    origin: origin === "all" ? "" : origin,
    tag,
    catalog: "",
    filesOnly: params.get("filesOnly") ?? "",
  });
  const { upload, update, remove } = useAssetMutations();
  const preferences = useQuery({ queryKey: ["preferences"], queryFn: () => api<{ preferences: { assetView: "list" | "grid" } }>("/api/settings") });
  const items = assets.data?.items ?? [];
  const editingAsset = useMemo(
    () => items.find((item) => item.id === editing) ?? null,
    [items, editing],
  );

  const updateQuery = (next: { search?: string; type?: string; origin?: SourceValue; tag?: string }) => {
    const merged = { search, type, origin, tag, ...next };
    const query = new URLSearchParams();
    if (params.get("filesOnly")) query.set("filesOnly", params.get("filesOnly")!);
    if (merged.search) query.set("search", merged.search);
    if (merged.type) query.set("type", merged.type);
    if (merged.origin && merged.origin !== "all") query.set("origin", merged.origin);
    if (merged.tag) query.set("tag", merged.tag);
    setParams(query, { replace: true });
  };

  const onImport = async () => {
    setFormError(null);
    if (!form.file) {
      setFormError("请选择要导入的文件。");
      return;
    }
    const file = form.file;
    setSaveState("saving");
    try {
      await upload.mutateAsync({ ...form, file });
      setSaveState("saved");
      setImportOpen(false);
      setForm({ file: null, tags: "", notes: "", origin: "owned" });
    } catch (error) {
      setSaveState("error");
      setFormError(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        title="资产库"
        description="商品知识、共享文件、媒体、案例与 NAS 入口。所有记录保存在本机。"
        actions={
          <>
            <Button onClick={() => setProductOpen(true)}>
              <PackagePlus size={15} /> 新建商品知识
            </Button>
            <Button variant="primary" onClick={() => setImportOpen(true)}>
              <FileUp size={15} /> 导入文件
            </Button>
          </>
        }
      />
      <div className="segmented" role="tablist" aria-label="资产分类">
        {(
          [
            ["files", "文件与媒体"],
            ["products", "商品知识"],
            ["collections", "案例集"],
            ["nas", "NAS 入口"],
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "files" && (
        <section className="section" style={{ marginTop: 16 }}>
          <div className="toolbar">
            <SearchInput
              label="搜索资产"
              value={search}
              onChange={(value) => {
                setSearch(value);
                updateQuery({ search: value });
              }}
              placeholder="名称、备注或标签"
            />
            <SourceFilter
              value={origin}
              onChange={(value) => {
                setOrigin(value);
                updateQuery({ origin: value });
              }}
            />
            <select
              aria-label="类型筛选"
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                updateQuery({ type: event.target.value });
              }}
            >
              {TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="标签筛选"
              value={tag}
              onChange={(event) => {
                setTag(event.target.value);
                updateQuery({ tag: event.target.value });
              }}
            >
              <option value="">全部标签</option>
              {(assets.data?.tags ?? []).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          {assets.isError && <p role="alert">{errorMessage(assets.error)}</p>}
          {items.length === 0 && !assets.isLoading ? (
            search || type || tag || origin !== "all" ? (
              <EmptyState
                title="没有符合筛选的资产"
                description="清除筛选条件，或导入新的文件。"
                action={
                  <Button
                    onClick={() => {
                      setSearch("");
                      setType("");
                      setTag("");
                      setOrigin("all");
                      setParams({}, { replace: true });
                    }}
                  >
                    清除筛选
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="资产库还是空的"
                description="导入图片、视频或文档后，它们会真实保存在本机。"
                action={<Button variant="primary" onClick={() => setImportOpen(true)}>导入文件</Button>}
              />
            )
          ) : (
            <div className={preferences.data?.preferences?.assetView === "grid" ? "grid-cards" : "asset-list"} data-testid="asset-catalog" data-view={preferences.data?.preferences?.assetView ?? "list"}>
              {items.map((asset) => (
                <article key={asset.id} className="card">
                  {asset.thumbUrl ? (
                    <img
                      src={asset.thumbUrl}
                      alt={`${asset.name} 缩略图`}
                      className="asset-thumb"
                      loading="lazy"
                    />
                  ) : null}
                  <div className="card-head">
                    <div>
                      <h3>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => navigate(`/assets/${asset.id}`)}
                        >
                          {asset.name}
                        </button>
                      </h3>
                      <p>{asset.file?.original_name ?? "无原文件记录"}</p>
                    </div>
                    <div className="card-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`编辑 ${asset.name}`}
                        onClick={() => setEditing(asset.id)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`删除 ${asset.name}`}
                        onClick={() => {
                          setDeleting(asset.id);
                          setDeleteError(null);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="card-meta">
                    <Badge tone={asset.origin === "shared" ? "shared" : "neutral"}>
                      {asset.origin === "shared" ? "与我共享的" : "我创建的"}
                    </Badge>
                    <Badge>{asset.asset_type}</Badge>
                    {asset.provenance === "demo_result" && <Badge tone="demo">示例成果</Badge>}
                    <span>{formatBytes(asset.file?.size)}</span>
                    {asset.file?.duration ? <span>{formatDuration(asset.file.duration)}</span> : null}
                    {asset.file?.width ? (
                      <span>
                        {asset.file.width}×{asset.file.height}
                      </span>
                    ) : null}
                  </div>
                  <div className="card-meta">
                    {asset.tags.map((item) => (
                      <Badge key={item}>{item}</Badge>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {tab === "products" && <ProductsList onNew={() => setProductOpen(true)} />}
      {tab === "collections" && <CollectionsPanel />}
      {tab === "nas" && <NasPanel />}

      <Modal
        open={importOpen}
        title="导入本地文件"
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <Button onClick={() => setImportOpen(false)}>取消</Button>
            <Button variant="primary" onClick={onImport} disabled={saveState === "saving"}>
              导入
            </Button>
          </>
        }
      >
        <div className="field">
          <span className="label">文件</span>
          <input
            type="file"
            aria-label="文件"
            onChange={(event) => setForm({ ...form, file: event.target.files?.[0] ?? null })}
          />
          <span className="hint">
            每次导入一个文件。需要多个文件时请逐个导入，或从资源管理器多选后重复操作。
          </span>
          <FieldError message={formError} />
        </div>
        <div className="field">
          <span className="label">标签（逗号分隔）</span>
          <input
            aria-label="标签"
            value={form.tags}
            onChange={(event) => setForm({ ...form, tags: event.target.value })}
          />
        </div>
        <div className="field">
          <span className="label">来源</span>
          <select
            aria-label="来源"
            value={form.origin}
            onChange={(event) =>
              setForm({ ...form, origin: event.target.value as "owned" | "shared" })
            }
          >
            <option value="owned">我创建的</option>
            <option value="shared">与我共享的</option>
          </select>
        </div>
        <div className="field">
          <span className="label">备注</span>
          <textarea
            aria-label="备注"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </div>
        <SaveStatus state={saveState} detail={formError ?? undefined} />
        <p className="hint">导入成功后原文件保存在本机数据集目录，刷新或重启后仍可预览。</p>
      </Modal>

      <Modal
        open={Boolean(editingAsset)}
        title="编辑资产"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!editingAsset) return;
                setSaveState("saving");
                try {
                  await update.mutateAsync({
                    id: editingAsset.id,
                    name: editingAsset.name,
                    tags: editingAsset.tags,
                    notes: editingAsset.notes,
                  });
                  setSaveState("saved");
                  setEditing(null);
                } catch (error) {
                  setSaveState("error");
                  setFormError(errorMessage(error));
                }
              }}
            >
              保存
            </Button>
          </>
        }
      >
        {editingAsset && <AssetEditForm asset={editingAsset} onChange={(patch) => {
          void update.mutateAsync({ id: editingAsset.id, ...patch });
        }} />}
      </Modal>

      <Modal
        open={Boolean(deleting)}
        title="删除资产"
        onClose={() => setDeleting(null)}
        size="small"
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>取消</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await remove.mutateAsync(deleting!);
                  setDeleting(null);
                } catch (error) {
                  setDeleteError(errorMessage(error));
                }
              }}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p>删除后原文件与预览将一并移除。仍被草稿或流程引用的资产会先被阻止。</p>
        {deleteError && <p role="alert">{deleteError}</p>}
      </Modal>

      <ProductDialog
        open={productOpen}
        onClose={() => setProductOpen(false)}
        onSaved={() => setTab("products")}
      />
    </>
  );
}

function ProductsList({ onNew }: { onNew: () => void }) {
  const query = useQuery({
    queryKey: ["products"],
    queryFn: () =>
      api<{ items: Array<{ id: string; name: string; sku: string; description: string; selling_points: string }> }>(
        "/api/products",
      ),
  });
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState title="还没有商品知识" description="新建后可在工作室与智能体中引用。" action={<Button onClick={onNew}>新建商品知识</Button>} />;
  }
  return (
    <div className="grid-cards">
      {items.map((item) => (
        <article className="card" key={item.id}>
          <div>
            <h3>{item.name}</h3>
            <p className="hint">{item.sku || "无货号"} · {item.description}</p>
          </div>
          <div className="card-meta">
            {JSON.parse(item.selling_points || "[]").map((point: string) => (
              <Badge key={point}>{point}</Badge>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function AssetEditForm({
  asset,
  onChange,
}: {
  asset: { name: string; tags: string[]; notes: string };
  onChange: (patch: { name?: string; tags?: string[]; notes?: string }) => void;
}) {
  const [name, setName] = useState(asset.name);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [notes, setNotes] = useState(asset.notes);
  return (
    <>
      <div className="field">
        <span className="label">名称</span>
        <input
          aria-label="资产名称"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            onChange({ name: event.target.value });
          }}
        />
      </div>
      <div className="field">
        <span className="label">标签</span>
        <input
          aria-label="资产标签"
          value={tags}
          onChange={(event) => {
            setTags(event.target.value);
            onChange({
              tags: event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            });
          }}
        />
      </div>
      <div className="field">
        <span className="label">备注</span>
        <textarea
          aria-label="资产备注"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            onChange({ notes: event.target.value });
          }}
        />
      </div>
    </>
  );
}

export function AssetsPreviewSummary({ asset }: { asset: Parameters<typeof MediaPreview>[0] }) {
  return <MediaPreview {...asset} />;
}
