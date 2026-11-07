import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { expect, test, type APIRequestContext } from "@playwright/test";

test("实际浏览器退出、服务进程终止重启和隔离恢复保留顺序、历史、来源与原文件 (DATA-01、BACK-02)", async ({ playwright }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-restart-"));
  let child: ChildProcess | undefined;
  let client: APIRequestContext | undefined;
  async function start() {
    child = spawn(process.execPath, ["tests/helpers/server-process.mjs"], { cwd: process.cwd(), env: { ...process.env, APP_DATA_DIR: dir, NODE_ENV: "test" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise<number>((resolve, reject) => {
      let output = "";
      child!.stdout!.on("data", (chunk) => { output += chunk; const match = /READY (\d+)/.exec(output); if (match) resolve(Number(match[1])); });
      child!.once("error", reject); child!.once("exit", (code) => reject(new Error(`server exited ${code}`)));
    });
    const baseURL = `http://127.0.0.1:${port}`;
    client = await playwright.request.newContext({ baseURL });
    return baseURL;
  }
  async function stop() {
    await client?.dispose(); client = undefined;
    if (child?.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
  try {
    let baseURL = await start();
    const assets = [];
    for (const name of ["测试视频C-5秒.mp4", "测试视频A-4秒.mp4"]) {
      const response = await client!.post("/api/assets/import", { multipart: { file: { name, mimeType: "video/mp4", buffer: fs.readFileSync(path.resolve("fixtures/demo", name)) } } });
      expect(response.ok()).toBe(true); assets.push((await response.json()).asset);
    }
    const draft = (await (await client!.post("/api/drafts", { data: { creationType: "video_join", name: "重启验证草稿", requirements: "C 再 A，保留九秒", clipAssetIds: assets.map((asset) => asset.id) } })).json()).draft;
    const run = await (await client!.post("/api/runs", { data: { owner: "draft", ownerId: draft.id, requirements: "", draftRevision: draft.revision } })).json();
    await expect.poll(async () => (await (await client!.get(`/api/runs/${run.id}`)).json()).status).toBe("completed");
    const completed = await (await client!.get(`/api/runs/${run.id}`)).json();
    const archived = await (await client!.post("/api/results/archive", { data: { runId: run.id, resultItemId: completed.items[0].id } })).json();
    const backup = await (await client!.post("/api/backups")).json();
    const zip = await (await client!.get(backup.downloadUrl)).body();
    const beforeDataset = (await (await client!.get("/api/system/info")).json()).datasetId;
    let browser = await playwright.chromium.launch();
    let page = await browser.newPage();
    await page.goto(`${baseURL}/studio/video_join/${draft.id}`);
    await expect(page.getByRole("list", { name: "片段顺序", exact: true }).getByRole("listitem")).toHaveText(assets.map((asset) => asset.name));
    await browser.close();
    await stop(); baseURL = await start();
    browser = await playwright.chromium.launch();
    try {
      page = await browser.newPage(); await page.goto(`${baseURL}/studio/video_join/${draft.id}`);
      await expect(page.getByLabel("简单输出要求", { exact: true })).toHaveValue("C 再 A，保留九秒");
      await expect(page.getByRole("list", { name: "片段顺序", exact: true }).getByRole("listitem")).toHaveText(assets.map((asset) => asset.name));
      await expect(page.getByLabel("合计时长", { exact: true })).toHaveText("合计时长 9秒");
      const restoredAsset = (await (await client!.get(`/api/assets/${archived.asset.id}`)).json()).asset;
      expect(restoredAsset.sourceSnapshot).toEqual(archived.asset.sourceSnapshot);
      expect((await (await client!.get("/api/system/info")).json()).datasetId).toBe(beforeDataset);
      const preview = await (await client!.post("/api/restores/upload", { multipart: { file: { name: "restart.zip", mimeType: "application/zip", buffer: zip } } })).json();
      const confirmed = await client!.post(`/api/restores/${preview.preview.id}/confirm`, { data: { datasetId: beforeDataset } });
      expect(confirmed.ok()).toBe(true);
      for (const asset of assets) {
        const bytes = await (await client!.get(asset.downloadUrl)).body();
        expect(bytes).toEqual(fs.readFileSync(path.resolve("fixtures/demo", asset.name)));
      }
      await page.reload();
      await expect(page.getByRole("list", { name: "片段顺序", exact: true }).getByRole("listitem")).toHaveText(assets.map((asset) => asset.name));
      expect((await (await client!.get(`/api/assets/${archived.asset.id}`)).json()).asset.sourceSnapshot).toEqual(archived.asset.sourceSnapshot);
    } finally { await browser.close(); }
  } finally { await stop(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
