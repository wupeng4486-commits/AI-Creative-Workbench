import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { appError } from "../http/errors.ts";
import { newId } from "../util/id.ts";
import { nowIso } from "../util/time.ts";

const CATEGORIES = new Set(["reference", "excellent", "counter"]);

export async function registerCollectionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/collections", async () => {
    const rows = ctx.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id) AS itemCount
         FROM case_collections c ORDER BY c.updated_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return { datasetId: ctx.datasetId, items: rows };
  });

  app.get("/api/collections/:id", async (request) => {
    const { id } = request.params as { id: string };
    const collection = ctx.db.prepare("SELECT * FROM case_collections WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!collection) throw appError("COLLECTION_NOT_FOUND", "案例集不存在。");
    const items = ctx.db
      .prepare(
        `SELECT a.*, i.category FROM collection_items i JOIN assets a ON a.id = i.asset_id
         WHERE i.collection_id = ? ORDER BY a.name`,
      )
      .all(id);
    return { datasetId: ctx.datasetId, collection, items };
  });

  app.post("/api/collections", async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: string;
      purpose?: string;
      category?: string;
      description?: string;
      assetIds?: string[];
    };
    if (!body.name?.trim()) {
      throw appError("VALIDATION_FAILED", "请填写案例集名称。", {
        fieldErrors: { name: "案例集名称不能为空。" },
      });
    }
    const category = body.category && CATEGORIES.has(body.category) ? body.category : "reference";
    const id = newId();
    const time = nowIso();
    ctx.db.transaction(() => {
      ctx.db
        .prepare(
          `INSERT INTO case_collections (id, name, purpose, category, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, body.name!.trim(), body.purpose ?? "", category, body.description ?? "", time, time);
      for (const assetId of body.assetIds ?? []) {
        const exists = ctx.db.prepare("SELECT id FROM assets WHERE id = ?").get(assetId);
        if (!exists) throw appError("ASSET_NOT_FOUND", "引用的资产不存在。");
        ctx.db
          .prepare("INSERT OR IGNORE INTO collection_items (collection_id, asset_id, category) VALUES (?, ?, ?)")
          .run(id, assetId, category);
      }
    })();
    return reply
      .code(201)
      .send({ datasetId: ctx.datasetId, collection: { id, name: body.name.trim(), category } });
  });

  app.post("/api/collections/:id/items", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { assetId?: string; category?: string };
    const collection = ctx.db.prepare("SELECT id FROM case_collections WHERE id = ?").get(id);
    if (!collection) throw appError("COLLECTION_NOT_FOUND", "案例集不存在。");
    if (!body.assetId) throw appError("VALIDATION_FAILED", "请选择要加入的资产。");
    const asset = ctx.db.prepare("SELECT id FROM assets WHERE id = ?").get(body.assetId);
    if (!asset) throw appError("ASSET_NOT_FOUND", "资产不存在。");
    ctx.db
      .prepare(
        `INSERT INTO collection_items (collection_id, asset_id, category) VALUES (?, ?, ?)
         ON CONFLICT(collection_id, asset_id) DO UPDATE SET category = excluded.category`,
      )
      .run(id, body.assetId, body.category ?? "reference");
    return reply.code(201).send({ datasetId: ctx.datasetId, added: true });
  });

  app.delete("/api/collections/:id/items/:assetId", async (request) => {
    const { id, assetId } = request.params as { id: string; assetId: string };
    ctx.db
      .prepare("DELETE FROM collection_items WHERE collection_id = ? AND asset_id = ?")
      .run(id, assetId);
    return { datasetId: ctx.datasetId, removed: true };
  });

  app.delete("/api/collections/:id", async (request) => {
    const { id } = request.params as { id: string };
    const result = ctx.db.prepare("DELETE FROM case_collections WHERE id = ?").run(id);
    if (result.changes === 0) throw appError("COLLECTION_NOT_FOUND", "案例集不存在。");
    return { datasetId: ctx.datasetId, deleted: true };
  });
}
