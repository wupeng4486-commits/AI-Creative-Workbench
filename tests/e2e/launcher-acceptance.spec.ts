import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { expect, test } from "@playwright/test";

const execute = promisify(execFile);
const root = process.cwd();
async function commandEntry(file: string, args: string, env: NodeJS.ProcessEnv) {
  return execute("cmd.exe", ["/d", "/s", "/c", `""${path.join(root, file)}" ${args}"`], {
    cwd: os.tmpdir(), env, windowsHide: true, windowsVerbatimArguments: true, timeout: 60_000,
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function launcher(name: "start" | "stop", port: number, dataDir: string) {
  try {
    const result = await execute("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", `${name}-local.ps1`), "-Port", String(port), "-DataDir", dataDir], { cwd: os.tmpdir(), windowsHide: true, timeout: 60_000 });
    return { code: 0, output: result.stdout };
  } catch (error) {
    const failure = error as Error & { code: number; stdout: string; stderr: string };
    return { code: failure.code, output: `${failure.stdout}\n${failure.stderr}` };
  }
}

test("Windows 启停验证目录与实例、重复启动、错数据目录保护和重开恢复 (T24)", async ({ page, request }) => {
  test.setTimeout(180_000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-launcher-"));
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  try {
    const first = await launcher("start", port, `${dataDir}${path.sep}`);
    expect(first.code, first.output).toBe(0);
    expect(first.output).toContain("STARTED");
    const health = await (await request.get(`${baseURL}/api/system/health`)).json();
    expect(health).toMatchObject({ app: "AI Creative Workbench", projectRoot: root, dataDir });
    const record = JSON.parse(fs.readFileSync(path.join(dataDir, "logs", "server.instance.json"), "utf8").replace(/^\uFEFF/, ""));
    expect(record.pid).toBe(health.pid); expect(record.port).toBe(port);
    const again = await launcher("start", port, dataDir);
    expect(again.code, again.output).toBe(0); expect(again.output).toContain(`RUNNING ${health.pid}`);
    const otherDir = path.join(dataDir, "other-data");
    const wrongStart = await launcher("start", port, otherDir);
    expect(wrongStart.code).toBe(2); expect(wrongStart.output).toContain("PORT_BUSY");
    const wrongStop = await launcher("stop", port, otherDir);
    expect(wrongStop.code).toBe(2); expect(wrongStop.output).toContain("PORT_BUSY_OTHER_APP");
    expect((await (await request.get(`${baseURL}/api/system/health`)).json()).pid).toBe(health.pid);
    await page.goto(`${baseURL}/studio/design`);
    await page.getByRole("button", { name: "新建草稿", exact: true }).click();
    await page.getByLabel("草稿名称", { exact: true }).fill("日常入口重开草稿");
    await page.getByLabel("创作要求", { exact: true }).fill("Windows 启停保留这段要求");
    await expect(page.getByText("已保存到本机", { exact: true })).toBeVisible();
    const draftURL = page.url();
    const datasetId = (await (await request.get(`${baseURL}/api/system/info`)).json()).datasetId;
    const stopped = await launcher("stop", port, dataDir);
    expect(stopped.code, stopped.output).toBe(0); expect(stopped.output).toContain("STOPPED");
    expect(fs.existsSync(path.join(dataDir, "logs", "server.pid"))).toBe(false);
    const restarted = await launcher("start", port, dataDir);
    expect(restarted.code, restarted.output).toBe(0);
    await page.goto(draftURL);
    await expect(page.getByLabel("草稿名称", { exact: true })).toHaveValue("日常入口重开草稿");
    await expect(page.getByLabel("创作要求", { exact: true })).toHaveValue("Windows 启停保留这段要求");
    expect((await (await request.get(`${baseURL}/api/system/info`)).json()).datasetId).toBe(datasetId);
  } finally {
    await launcher("stop", port, dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("占用端口的其他 Node 服务即使返回相同应用名也会被识别并保留 (T24)", async ({ request }) => {
  test.setTimeout(90_000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-port-owner-"));
  let child: ChildProcess | undefined;
  try {
    child = spawn(process.execPath, ["tests/helpers/occupied-port.mjs", dataDir], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise<number>((resolve, reject) => {
      child!.stdout!.on("data", (chunk) => { const match = /READY (\d+)/.exec(String(chunk)); if (match) resolve(Number(match[1])); });
      child!.on("error", reject); child!.on("exit", (code) => reject(new Error(`occupant exited ${code}`)));
    });
    fs.mkdirSync(path.join(dataDir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "logs", "server.pid"), String(child.pid));
    const start = await launcher("start", port, dataDir);
    expect(start.code).toBe(2); expect(start.output).toContain("PORT_BUSY");
    const stop = await launcher("stop", port, dataDir);
    expect(stop.code).toBe(2); expect(stop.output).toContain("PORT_BUSY_OTHER_APP");
    expect((await (await request.get(`http://127.0.0.1:${port}/api/system/health`)).json()).pid).toBe(child.pid);
    expect(fs.existsSync(path.join(dataDir, "logs", "server.pid"))).toBe(true);
  } finally {
    if (child?.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("CMD 日常入口从其他工作目录启动，并在离线使用本地页面、媒体与完整恢复 (T24)", async ({ page, request, context }) => {
  test.setTimeout(180_000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-cmd-entry-"));
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const env = { ...process.env, APP_PORT: String(port), APP_DATA_DIR: dataDir };
  try {
    await commandEntry("启动平台.cmd", "--no-browser", env);
    await context.route("**/*", (route) => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
    const imported = (await (await request.post(`${baseURL}/api/assets/import`, { multipart: { file: { name: "日常入口视频.mp4", mimeType: "video/mp4", buffer: fs.readFileSync(path.join(root, "fixtures/demo/测试视频A-4秒.mp4")) } } })).json()).asset;
    await page.goto(`${baseURL}/assets/${imported.id}`);
    const video = page.locator("video");
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
    expect(await video.evaluate((node: HTMLVideoElement) => node.duration)).toBe(4);
    await page.goto(`${baseURL}/settings`);
    await page.getByRole("button", { name: "导出完整备份", exact: true }).click();
    await expect(page.getByText("完整备份已生成，可下载保存。")).toBeVisible();
    const download = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "下载完整备份", exact: true }).click()]);
    const file = { name: download[0].suggestedFilename(), mimeType: "application/zip", buffer: fs.readFileSync((await download[0].path())!) };
    const original = (await (await request.get(`${baseURL}/api/system/info`)).json()).datasetId;
    await page.getByLabel("上传备份并校验").setInputFiles(file);
    await page.getByRole("dialog", { name: "确认完整恢复" }).getByRole("button", { name: "确认替换当前数据集" }).click();
    await expect(page.getByText("完整恢复成功，已重新读取当前数据集。")).toBeVisible();
    expect((await (await request.get(`${baseURL}/api/system/info`)).json()).datasetId).not.toBe(original);
    await commandEntry("停止平台.cmd", "", env);
    await commandEntry("启动平台.cmd", "--no-browser", env);
    await page.goto(`${baseURL}/assets/${imported.id}`);
    await expect.poll(() => page.locator("video").evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
    expect(await (await request.get(`${baseURL}${imported.downloadUrl}`)).body()).toEqual(fs.readFileSync(path.join(root, "fixtures/demo/测试视频A-4秒.mp4")));
  } finally {
    await launcher("stop", port, dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
