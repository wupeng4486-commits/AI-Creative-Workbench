import type Database from "better-sqlite3";
import { nowIso } from "../util/time.ts";

/**
 * Returns the existing resource for a repeated (scope, key) pair, otherwise
 * runs `create` inside the caller's transaction and remembers the result.
 */
export function withIdempotency<T extends { id: string }>(
  db: Database.Database,
  scope: string,
  key: string | undefined,
  create: () => T,
): { resource: T; replayed: boolean } {
  if (key) {
    const existing = db
      .prepare("SELECT resource_id FROM idempotency_keys WHERE scope = ? AND key = ?")
      .get(scope, key) as { resource_id: string } | undefined;
    if (existing) {
      return { resource: { id: existing.resource_id } as T, replayed: true };
    }
  }
  const resource = create();
  if (key) {
    db.prepare(
      "INSERT INTO idempotency_keys (scope, key, resource_id, created_at) VALUES (?, ?, ?, ?)",
    ).run(scope, key, resource.id, nowIso());
  }
  return { resource, replayed: false };
}
