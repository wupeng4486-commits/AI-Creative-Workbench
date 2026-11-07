import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/server/src/app.ts";
import { createConfig } from "../../apps/server/src/config.ts";
import { seedDatabase, SEED_AGENTS, SEED_SKILLS, SEED_VERSION } from "../../apps/server/src/db/seed.ts";
import { openActiveDataset } from "../../apps/server/src/db/datasets.ts";
import { currentSchemaVersion } from "../../apps/server/src/db/migrations.ts";
import { cleanupDirs, tempDataDir } from "../helpers/app.ts";

afterEach(cleanupDirs);

async function counts(app: Awaited<ReturnType<typeof buildApp>>) {
  const info = await app.inject({ url: "/api/system/info" });
  return info.json().counts as Record<string, number>;
}

describe("dataset bootstrap and seed (T03)", () => {
  it("creates one dataset, applies migrations and seeds samples once", async () => {
    const dataDir = tempDataDir();
    const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
    const first = await counts(app);
    expect(first.agents).toBe(SEED_AGENTS.length);
    expect(first.skills).toBe(SEED_SKILLS.length);
    expect(first.workflows).toBe(4);
    expect(first.products).toBe(1);
    await app.close();

    for (let i = 0; i < 2; i += 1) {
      const reopened = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
      expect(await counts(reopened)).toEqual(first);
      const pointer = JSON.parse(
        fs.readFileSync(path.join(dataDir, "active.json"), "utf8"),
      );
      expect(pointer.datasetId).toBeTruthy();
      await reopened.close();
    }
  });

  it("keeps user edits and never updates seeded rows on restart", () => {
    const dataDir = tempDataDir();
    const first = openActiveDataset(dataDir);
    seedDatabase(first.db);
    first.db
      .prepare("UPDATE agents SET name = ?, updated_at = ? WHERE id = ?")
      .run("我改过的名字", new Date().toISOString(), "seed-agent-director");
    expect(seedDatabase(first.db)).toEqual({ applied: false, version: SEED_VERSION });
    first.db.close();

    const second = openActiveDataset(dataDir);
    const row = second.db
      .prepare("SELECT name FROM agents WHERE id = ?")
      .get("seed-agent-director") as { name: string };
    expect(row.name).toBe("我改过的名字");
    expect(seedDatabase(second.db)).toEqual({ applied: false, version: SEED_VERSION });
    second.db.close();
  });

  it("does not recreate a seeded sample after the user deletes it", () => {
    const dataDir = tempDataDir();
    const first = openActiveDataset(dataDir);
    seedDatabase(first.db);
    first.db.prepare("DELETE FROM agent_skills WHERE agent_id = ?").run("seed-agent-qc");
    first.db.prepare("DELETE FROM agents WHERE id = ?").run("seed-agent-qc");
    first.db
      .prepare("INSERT OR IGNORE INTO seed_tombstones (seed_id, removed_at) VALUES (?, ?)")
      .run("seed-agent-qc", new Date().toISOString());
    first.db.close();

    const second = openActiveDataset(dataDir);
    const count = second.db
      .prepare("SELECT COUNT(*) AS c FROM agents WHERE id = ?")
      .get("seed-agent-qc") as { c: number };
    expect(count.c).toBe(0);
    second.db.close();
  });

  it("enables foreign keys and records the schema version", () => {
    const dataDir = tempDataDir();
    const dataset = openActiveDataset(dataDir);
    expect(dataset.db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(currentSchemaVersion(dataset.db)).toBe(5);
    expect(() =>
      dataset.db
        .prepare(
          "INSERT INTO collection_items (collection_id, asset_id) VALUES ('missing', 'missing')",
        )
        .run(),
    ).toThrow();
    const rejectsOrigin = () =>
      dataset.db
        .prepare(
          "INSERT INTO agents (id, name, purpose, origin, created_at, updated_at) VALUES ('x', 'n', 'p', 'bogus', 't', 't')",
        )
        .run();
    expect(rejectsOrigin).toThrow();
    dataset.db.close();
  });

  it("keeps the active dataset pointer stable and valid", async () => {
    const dataDir = tempDataDir();
    const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
    const info = (await app.inject({ url: "/api/system/info" })).json();
    const pointer = JSON.parse(fs.readFileSync(path.join(dataDir, "active.json"), "utf8"));
    expect(pointer.datasetId).toBe(info.datasetId);
    expect(
      fs.existsSync(path.join(dataDir, "datasets", info.datasetId, "database.sqlite")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(dataDir, "staging", "uploads")),
    ).toBe(true);
    await app.close();
  });

  it("exposes shared settings from one source", async () => {
    const dataDir = tempDataDir();
    const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
    const settings = (await app.inject({ url: "/api/system/settings" })).json();
    expect(settings.integrations.libtv).toEqual({ url: "", note: "" });
    expect(settings.preferences).toEqual({ sidebarCollapsed: false, assetView: "list" });
    await app.close();
  });

  it("upgrades an older schema by applying only pending migrations", () => {
    const dataDir = tempDataDir();
    const dir = path.join(dataDir, "datasets", "ds-legacy");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "active.json"),
      JSON.stringify({ datasetId: "ds-legacy", activatedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const legacy = new Database(path.join(dir, "database.sqlite"));
    legacy.exec(
      "CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    legacy.prepare("INSERT INTO schema_migrations VALUES ('000-legacy', '2026-01-01')").run();
    legacy.close();

    const dataset = openActiveDataset(dataDir);
    const versions = dataset.db
      .prepare("SELECT id FROM schema_migrations ORDER BY id")
      .all() as Array<{ id: string }>;
    expect(versions.map((row) => row.id)).toContain("000-legacy");
    expect(versions.map((row) => row.id)).toContain("001-initial");
    expect(currentSchemaVersion(dataset.db)).toBe(6);
    dataset.db.close();
  });
});
