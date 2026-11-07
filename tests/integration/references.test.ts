import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { openActiveDataset } from "../../apps/server/src/db/datasets.ts";
import { seedDatabase } from "../../apps/server/src/db/seed.ts";
import { createAsset, deleteAsset, findAsset, updateAsset } from "../../apps/server/src/services/assets.ts";
import { withIdempotency } from "../../apps/server/src/services/idempotency.ts";
import {
  assetReferences,
  productReferences,
  skillReferences,
} from "../../apps/server/src/services/references.ts";
import {
  buildSnapshot,
  insertRun,
  keepRunFile,
  markUnfinishedRunsInterrupted,
} from "../../apps/server/src/services/snapshots.ts";
import {
  commitStagedFile,
  guessMimeType,
  insertFile,
  stageUpload,
} from "../../apps/server/src/storage/files.ts";
import { newId } from "../../apps/server/src/util/id.ts";
import { nowIso } from "../../apps/server/src/util/time.ts";
import { cleanupDirs, tempDataDir } from "../helpers/app.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/demo");

afterEach(cleanupDirs);

async function withImportedImage() {
  const dataDir = tempDataDir();
  const dataset = openActiveDataset(dataDir);
  seedDatabase(dataset.db);
  const staged = await stageUpload(
    path.join(dataDir, "staging", "uploads"),
    Readable.from(fs.readFileSync(path.join(fixtures, "测试产品图.png"))),
  );
  const committed = commitStagedFile(
    dataset.dir,
    staged.stagingPath,
    "测试产品图.png",
    guessMimeType("测试产品图.png"),
    staged.sha256,
  );
  const file = insertFile(dataset.db, committed);
  return { dataDir, dataset, file };
}

