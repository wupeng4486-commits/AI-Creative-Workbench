import { expect, test } from "@playwright/test";

const MODULES = [
  ["首页总览", "/home"],
  ["智能体", "/agents"],
  ["创作工作室", "/studio"],
  ["资产库", "/assets"],
  ["连接器", "/connectors"],
  ["技能", "/skills"],
  ["工作流", "/workflows"],
  ["数据与设置", "/settings"],
] as const;

test("八个模块依次可访问且标题正确", async ({ page }) => {
  for (const [label, path] of MODULES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      label === "创作工作室" ? "AI 产品视频" : label,
    );
    const nav = page.getByRole("navigation", { name: "主导航" });
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
  const labels = await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link")
    .allInnerTexts();
  expect(labels.map((text) => text.trim())).toEqual(MODULES.map(([label]) => label));
});

test("当前导航项明确，详情页使用通用标题", async ({ page }) => {
  await page.goto("/agents/seed-agent-director");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("智能体详情");
  await expect(
    page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "智能体" }),
  ).toHaveClass(/active/);
  await page.goto("/studio/ai_image");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI 图片创作");
  await page.goto("/studio/design");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("美工设计");
  await page.goto("/studio/video_join");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("视频拼接");
});

test("键盘可打开并关闭全局搜索", async ({ page }) => {
  await page.goto("/home");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeHidden();
});
