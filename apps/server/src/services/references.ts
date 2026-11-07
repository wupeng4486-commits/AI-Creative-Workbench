import type Database from "better-sqlite3";

export interface ReferenceLocation {
  kind:
    | "draft"
    | "agent"
    | "workflow"
    | "collection"
    | "run"
    | "draft_clip"
    | "asset_version"
    | "workflow_sample";
  id: string;
  label: string;
  href: string;
}

function rows(
  db: Database.Database,
  sql: string,
  params: unknown[],
): ReferenceLocation[] {
  return db.prepare(sql).all(...params) as ReferenceLocation[];
}

/** Lists every current place that still uses an asset. */
export function assetReferences(db: Database.Database, assetId: string): ReferenceLocation[] {
  return [
    ...rows(
      db,
      `SELECT 'draft' AS kind, d.id, d.name AS label, '/studio/' || d.creation_type || '/' || d.id AS href
       FROM draft_assets da JOIN drafts d ON d.id = da.draft_id WHERE da.asset_id = ?`,
      [assetId],
    ),
    ...rows(
      db,
      `SELECT 'draft_clip' AS kind, d.id, d.name AS label, '/studio/video_join/' || d.id AS href
       FROM draft_clips dc JOIN drafts d ON d.id = dc.draft_id WHERE dc.asset_id = ?`,
      [assetId],
    ),
    ...rows(
      db,
      `SELECT 'agent' AS kind, a.id, a.name AS label, '/agents/' || a.id AS href
       FROM agent_assets aa JOIN agents a ON a.id = aa.agent_id WHERE aa.asset_id = ?`,
      [assetId],
    ),
    ...rows(
      db,
      `SELECT 'workflow' AS kind, w.id, w.name AS label, '/workflows/' || w.id AS href
       FROM workflow_assets wa JOIN team_workflows w ON w.id = wa.workflow_id WHERE wa.asset_id = ?`,
      [assetId],
    ),
    ...rows(
      db,
      `SELECT 'collection' AS kind, c.id, c.name AS label, '/assets/collections/' || c.id AS href
       FROM collection_items ci JOIN case_collections c ON c.id = ci.collection_id WHERE ci.asset_id = ?`,
      [assetId],
    ),
  ];
}

export function skillReferences(db: Database.Database, skillId: string): ReferenceLocation[] {
  return [
    ...rows(
      db,
      `SELECT 'agent' AS kind, a.id, a.name AS label, '/agents/' || a.id AS href
       FROM agent_skills s JOIN agents a ON a.id = s.agent_id WHERE s.skill_id = ?`,
      [skillId],
    ),
    ...rows(
      db,
      `SELECT 'workflow' AS kind, w.id, w.name AS label, '/workflows/' || w.id AS href
       FROM workflow_skills s JOIN team_workflows w ON w.id = s.workflow_id WHERE s.skill_id = ?`,
      [skillId],
    ),
    ...rows(
      db,
      `SELECT 'draft' AS kind, d.id, d.name AS label, '/studio/' || d.creation_type || '/' || d.id AS href
       FROM draft_skills s JOIN drafts d ON d.id = s.draft_id WHERE s.skill_id = ?`,
      [skillId],
    ),
  ];
}

export function productReferences(
  db: Database.Database,
  productId: string,
): ReferenceLocation[] {
  return [
    ...rows(
      db,
      `SELECT 'agent' AS kind, a.id, a.name AS label, '/agents/' || a.id AS href
       FROM agent_products p JOIN agents a ON a.id = p.agent_id WHERE p.product_id = ?`,
      [productId],
    ),
    ...rows(
      db,
      `SELECT 'draft' AS kind, d.id, d.name AS label, '/studio/' || d.creation_type || '/' || d.id AS href
       FROM drafts d WHERE d.product_id = ?`,
      [productId],
    ),
  ];
}

export function agentReferences(db: Database.Database, agentId: string): ReferenceLocation[] {
  return rows(
    db,
    `SELECT 'draft' AS kind, d.id, d.name AS label, '/studio/' || d.creation_type || '/' || d.id AS href
     FROM drafts d WHERE d.agent_id = ?`,
    [agentId],
  );
}

export function workflowReferences(
  db: Database.Database,
  workflowId: string,
): ReferenceLocation[] {
  return rows(
    db,
    `SELECT 'draft' AS kind, d.id, d.name AS label, '/studio/' || d.creation_type || '/' || d.id AS href
     FROM drafts d WHERE d.workflow_id = ?`,
    [workflowId],
  );
}

export function assertNotReferenced(
  references: ReferenceLocation[],
  message: string,
): void {
  if (references.length === 0) return;
  const error = new Error(message) as Error & {
    code: string;
    references: ReferenceLocation[];
  };
  error.code = "RESOURCE_REFERENCED";
  error.references = references;
  throw error;
}
