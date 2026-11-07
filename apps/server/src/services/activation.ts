import fs from "node:fs";
import path from "node:path";
import { nowIso } from "../util/time.ts";
import { readActivePointer, writeActivePointer } from "../db/datasets.ts";

export interface ActivationJournal {
  id: string;
  phase: "prepared" | "swapped" | "active" | "rolled_back";
  fromDatasetId: string;
  toDatasetId: string;
  updatedAt: string;
}

export function journalPath(dataDir: string): string {
  return path.join(dataDir, "activation-journal.json");
}

export function readJournal(dataDir: string): ActivationJournal | null {
  const file = journalPath(dataDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ActivationJournal;
  } catch {
    return null;
  }
}

export function writeJournal(dataDir: string, journal: ActivationJournal): void {
  const file = journalPath(dataDir);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

export function clearJournal(dataDir: string): void {
  fs.rmSync(journalPath(dataDir), { force: true });
}

/**
 * Called before the service starts serving. Completes an interrupted switch
 * when the new dataset is healthy, otherwise rolls the pointer back to the
 * last complete dataset.
 */
export function recoverInterruptedActivation(
  dataDir: string,
  healthCheck: (datasetId: string) => boolean,
): { action: "none" | "completed" | "rolled_back"; datasetId: string } {
  const journal = readJournal(dataDir);
  const pointer = readActivePointer(dataDir);
  if (!journal) {
    return { action: "none", datasetId: pointer?.datasetId ?? "" };
  }
  if (journal.phase === "active" || journal.phase === "rolled_back") {
    clearJournal(dataDir);
    return { action: "none", datasetId: pointer?.datasetId ?? journal.toDatasetId };
  }
  if (healthCheck(journal.toDatasetId)) {
    writeJournal(dataDir, { ...journal, phase: "active", updatedAt: nowIso() });
    writeActivePointer(dataDir, {
      datasetId: journal.toDatasetId,
      activatedAt: nowIso(),
      previousDatasetId: journal.fromDatasetId,
    });
    clearJournal(dataDir);
    return { action: "completed", datasetId: journal.toDatasetId };
  }
  writeActivePointer(dataDir, {
    datasetId: journal.fromDatasetId,
    activatedAt: nowIso(),
    previousDatasetId: pointer?.previousDatasetId ?? null,
  });
  writeJournal(dataDir, { ...journal, phase: "rolled_back", updatedAt: nowIso() });
  clearJournal(dataDir);
  return { action: "rolled_back", datasetId: journal.fromDatasetId };
}
