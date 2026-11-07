import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import os from "node:os";

const port = 4401;
const dataDir = path.join(
  os.tmpdir(),
  `ai-workbench-e2e-${Date.now().toString(36)}`,
);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node apps/server/dist/index.js",
    url: `http://127.0.0.1:${port}/api/system/health`,
    reuseExistingServer: false,
    env: { APP_PORT: String(port), APP_DATA_DIR: dataDir, NODE_ENV: "test" },
    timeout: 60_000,
  },
});
