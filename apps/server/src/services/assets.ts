import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { ResultSourceSnapshot } from "@workbench/shared";
import { newId } from "../util/id.ts";
import { nowIso, parseJson } from "../util/time.ts";
import { absoluteFilePath, getFile, previewKind, type FileRecord } from "../storage/files.ts";
import { recordActivity } from "./events.ts";
import { assetReferences, assertNotReferenced } from "./references.ts";

export interface AssetRow {
  id: string;
  name: string;
  asset_type: string;
  file_id: string | null;
  origin: "owned" | "shared";
  provenance: "seed" | "user_import" | "demo_result";
  tags: string[];
  notes: string;
  catalog: string;
  created_at: string;
  updated_at: string;
  sourceSnapshot?: ResultSourceSnapshot | null;
}

export interface AssetView extends AssetRow {
  file: FileRecord | null;
  previewKind: ReturnType<typeof previewKind>;
  contentUrl: string | null;
  downloadUrl: string | null;
  thumbUrl: string | null;
}

function mapAsset(row: Record<string, unknown>): AssetRow {
  const { source_snapshot, ...asset } = row;
  return { ...(asset as unknown as AssetRow), tags: parseJson(row.tags as string, []), sourceSnapshot: parseJson(String(source_snapshot ?? "null"), null) };
}

export function filterAssets(rows: AssetRow[], query: Record<string, unknown>): AssetRow[] {
  const search = String(query.search ?? "").trim().toLowerCase();
  const types = String(query.type ?? "").split(",").filter(Boolean);
  return rows.filter((row) =>
    (!types.length || types.includes(row.asset_type)) &&
    (!query.origin || row.origin === query.origin) &&
    (!query.catalog || row.catalog === query.catalog) &&
    (!query.filesOnly || (row.catalog !== "product" && row.asset_type !== "product" && Boolean(row.file_id))) &&
    (!query.provenance || row.provenance === query.provenance) &&
    (!query.tag || row.tags.includes(String(query.tag))) &&
    (!search || `${row.name} ${row.notes} ${row.tags.join(" ")}`.toLowerCase().includes(search)),
  );
}

export function listAssets(db: Database.Database, query: Record<string, unknown> = {}): AssetView[] {
  const rows = db.prepare("SELECT * FROM assets ORDER BY updated_at DESC, id").all() as Record<string, unknown>[];
  return filterAssets(rows.map(mapAsset), query).map((row) => hydrateAsset(db, row));
}

export function hydrateAsset(db: Database.Database, asset: AssetRow): AssetView {
  const file = asset.file_id ? getFile(db, asset.file_id) ?? null : null;
  const kind = file ? previewKind(file.mime_type) : "none";
  return {
    ...asset,
    file,
    previewKind: kind,
    contentUrl: file ? `/api/files/${file.id}/content` : null,
    downloadUrl: file ? `/api/files/${file.id}/download` : null,
    thumbUrl: file && (kind === "image" || kind === "video") ? `/api/files/${file.id}/thumb` : null,
  };
}

export function findAsset(db: Database.Database, id: string): AssetView | undefined {
  const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? hydrateAsset(db, mapAsset(row)) : undefined;
}

export interface CreateAssetInput {
  name: string;
  assetType?: string;
  fileId?: string | null;
  origin?: "owned" | "shared";
  provenance?: "seed" | "user_import" | "demo_result";
  tags?: string[];
  notes?: string;
  catalog?: string;
  id?: string;
  sourceSnapshot?: ResultSourceSnapshot | null;
}

export function inferAssetType(mime: string | undefined, catalog: string): string {
  if (catalog === "product") return "product";
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || mime.startsWith("text/")) return "document";
  return "file";
}

