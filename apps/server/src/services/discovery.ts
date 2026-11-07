import type Database from "better-sqlite3";
import { listAgents } from "./agents.ts";
import { listSkills } from "./skills.ts";
import { listWorkflows } from "./workflows.ts";
import { listAssets } from "./assets.ts";
import { parseJson } from "../util/time.ts";

export function discoveryIndex(db: Database.Database) {
  return [
    ...listAgents(db, {}).map((item) => ({ id: item.id, type: "agent", name: item.name, description: `${item.purpose} ${item.domain}`, tags: [] as string[], origin: item.origin, demo: item.id.startsWith("seed-"), updatedAt: item.updated_at, href: `/agents/${item.id}` })),
    ...listSkills(db, {}).map((item) => ({ id: item.id, type: "skill", name: item.name, description: `${item.scenario} ${item.input_spec}`, tags: item.tags, origin: item.origin, demo: item.id.startsWith("seed-"), updatedAt: item.updated_at, href: `/skills/${item.id}` })),
    ...listAssets(db).map((item) => ({ id: item.id, type: "asset", name: item.name, description: item.notes, tags: item.tags, origin: item.origin, demo: item.provenance !== "user_import", updatedAt: item.updated_at, href: `/assets/${item.id}`, sharedFile: item.catalog !== "product" && item.asset_type !== "product" && Boolean(item.file_id) })),
    ...listWorkflows(db, {}).map((item) => ({ id: item.id, type: "workflow", name: item.name, description: `${item.purpose} ${item.input_spec}`, tags: [] as string[], origin: item.origin, demo: item.id.startsWith("seed-") || Boolean(item.sourceSnapshot?.demo), updatedAt: item.updated_at, href: `/workflows/${item.id}` })),
  ];
}

export function homeOverview(db: Database.Database, type?: string) {
  const index = discoveryIndex(db);
  const lookup = new Map(index.map((item) => [`${item.type}:${item.id}`, item]));
  const resolve = (resourceType: string, id: string): { href: string; name: string; demo: boolean } | undefined => {
    const item = lookup.get(`${resourceType}:${id}`);
    if (item) return item;
    if (resourceType === "draft") {
      const draft = db.prepare("SELECT name, creation_type FROM drafts WHERE id = ?").get(id) as { name: string; creation_type: string } | undefined;
      if (draft) return { name: draft.name, href: `/studio/${draft.creation_type}/${id}`, demo: false };
    }
    if (resourceType === "run") {
      const run = db.prepare("SELECT owner, owner_id, demo FROM runs WHERE id = ?").get(id) as { owner: string; owner_id: string; demo: number } | undefined;
      const owner = run && resolve(run.owner, run.owner_id);
      if (owner) return { ...owner, href: `${owner.href}?runId=${id}`, demo: Boolean(run!.demo) };
    }
    if (resourceType === "connector" && db.prepare("SELECT id FROM connectors WHERE id = ?").get(id)) return { name: "连接器", href: "/connectors", demo: true };
    if (resourceType === "collection" && db.prepare("SELECT id FROM case_collections WHERE id = ?").get(id)) return { name: "案例集", href: `/assets/collections/${id}`, demo: false };
    return undefined;
  };
  const recentRows = db.prepare("SELECT * FROM recent_items ORDER BY visited_at DESC").all() as Array<{ resource_type: string; resource_id: string; visited_at: string }>;
  const activityRows = db.prepare("SELECT * FROM activities ORDER BY created_at DESC, rowid DESC LIMIT 30").all() as Array<{ id: string; resource_type: string; resource_id: string; action: string; display_snapshot: string; demo: number; created_at: string }>;
  return {
    counts: { agents: listAgents(db, {}).length, skills: listSkills(db, {}).length, sharedFiles: listAssets(db, { origin: "shared", filesOnly: "1" }).length, workflows: listWorkflows(db, {}).length },
    shared: index.filter((item) => item.origin === "shared" && (item.type !== "asset" || ("sharedFile" in item && item.sharedFile)) && (!type || type === "all" || item.type === type)),
    recent: recentRows.flatMap((row) => {
      const target = resolve(row.resource_type, row.resource_id);
      return target ? [{ ...target, id: row.resource_id, type: row.resource_type, visitedAt: row.visited_at }] : [];
    }).slice(0, 12),
    activities: activityRows.map((row) => {
      const target = resolve(row.resource_type, row.resource_id);
      return { id: row.id, action: row.action, demo: Boolean(row.demo), createdAt: row.created_at, href: target?.href ?? null, snapshot: parseJson(row.display_snapshot, {}) };
    }),
  };
}
