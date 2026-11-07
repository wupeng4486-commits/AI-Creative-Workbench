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
    // Windows can keep a handle for a few milliseconds after a streamed
    // response closes; retry instead of failing teardown.
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        try {
          fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
          break;
        } catch {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
          if (attempt === 24) throw error;
        }
      }
    }
  }
}
