import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/server/src/app.ts";
import { createConfig } from "../../apps/server/src/config.ts";

const dirs: string[] = [];

function makeApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-system-"));
  dirs.push(dataDir);
  const config = createConfig({ APP_DATA_DIR: dataDir });
  return { config, app: buildApp({ config }) };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("system routes (T02)", () => {
  it("reports healthy and the actual data directory", async () => {
    const { config, app: promise } = makeApp();
    const app = await promise;
    const health = await app.inject({ url: "/api/system/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true });
    expect(health.json()).toMatchObject({ app: "AI Creative Workbench", pid: process.pid, projectRoot: config.projectRoot, dataDir: config.dataDir });

    const info = await app.inject({ url: "/api/system/info" });
    expect(info.statusCode).toBe(200);
    expect(info.json().dataDir).toBe(config.dataDir);
    expect(fs.existsSync(config.dataDir)).toBe(true);
    await app.close();
  });

  it("keeps the same data directory across restarts", async () => {
    const first = await makeApp().app;
    await first.inject({ url: "/api/system/info" });
    const firstInfo = (await first.inject({ url: "/api/system/info" })).json();
    await first.close();

    const config = createConfig({ APP_DATA_DIR: firstInfo.dataDir });
    const second = await buildApp({ config });
    const secondInfo = (await second.inject({ url: "/api/system/info" })).json();
    expect(secondInfo.dataDir).toBe(firstInfo.dataDir);
    await second.close();
  });

  it("rejects requests whose Host header is not the local app", async () => {
    const app = await makeApp().app;
    const response = await app.inject({
      url: "/api/system/info",
      headers: { host: "example.com" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("HOST_NOT_ALLOWED");
    await app.close();
  });

  it("rejects cross-origin writes but allows local origin", async () => {
    const app = await makeApp().app;
    app.post("/api/system/ping", async () => ({ ok: true }));
    const blocked = await app.inject({
      method: "POST",
      url: "/api/system/ping",
      headers: { origin: "https://evil.example" },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("ORIGIN_NOT_ALLOWED");

    const allowed = await app.inject({
      method: "POST",
      url: "/api/system/ping",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("returns a JSON error for unknown api routes and a shell for pages", async () => {
    const app = await makeApp().app;
    const api = await app.inject({ url: "/api/unknown" });
    expect(api.statusCode).toBe(404);
    expect(api.json().code).toBe("NOT_FOUND");

    const page = await app.inject({ url: "/agents" });
    expect([200, 503]).toContain(page.statusCode);
    await app.close();
  });
});
