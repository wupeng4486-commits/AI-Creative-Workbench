import type Database from "better-sqlite3";
import { newId } from "../util/id.ts";
import { nowIso } from "../util/time.ts";

export type ResourceType =
  | "agent"
  | "skill"
  | "asset"
  | "product"
  | "workflow"
  | "draft"
  | "run"
  | "connector"
  | "collection";

export function recordActivity(
  db: Database.Database,
  resourceType: ResourceType,
  resourceId: string,
  action: string,
  snapshot: Record<string, unknown>,
  demo = false,
): void {
  db.prepare(
    `INSERT INTO activities (id, action, resource_type, resource_id, display_snapshot, demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId(), action, resourceType, resourceId, JSON.stringify(snapshot), demo ? 1 : 0, nowIso());
}

export function recordRecent(
  db: Database.Database,
  resourceType: ResourceType,
  resourceId: string,
  snapshot: Record<string, unknown>,
): void {
  db.prepare(
    `INSERT INTO recent_items (resource_type, resource_id, display_snapshot, visited_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(resource_type, resource_id) DO UPDATE SET
       display_snapshot = excluded.display_snapshot,
       visited_at = excluded.visited_at`,
  ).run(resourceType, resourceId, JSON.stringify(snapshot), nowIso());
}
