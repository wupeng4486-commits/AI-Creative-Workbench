import { expect, test } from "@playwright/test";

test("四个 LibTV 示例可保存为团队流程，批量演示保留参数与有效预览 (WF-02、WF-04)", async ({ page }) => {
  await page.goto("/workflows?tab=libtv");
  await expect(page.getByText("尚未接入 LibTV。以下四项为可复用的本地演示示例。")).toBeVisible();
  await expect(page.getByRole("button", { name: /^参数与演示 ·/ })).toHaveCount(4);
  await page.getByRole("button", { name: "参数与演示 · 批量替换产品包装", exact: true }).click();
  await page.getByLabel("本次演示要求", { exact: true }).fill("T14 包装批量测试");
  await page.getByLabel("使用本地测试素材", { exact: true }).check();
  await page.getByLabel("演示条目数量", { exact: true }).fill("2");
  await page.getByRole("button", { name: "开始演示", exact: true }).click();
  const run = page.getByRole("article", { name: /^演示 / }).first();
  await expect(run.getByRole("heading", { level: 3 })).toHaveText("演示完成 · 本地演示");
  await expect(run.locator("img")).toHaveCount(2);
  await expect(run.locator("img").first()).toBeVisible();
  await run.getByText("输入快照与日志", { exact: true }).click();
  await expect(run.locator("pre")).toContainText("T14 包装批量测试");
  await expect(run.locator("pre")).toContainText('"count": 2');
  const image = (await run.locator("img").first().getAttribute("src"))!;
  expect((await page.request.get(image)).ok()).toBe(true);
  await page.getByRole("button", { name: "保存为团队工作流 · 批量替换产品包装", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("工作流详情");
  await expect(page.getByLabel("LibTV 流程引用", { exact: true })).toHaveValue("libtv://workflow/repack");
});

test("必填提示、停止终态与失败重试可操作 (ST-04、ERR-01)", async ({ page }) => {
  await page.goto("/workflows?tab=libtv");
  await page.getByRole("button", { name: "参数与演示 · 人物贴贴片", exact: true }).click();
  await page.getByRole("button", { name: "开始演示", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("本次演示要求");
  await page.getByLabel("本次演示要求", { exact: true }).fill("T14 停止测试");
  await page.getByLabel("使用本地测试素材", { exact: true }).check();
  await page.getByRole("button", { name: "开始演示", exact: true }).click();
  await page.getByRole("button", { name: "停止演示", exact: true }).click();
  const stopped = page.getByRole("article", { name: /^演示 / }).first();
  await expect(stopped.getByRole("heading", { level: 3 })).toHaveText("已停止 · 本地演示");
  await expect(stopped.locator("video")).toHaveCount(0);
  await page.getByLabel("模拟首条失败", { exact: true }).check();
  await page.getByRole("button", { name: "开始演示", exact: true }).click();
  const failed = page.getByRole("article", { name: /^演示 / }).first();
  await expect(failed.getByRole("heading", { level: 3 })).toHaveText("演示失败 · 本地演示");
  await failed.getByRole("button", { name: "重试演示", exact: true }).click();
  const retried = page.getByRole("article", { name: /^演示 / }).first();
  await expect(retried.getByRole("heading", { level: 3 })).toHaveText("演示完成 · 本地演示");
  await expect(page.getByRole("heading", { name: "已停止 · 本地演示", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "参数与演示 · 人物贴贴片", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已停止 · 本地演示", exact: true })).toBeVisible();
});