/** Creates the asset row, relation and activity in one transaction. */
export function createAsset(db: Database.Database, input: CreateAssetInput): AssetView {
  const time = nowIso();
  const file = input.fileId ? getFile(db, input.fileId) : undefined;
  if (input.fileId && !file) {
    const error = new Error("引用的文件不存在。") as Error & { code: string };
    error.code = "FILE_NOT_FOUND";
    throw error;
  }
  const id = input.id ?? newId();
  const catalog = input.catalog ?? (input.assetType === "product" ? "product" : "file");
  const assetType = input.assetType ?? inferAssetType(file?.mime_type, catalog);
  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO assets (id, name, asset_type, file_id, origin, provenance, tags, notes, catalog, source_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      assetType,
      input.fileId ?? null,
      input.origin ?? "owned",
      input.provenance ?? (file ? "user_import" : "seed"),
      JSON.stringify(input.tags ?? []),
      input.notes ?? "",
      catalog,
      JSON.stringify(input.sourceSnapshot ?? null),
      time,
      time,
    );
    recordActivity(db, "asset", id, `导入资产：${input.name}`, {
      name: input.name,
      assetType,
    });
    return findAsset(db, id)!;
  });
  return create();
}

export function updateAsset(
  db: Database.Database,
  id: string,
  patch: { name?: string; tags?: string[]; notes?: string; assetType?: string },
): AssetView {
  const current = findAsset(db, id);
  if (!current) {
    const error = new Error("资产不存在。") as Error & { code: string };
    error.code = "ASSET_NOT_FOUND";
    throw error;
  }
  const update = db.transaction(() => {
    db.prepare(
      `UPDATE assets SET name = ?, tags = ?, notes = ?, asset_type = ?, updated_at = ? WHERE id = ?`,
    ).run(
      patch.name ?? current.name,
      JSON.stringify(patch.tags ?? current.tags),
      patch.notes ?? current.notes,
      patch.assetType ?? current.asset_type,
      nowIso(),
      id,
    );
    recordActivity(db, "asset", id, `编辑资产：${patch.name ?? current.name}`, {
      name: patch.name ?? current.name,
    });
    return findAsset(db, id)!;
  });
  return update();
}

export function deleteAsset(
  db: Database.Database,
  datasetDir: string,
  id: string,
): { deleted: boolean; retainedFile: boolean } {
  const asset = findAsset(db, id);
  if (!asset) {
    const error = new Error("资产不存在。") as Error & { code: string };
    error.code = "ASSET_NOT_FOUND";
    throw error;
  }
  assertNotReferenced(assetReferences(db, id), "该资产仍被引用，请先解除引用。");

  const remove = db.transaction(() => {
    db.prepare("DELETE FROM collection_items WHERE asset_id = ?").run(id);
    db.prepare("DELETE FROM assets WHERE id = ?").run(id);
    recordActivity(db, "asset", id, `删除资产：${asset.name}`, { name: asset.name });
    if (asset.file_id) {
      const remaining = db.prepare(`SELECT 1 FROM assets WHERE file_id = ?
        UNION ALL SELECT 1 FROM asset_versions WHERE file_id = ?
        UNION ALL SELECT 1 FROM run_files WHERE file_id = ?
        UNION ALL SELECT 1 FROM team_workflows WHERE cover_file_id = ? LIMIT 1`).get(asset.file_id, asset.file_id, asset.file_id, asset.file_id);
      if (remaining) return true;
      db.prepare("DELETE FROM files WHERE id = ?").run(asset.file_id);
    }
    return false;
  });
  const retainedFile = remove();
  if (!retainedFile && asset.file) {
    const file = absoluteFilePath(datasetDir, asset.file.relative_path);
    try {
      fs.rmSync(file, { force: true });
      const preview = path.resolve(datasetDir, "previews", asset.file.id);
      if (preview.startsWith(path.resolve(datasetDir, "previews") + path.sep)) fs.rmSync(preview, { recursive: true, force: true });
    } catch {
      // The committed deletion remains successful. Startup isolates leftover files.
    }
  }
  return { deleted: true, retainedFile };
}

export function assetAbsolutePath(
  datasetDir: string,
  asset: AssetView,
): string | null {
  if (!asset.file) return null;
  return absoluteFilePath(datasetDir, asset.file.relative_path);
}
