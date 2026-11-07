import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { discoveryIndex, homeOverview } from "../services/discovery.ts";

export async function registerDiscoveryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/home", async (request) => ({ datasetId: ctx.datasetId, ...homeOverview(ctx.db, (request.query as { type?: string }).type) }));
  app.get("/api/search", async (request) => {
    const query = String((request.query as { q?: string }).q ?? "").trim().toLowerCase();
    const items = query ? discoveryIndex(ctx.db).filter((item) => `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(query)) : [];
    return { datasetId: ctx.datasetId, groups: ["agent", "skill", "asset", "workflow"].map((type) => ({ type, items: items.filter((item) => item.type === type) })) };
  });
}
