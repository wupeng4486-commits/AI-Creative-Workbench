import { expect, test } from "@playwright/test";

test("新对话作为默认入口位于团队动态上方，主 Agent 明确显示待接入", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") writes.push(request.url()); });
  await page.goto("/");
  await expect(page).toHaveURL(/\/chat$/);
  const nav = page.getByRole("navigation", { name: "主导航" }).getByRole("link");
  await expect(nav).toHaveCount(9);
  await expect(nav.nth(0)).toHaveAccessibleName("新对话");
  await expect(nav.nth(1)).toHaveAccessibleName("团队动态");
  await expect(page.getByText("待接入模型", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await page.getByRole("textbox", { name: "给主 Agent 的消息" }).fill("准备内部通用 Agent 的问题");
  await page.getByRole("textbox").press("Enter");
  expect(writes).toEqual([]);
  await page.goto("/home?type=skill");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("团队动态");
  await expect(page.getByRole("region", { name: "团队共享内容" }).getByRole("button", { name: "技能", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "团队动态" })).toHaveClass(/active/);
});

test("场景提示保留已有输入，对话草稿在切换模块和刷新后恢复", async ({ page }) => {
  await page.goto("/chat");
  const input = page.getByRole("textbox", { name: "给主 Agent 的消息" });
  await input.fill("先保留这段团队背景");
  await page.getByRole("button", { name: /整理思路与资料/ }).click();
  await expect(input).toHaveValue(/先保留这段团队背景\n\n请帮我整理以下资料/);
  await expect(input).toBeFocused();
  const draft = await input.inputValue();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "团队动态" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("团队动态");
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "新对话" }).click();
  await expect(input).toHaveValue(draft);
  await page.reload();
  await expect(input).toHaveValue(draft);
  await page.getByRole("button", { name: "打开全局搜索", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeHidden();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
});

test("窄屏新对话和团队动态可操作，导航保留可访问名称", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /一起策划方案/ }).click();
  await expect(page.getByRole("textbox")).toHaveValue(/制定一份方案/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "团队动态" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("团队动态");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
