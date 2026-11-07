import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

describe("local launchers (T02)", () => {
  it("provides a double-click launcher that opens the fixed local address", () => {
    const launcher = read("启动平台.cmd");
    expect(launcher).toContain("scripts\\start-local.ps1");
    expect(launcher).toContain("http://127.0.0.1:%APP_PORT%/");
    expect(launcher).toContain("npm run build");
    expect(launcher).toContain("\r\n");
    expect(read("停止平台.cmd")).toContain("\r\n");
  });

  it("starts hidden, records the pid and only reports started after health passes", () => {
    const script = read("scripts/start-local.ps1");
    const instance = read("scripts/local-instance.ps1");
    expect(script).toContain("-WindowStyle Hidden");
    expect(instance).toContain("server.pid");
    expect(instance).toContain("/api/system/health");
    expect(instance).toContain("$health.projectRoot");
    expect(instance).toContain("$health.dataDir");
    expect(instance).toContain("$listeners.OwningProcess");
    expect(script).toContain("PORT_BUSY");
  });

  it("stops only processes that match this application", () => {
    const script = read("scripts/stop-local.ps1");
    expect(script).toContain("Get-WorkbenchInstance");
    expect(script).toContain("CreationDate");
    expect(read("scripts/local-instance.ps1")).toContain("Test-WorkbenchProcess");
    expect(read("scripts/local-instance.ps1")).toContain("apps/server/dist/index.js");
    expect(script).toContain("PORT_BUSY_OTHER_APP");
    expect(script).toContain("NOT_RUNNING");
  });

  it("documents the port and engines of the runtime", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.engines.node).toBe(">=22.17.0");
    expect(pkg.scripts["start:local"]).toContain("apps/server/dist/index.js");
    expect(read("apps/server/src/config.ts")).toContain("127.0.0.1");
  });
});
