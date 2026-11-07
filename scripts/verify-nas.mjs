import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { buildApp } from "../apps/server/dist/app.js";
import { createConfig } from "../apps/server/dist/config.js";

const address = new URL(process.argv[2]);
assert(["http:", "https:"].includes(address.protocol), "请提供 HTTP 或 HTTPS 网页地址。");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, ".tmp", "nas-acceptance");
fs.mkdirSync(evidenceDir, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(evidenceDir, "data-"));
const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
let browser;
try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const baseURL = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${baseURL}/assets`);
  await page.getByRole("tab", { name: "NAS 入口" }).click();
  await page.getByLabel("NAS 名称").fill("真实 NAS 验收入口");
  await page.getByLabel("NAS 地址").fill(address.href);
  await page.getByRole("button", { name: "保存入口", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("NAS 入口已保存。");
  const popupWait = page.waitForEvent("popup");
  const responseWait = page.context().waitForEvent("response", {
    predicate: (response) => response.request().isNavigationRequest() && new URL(response.url()).origin === address.origin,
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "打开网页", exact: true }).click();
  const popup = await popupWait;
  const response = await responseWait;
  assert.equal(response.status(), 200, "NAS 网页未返回成功状态。");
  await popup.waitForLoadState("domcontentloaded");
  assert.equal(new URL(popup.url()).origin, address.origin);
  await expect(popup.locator("body")).toBeVisible();
  const title = await popup.title();
  assert(title.trim(), "NAS 网页没有可读取标题。");
  await popup.screenshot({ path: path.join(evidenceDir, "nas-page.png"), fullPage: true });
  const evidence = {
    status: "passed_live_nas",
    verifiedAt: new Date().toISOString(),
    configuredAddress: address.href,
    openedAddress: popup.url(),
    httpStatus: response.status(),
    title,
    openedThrough: "资产库 / NAS 入口 / 打开网页",
    screenshot: ".tmp/nas-acceptance/nas-page.png",
  };
  fs.writeFileSync(path.join(evidenceDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  await app.close();
}
