import type Database from "better-sqlite3";
import type { AppConfig } from "./config.ts";
import { openActiveDataset, type OpenedDataset } from "./db/datasets.ts";
import { seedDatabase } from "./db/seed.ts";
import { WriteBarrier } from "./services/backup.ts";

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
  const dataset = openActiveDataset(config.dataDir);
  seedDatabase(dataset.db);
  const context: AppContext = {
    config,
    dataset,
    db: dataset.db,
    datasetId: dataset.datasetId,
    barrier: new WriteBarrier(),
    close() {
      if (dataset.db.open) {
        try {
          dataset.db.pragma("wal_checkpoint(TRUNCATE)");
        } catch {
          // A busy checkpoint still allows a clean close.
        }
        dataset.db.close();
      }
    },
    reopen() {
      const next = openActiveDataset(config.dataDir);
      seedDatabase(next.db);
      context.dataset = next;
      context.db = next.db;
      context.datasetId = next.datasetId;
    },
  };
  return context;
}
