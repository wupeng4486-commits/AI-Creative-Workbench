import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { appError } from "../http/errors.ts";
import {
  createAsset,
  deleteAsset,
  findAsset,
  updateAsset,
  hydrateAsset,
  inferAssetType,
  type AssetRow,
} from "../services/assets.ts";
import { recordRecent } from "../services/events.ts";
import { assetReferences } from "../services/references.ts";
import {
  commitStagedFile,
  guessMimeType,
  insertFile,
  stageUpload,
} from "../storage/files.ts";
import { parseJson } from "../util/time.ts";

function assetFilterFromQuery(query: Record<string, unknown>) {
  const types = String(query.type ?? "")
    .split(",")
    .filter(Boolean);
  return {
    search: String(query.search ?? "").trim().toLowerCase(),
    types,
    origin: query.origin ? String(query.origin) : "",
    tag: query.tag ? String(query.tag) : "",
    catalog: query.catalog ? String(query.catalog) : "",
    provenance: query.provenance ? String(query.provenance) : "",
  };
}

/** Pure filter used by the route and by unit tests. */
export function filterAssets(rows: AssetRow[], query: Record<string, unknown>): AssetRow[] {
  const filter = assetFilterFromQuery(query);
  return rows.filter((row) => {
    if (filter.types.length > 0 && !filter.types.includes(row.asset_type)) return false;
    if (filter.origin && row.origin !== filter.origin) return false;
    if (filter.catalog && row.catalog !== filter.catalog) return false;
    if (filter.provenance && row.provenance !== filter.provenance) return false;
    if (filter.tag && !row.tags.includes(filter.tag)) return false;
    if (
      filter.search &&
      !`${row.name} ${row.notes} ${row.tags.join(" ")}`.toLowerCase().includes(filter.search)
    ) {
      return false;
    }
    return true;
  });
}

