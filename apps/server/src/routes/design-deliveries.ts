import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { createDesignDelivery } from "../services/design-deliveries.ts";
import { getDemoRun } from "../services/demo-runs.ts";
import { withIdempotency } from "../services/idempotency.ts";

export async function registerDesignDeliveryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post<{ Body: { revision: number } }>("/api/drafts/:id/deliveries", { schema: { body: { type: "object", required: ["revision"], properties: { revision: { type: "integer", minimum: 1 } } } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = ctx.db.transaction(() => withIdempotency(ctx.db, `design-delivery:${id}`, request.headers["idempotency-key"] as string | undefined, () => createDesignDelivery(ctx, id, request.body.revision)))();
    return reply.code(result.replayed ? 200 : 201).send(getDemoRun(ctx, result.resource.id));
  });
}
