import { expect, test } from "@playwright/test";

test("本机入口可打开并显示应用标题", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("企业 AI 内容生产平台");
  await expect(page.getByText("本机演示工作台")).toBeVisible();
});

test("健康检查通过", async ({ request }) => {
  const response = await request.get("/api/system/health");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ ok: true });
});