describe("references, transactions and history (T05)", () => {
  it("blocks deletion of an asset used by a draft and reports the location", async () => {
    const { dataset } = await withImportedImage();
    const fileRow = dataset.db.prepare("SELECT id FROM files").get() as { id: string };
    const asset = createAsset(dataset.db, { name: "测试图", fileId: fileRow.id });
    expect(asset.id).toBeTruthy();
    const draftId = newId();
    dataset.db
      .prepare(
        `INSERT INTO drafts (id, creation_type, name, created_at, updated_at) VALUES (?, 'ai_image', '草稿', ?, ?)`,
      )
      .run(draftId, nowIso(), nowIso());
    dataset.db
      .prepare("INSERT INTO draft_assets (draft_id, asset_id) VALUES (?, ?)")
      .run(draftId, asset.id);

    expect(assetReferences(dataset.db, asset.id)).toEqual([
      expect.objectContaining({ kind: "draft", id: draftId, label: "草稿" }),
    ]);
    expect(() => deleteAsset(dataset.db, dataset.dir, asset.id)).toThrowError(/仍被引用/);
    expect(findAsset(dataset.db, asset.id)).toBeTruthy();

    dataset.db.prepare("DELETE FROM draft_assets WHERE draft_id = ?").run(draftId);
    const result = deleteAsset(dataset.db, dataset.dir, asset.id);
    expect(result.deleted).toBe(true);
    expect(findAsset(dataset.db, asset.id)).toBeUndefined();
    dataset.db.close();
  });

  it("keeps a file that historical runs still need after asset deletion", async () => {
    const { dataset } = await withImportedImage();
    const fileRow = dataset.db.prepare("SELECT id FROM files").get() as { id: string };
    const asset = createAsset(dataset.db, { name: "历史成果", fileId: fileRow.id });
    const run = insertRun(dataset.db, {
      owner: "draft",
      kind: "ai_image",
      status: "completed",
      snapshot: buildSnapshot(dataset.db, { inputs: {}, parameters: {} }),
    });
    keepRunFile(dataset.db, run.id, fileRow.id, "result");

    const result = deleteAsset(dataset.db, dataset.dir, asset.id);
    expect(result.retainedFile).toBe(true);
    expect(dataset.db.prepare("SELECT id FROM files WHERE id = ?").get(fileRow.id)).toBeTruthy();
    const filePath = path.join(
      dataset.dir,
      "files",
      (
        dataset.db.prepare("SELECT relative_path FROM files WHERE id = ?").get(fileRow.id) as {
          relative_path: string;
        }
      ).relative_path,
    );
    expect(fs.existsSync(filePath)).toBe(true);
    dataset.db.close();
  });

  it("creates one record for a repeated idempotent request", async () => {
    const { dataset } = await withImportedImage();
    const fileRow = dataset.db.prepare("SELECT id FROM files").get() as { id: string };
    const first = dataset.db.transaction(() =>
      withIdempotency(dataset.db, "archive", "run-1:item-1", () =>
        createAsset(dataset.db, { name: "归档", fileId: fileRow.id }),
      ),
    )();
    const second = dataset.db.transaction(() =>
      withIdempotency(dataset.db, "archive", "run-1:item-1", () =>
        createAsset(dataset.db, { name: "归档重复", fileId: fileRow.id }),
      ),
    )();
    expect(second.replayed).toBe(true);
    expect(second.resource.id).toBe(first.resource.id);
    const count = dataset.db.prepare("SELECT COUNT(*) AS c FROM assets").get() as { c: number };
    expect(count.c).toBe(1);
    dataset.db.close();
  });

  it("rolls back the asset when the transaction fails", async () => {
    const { dataset } = await withImportedImage();
    const fileRow = dataset.db.prepare("SELECT id FROM files").get() as { id: string };
    const failing = dataset.db.transaction(() => {
      const created = createAsset(dataset.db, { name: "会回滚", fileId: fileRow.id });
      expect(created.id).toBeTruthy();
      throw new Error("later step failed");
    });
    expect(() => failing()).toThrowError("later step failed");
    const count = dataset.db.prepare("SELECT COUNT(*) AS c FROM assets").get() as { c: number };
    expect(count.c).toBe(0);
    const activities = dataset.db
      .prepare("SELECT COUNT(*) AS c FROM activities WHERE action LIKE '导入资产%'")
      .get() as { c: number };
    expect(activities.c).toBe(0);
    // The file already written to disk stays registered; no asset points at it.
    expect(dataset.db.prepare("SELECT id FROM files WHERE id = ?").get(fileRow.id)).toBeTruthy();
    dataset.db.close();
  });

  it("freezes run snapshots against later edits", () => {
    const dataDir = tempDataDir();
    const dataset = openActiveDataset(dataDir);
    seedDatabase(dataset.db);
    const snapshot = buildSnapshot(dataset.db, {
      inputs: { prompt: "第一版要求" },
      parameters: { ratio: "9:16" },
      agentId: "seed-agent-director",
      skillIds: ["seed-skill-video-breakdown"],
    });
    const run = insertRun(dataset.db, {
      owner: "studio",
      kind: "ai_video",
      status: "completed",
      snapshot,
    });
    dataset.db
      .prepare("UPDATE agents SET name = ?, instructions = ? WHERE id = ?")
      .run("改名后", "新指令", "seed-agent-director");
    const stored = dataset.db
      .prepare("SELECT input_snapshot FROM runs WHERE id = ?")
      .get(run.id) as { input_snapshot: string };
    expect(JSON.parse(stored.input_snapshot).resources).toContainEqual({
      id: "seed-agent-director",
      name: "电商广告导演",
      kind: "agent",
    });
    expect(JSON.parse(stored.input_snapshot).inputs.prompt).toBe("第一版要求");
    dataset.db.close();
  });

  it("marks unfinished runs interrupted on startup", () => {
    const dataDir = tempDataDir();
    const dataset = openActiveDataset(dataDir);
    seedDatabase(dataset.db);
    const snapshot = buildSnapshot(dataset.db, { inputs: {}, parameters: {} });
    const run = insertRun(dataset.db, { owner: "studio", kind: "ai_video", status: "running", snapshot });
    expect(markUnfinishedRunsInterrupted(dataset.db)).toBe(1);
    const row = dataset.db.prepare("SELECT status, finished_at FROM runs WHERE id = ?").get(run.id) as {
      status: string;
      finished_at: string | null;
    };
    expect(row.status).toBe("interrupted");
    expect(row.finished_at).toBeTruthy();
    dataset.db.close();
  });

  it("reports skill and product references with labels", () => {
    const dataDir = tempDataDir();
    const dataset = openActiveDataset(dataDir);
    seedDatabase(dataset.db);
    const skillRefs = skillReferences(dataset.db, "seed-skill-video-breakdown");
    expect(skillRefs).toContainEqual(
      expect.objectContaining({ kind: "agent", id: "seed-agent-director" }),
    );
    expect(skillRefs).toContainEqual(
      expect.objectContaining({ kind: "workflow", id: "seed-workflow-tietie" }),
    );
    expect(productReferences(dataset.db, "seed-product-sunscreen")).toEqual([]);
    dataset.db.close();
  });

  it("updates assets in a transaction and records activity", async () => {
    const { dataset } = await withImportedImage();
    const fileRow = dataset.db.prepare("SELECT id FROM files").get() as { id: string };
    const asset = createAsset(dataset.db, { name: "原名", fileId: fileRow.id, tags: ["a"] });
    const updated = updateAsset(dataset.db, asset.id, { name: "新名", tags: ["a", "b"] });
    expect(updated.name).toBe("新名");
    expect(updated.tags).toEqual(["a", "b"]);
    const activities = dataset.db
      .prepare("SELECT action FROM activities WHERE resource_id = ? ORDER BY rowid")
      .all(asset.id) as Array<{ action: string }>;
    expect(activities.map((row) => row.action)).toEqual(["导入资产：原名", "编辑资产：新名"]);
    dataset.db.close();
  });
});
