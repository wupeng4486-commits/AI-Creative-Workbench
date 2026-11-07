import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { appError } from "../http/errors.ts";
import { getIntegrations, getPreferences, setSetting, SETTING_KEYS, validateWebUrl, type NasEntry } from "../services/settings.ts";
import { newId } from "../util/id.ts";

export async function registerSettingsRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/settings", async () => ({
    datasetId: ctx.datasetId,
    integrations: getIntegrations(ctx.db),
    preferences: getPreferences(ctx.db),
  }));

  app.post("/api/settings/nas", async (request, reply) => {
    const body = (request.body ?? {}) as Partial<NasEntry>;
    if (!body.name?.trim() || !body.address?.trim()) {
      throw appError("VALIDATION_FAILED", "名称与地址不能为空。", {
        fieldErrors: {
          ...(body.name?.trim() ? {} : { name: "名称不能为空。" }),
          ...(body.address?.trim() ? {} : { address: "地址不能为空。" }),
        },
      });
    }
    const type = body.type === "windows_path" ? "windows_path" : "web";
    if (type === "web") {
      const problem = validateWebUrl(body.address.trim());
      if (problem) {
        throw appError("VALIDATION_FAILED", problem, { fieldErrors: { address: problem } });
      }
    }
    const entry: NasEntry = {
      id: newId(),
      name: body.name.trim(),
      type,
      address: body.address.trim(),
      note: body.note ?? "",
    };
    const current = getIntegrations(ctx.db).nas;
    setSetting(ctx.db, SETTING_KEYS.nas, [...current, entry]);
    return reply.code(201).send({ datasetId: ctx.datasetId, entry });
  });

  app.delete("/api/settings/nas/:id", async (request) => {
    const { id } = request.params as { id: string };
    const current = getIntegrations(ctx.db).nas;
    setSetting(
      ctx.db,
      SETTING_KEYS.nas,
      current.filter((entry) => entry.id !== id),
    );
    return { datasetId: ctx.datasetId, deleted: true };
  });

  /** LibTV and Jianying share one config read by studio, workflows and settings. */
  app.patch("/api/settings/integrations/:key", async (request) => {
    const { key } = request.params as { key: string };
    if (key !== "libtv" && key !== "jianying") {
      throw appError("NOT_FOUND", "未知的集成配置。");
    }
    const body = (request.body ?? {}) as { url?: string; note?: string };
    if (body.url) {
      const problem = validateWebUrl(body.url);
      if (problem) throw appError("VALIDATION_FAILED", problem, { fieldErrors: { url: problem } });
    }
    setSetting(ctx.db, SETTING_KEYS[key], { url: body.url ?? "", note: body.note ?? "" });
    return { datasetId: ctx.datasetId, integrations: getIntegrations(ctx.db) };
  });

  app.patch("/api/settings/preferences", async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const current = getPreferences(ctx.db);
    const next = {
      sidebarCollapsed:
        typeof body.sidebarCollapsed === "boolean"
          ? body.sidebarCollapsed
          : current.sidebarCollapsed,
      assetView: body.assetView === "grid" ? "grid" : body.assetView === "list" ? "list" : current.assetView,
    };
    setSetting(ctx.db, SETTING_KEYS.preferences, next);
    return { datasetId: ctx.datasetId, preferences: next };
  });
}
