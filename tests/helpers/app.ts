import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../apps/server/src/app.ts";
import { createConfig } from "../../apps/server/src/config.ts";

const dirs: string[] = [];

export function tempDataDir(prefix = "aiw-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export async function makeApp(dataDir = tempDataDir()): Promise<FastifyInstance> {
  const config = createConfig({ APP_DATA_DIR: dataDir });
  return buildApp({ config });
}

export function cleanupDirs(): void {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