export async function registerAssetRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/assets", async (request) => {
    const rows = ctx.db
      .prepare("SELECT * FROM assets ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    const mapped: AssetRow[] = rows.map((row) => ({
      ...(row as unknown as AssetRow),
      tags: parseJson(row.tags as string, []),
    }));
    const filtered = filterAssets(mapped, request.query as Record<string, unknown>).map((row) =>
      hydrateAsset(ctx.db, row),
    );
    const tags = Array.from(new Set(mapped.flatMap((row) => row.tags))).sort();
    return { datasetId: ctx.datasetId, items: filtered, tags };
  });

  app.get("/api/assets/:id", async (request) => {
    const { id } = request.params as { id: string };
    const asset = findAsset(ctx.db, id);
    if (!asset) throw appError("ASSET_NOT_FOUND", "资产不存在。");
    if (asset.catalog !== "product") {
      recordRecent(ctx.db, "asset", asset.id, { name: asset.name, assetType: asset.asset_type });
    }
    return {
      datasetId: ctx.datasetId,
      asset,
      references: assetReferences(ctx.db, id),
    };
  });

  app.post("/api/assets", async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: string;
      fileId?: string;
      tags?: string[];
      notes?: string;
      origin?: "owned" | "shared";
      provenance?: "seed" | "user_import" | "demo_result";
      assetType?: string;
      catalog?: string;
    };
    if (!body.name || !body.name.trim()) {
      throw appError("VALIDATION_FAILED", "请填写名称。", {
        fieldErrors: { name: "名称不能为空。" },
      });
    }
    const asset = createAsset(ctx.db, {
      name: body.name.trim(),
      fileId: body.fileId ?? null,
      tags: body.tags ?? [],
      notes: body.notes ?? "",
      origin: body.origin ?? "owned",
      provenance: body.provenance ?? "user_import",
      assetType: body.assetType,
      catalog: body.catalog ?? "file",
    });
    return reply.code(201).send({ datasetId: ctx.datasetId, asset });
  });

  app.post("/api/assets/import", async (request, reply) => {
    const part = await request.file();
    if (!part) throw appError("FILE_REQUIRED", "请选择要导入的文件。");
    const originalName = path.basename(part.filename ?? "");
    if (!originalName) throw appError("FILE_NAME_INVALID", "文件名无效。");
    const tags = String((part.fields as Record<string, { value?: unknown }>).tags?.value ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const origin = (String((part.fields as Record<string, { value?: unknown }>).origin?.value ?? "owned")) as
      | "owned"
      | "shared";
    const notes = String((part.fields as Record<string, { value?: unknown }>).notes?.value ?? "");
    const mime = part.mimetype || guessMimeType(originalName);
    const staged = await stageUpload(
      path.join(ctx.config.dataDir, "staging", "uploads"),
      part.file,
    );
    const committed = commitStagedFile(
      ctx.dataset.dir,
      staged.stagingPath,
      originalName,
      mime,
      staged.sha256,
    );
    const file = insertFile(ctx.db, committed);
    const asset = createAsset(ctx.db, {
      name: originalName,
      fileId: file.id,
      tags,
      notes,
      origin: origin === "shared" ? "shared" : "owned",
      assetType: inferAssetType(mime, "file"),
      catalog: "file",
    });
    return reply.code(201).send({ datasetId: ctx.datasetId, asset });
  });

  app.patch("/api/assets/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      name?: string;
      tags?: string[];
      notes?: string;
      origin?: "owned" | "shared";
    };
    if (body.name !== undefined && !body.name.trim()) {
      throw appError("VALIDATION_FAILED", "名称不能为空。", {
        fieldErrors: { name: "名称不能为空。" },
      });
    }
    const current = findAsset(ctx.db, id);
    if (!current) throw appError("ASSET_NOT_FOUND", "资产不存在。");
    if (body.origin && body.origin !== current.origin) {
      ctx.db
        .prepare("UPDATE assets SET origin = ?, updated_at = ? WHERE id = ?")
        .run(body.origin, new Date().toISOString(), id);
    }
    const asset = updateAsset(ctx.db, id, {
      name: body.name?.trim(),
      tags: body.tags,
      notes: body.notes,
    });
    return { datasetId: ctx.datasetId, asset };
  });

  app.delete("/api/assets/:id", async (request) => {
    const { id } = request.params as { id: string };
    const result = deleteAsset(ctx.db, ctx.dataset.dir, id);
    return { datasetId: ctx.datasetId, ...result };
  });

  app.get("/api/products", async () => {
    const rows = ctx.db.prepare("SELECT * FROM products ORDER BY updated_at DESC").all() as Array<
      Record<string, unknown>
    >;
    return {
      datasetId: ctx.datasetId,
      items: rows.map((row) => ({
        ...row,
        sellingPoints: parseJson(row.selling_points as string, []),
      })),
    };
  });

  app.post("/api/products", async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: string;
      sku?: string;
      description?: string;
      sellingPoints?: string[];
      packageVersion?: string;
      notes?: string;
      fileIds?: string[];
    };
    if (!body.name?.trim()) {
      throw appError("VALIDATION_FAILED", "请填写商品名称。", {
        fieldErrors: { name: "商品名称不能为空。" },
      });
    }
    const { newId } = await import("../util/id.ts");
    const { nowIso } = await import("../util/time.ts");
    const id = newId();
    const time = nowIso();
    const create = ctx.db.transaction(() => {
      ctx.db
        .prepare(
          `INSERT INTO products (id, name, sku, description, selling_points, package_version, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          body.name!.trim(),
          body.sku ?? "",
          body.description ?? "",
          JSON.stringify(body.sellingPoints ?? []),
          body.packageVersion ?? "",
          body.notes ?? "",
          time,
          time,
        );
      const asset = createAsset(ctx.db, {
        name: body.name!.trim(),
        assetType: "product",
        catalog: "product",
        tags: ["商品知识"],
        notes: body.description ?? "",
        id,
      });
      for (const fileId of body.fileIds ?? []) {
        const file = ctx.db.prepare("SELECT id FROM files WHERE id = ?").get(fileId);
        if (!file) continue;
        ctx.db
          .prepare(
            `INSERT INTO asset_versions (id, asset_id, file_id, note, created_at) VALUES (?, ?, ?, '商品关联素材', ?)`,
          )
          .run(newId(), id, fileId, time);
      }
      return asset;
    });
    const asset = create();
    return reply.code(201).send({ datasetId: ctx.datasetId, asset });
  });

  app.patch("/api/products/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      name?: string;
      sku?: string;
      description?: string;
      sellingPoints?: string[];
      packageVersion?: string;
      notes?: string;
    };
    const exists = ctx.db.prepare("SELECT id FROM products WHERE id = ?").get(id);
    if (!exists) throw appError("PRODUCT_NOT_FOUND", "商品知识不存在。");
    ctx.db
      .prepare(
        `UPDATE products SET name = COALESCE(?, name), sku = COALESCE(?, sku), description = COALESCE(?, description),
           selling_points = COALESCE(?, selling_points), package_version = COALESCE(?, package_version),
           notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
      )
      .run(
        body.name ?? null,
        body.sku ?? null,
        body.description ?? null,
        body.sellingPoints ? JSON.stringify(body.sellingPoints) : null,
        body.packageVersion ?? null,
        body.notes ?? null,
        new Date().toISOString(),
        id,
      );
    return { datasetId: ctx.datasetId, asset: findAsset(ctx.db, id) };
  });
}
