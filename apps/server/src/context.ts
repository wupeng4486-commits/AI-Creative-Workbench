import type Database from "better-sqlite3";
import type { AppConfig } from "./config.ts";
import { openActiveDataset, type OpenedDataset } from "./db/datasets.ts";
import { seedDatabase } from "./db/seed.ts";
import { WriteBarrier } from "./services/backup.ts";
import { recoverOnStartup } from "./services/restore.ts";

export interface AppContext {
  config: AppConfig;
  dataset: OpenedDataset;
  db: Database.Database;
  datasetId: string;
  barrier: WriteBarrier;
  close(): void;
  reopen(): void;
}

export function createContext(config: AppConfig): AppContext {
  recoverOnStartup(config.dataDir);
  const dataset = openActiveDataset(config.dataDir);
  seedDatabase(dataset.db);
  const context: AppContext = {
    config,
    dataset,
    db: dataset.db,
    datasetId: dataset.datasetId,
    barrier: new WriteBarrier(),
    close() {
      // Use the mutable context, not the initial closure: a restore swaps in a
      // new dataset and closing the stale handle would leak the new one.
      const active = context.dataset;
      if (active.db.open) {
        try {
          active.db.pragma("wal_checkpoint(TRUNCATE)");
        } catch {
          // A busy checkpoint still allows a clean close.
        }
        active.db.close();
      }
    },
    reopen() {
      if (context.db.open) context.db.close();
      const next = openActiveDataset(config.dataDir);
      seedDatabase(next.db);
      context.dataset = next;
      context.db = next.db;
      context.datasetId = next.datasetId;
    },
  };
  return context;
}
