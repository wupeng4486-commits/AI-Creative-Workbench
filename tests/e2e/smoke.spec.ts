import { expect, test } from "@playwright/test";

test("本机入口打开新对话并显示应用标识", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("今天，想一起完成什么？");
  await expect(page.locator(".brand-name")).toHaveText("AI Creative Workbench");
  await expect(page.getByText("本地演示", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link")).toHaveCount(9);
});

test("健康检查通过", async ({ request }) => {
  const response = await request.get("/api/system/health");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ ok: true });
});
