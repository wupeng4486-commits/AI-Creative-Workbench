import type Database from "better-sqlite3";
import type { AppConfig } from "./config.ts";
import { openActiveDataset, type OpenedDataset } from "./db/datasets.ts";
import { seedDatabase } from "./db/seed.ts";

export interface AppContext {
  config: AppConfig;
  dataset: OpenedDataset;
  db: Database.Database;
  datasetId: string;
  close(): void;
}

export function createContext(config: AppConfig): AppContext {
  const dataset = openActiveDataset(config.dataDir);
  seedDatabase(dataset.db);
  return {
    config,
    dataset,
    db: dataset.db,
    datasetId: dataset.datasetId,
    close() {
      if (dataset.db.open) dataset.db.close();
    },
  };
}
