import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/assets/import", { multipart: { file: { name: "T17 参考图.png", mimeType: "image/png", buffer: fs.readFileSync(path.resolve(import.meta.dirname, "../../fixtures/demo/测试产品图.png")) } } });
  expect(response.ok()).toBe(true);
});

test("AI 视频两次演示保留不同快照、分镜和可播放示例 (ST-01、ST-03)", async ({ page }) => {
  await page.goto("/studio/ai_video");
  const creation = page.waitForResponse((response) => response.url().endsWith("/api/drafts") && response.request().method() === "POST");
  await page.getByRole("button", { name: "新建草稿", exact: true }).click();
  const created = (await (await creation).json()).draft;
  await expect(page).toHaveURL(new RegExp(`/studio/ai_video/${created.id}$`));
  await expect(page.getByLabel("选择智能体", { exact: true })).toHaveValue("");
  await page.getByLabel("创作要求", { exact: true }).fill("T17 第一版视频需求");
  await page.getByLabel("分镜要求", { exact: true }).fill("开场商品特写");
  await page.getByLabel("选择商品", { exact: true }).selectOption("seed-product-sunscreen");
  await page.getByLabel("素材 T17 参考图.png", { exact: true }).first().check();
  await page.getByRole("button", { name: "开始制作演示", exact: true }).click();
  const preview = page.getByRole("article", { name: "制作预览", exact: true });
  await expect(preview.getByRole("heading", { name: "制作演示完成", exact: true })).toBeVisible();
  await expect(preview.locator("video")).toBeVisible();
  await expect(preview.getByText("分镜示例", { exact: true })).toBeVisible();
  const firstId = await preview.getByLabel("制作历史", { exact: true }).inputValue();
  await page.getByLabel("创作要求", { exact: true }).fill("T17 第二版视频需求");
  await page.getByLabel("分镜要求", { exact: true }).fill("户外使用场景开场");
  await page.getByRole("button", { name: "再次制作演示", exact: true }).click();
  await expect(preview.getByLabel("制作历史", { exact: true })).not.toHaveValue(firstId);
  await expect(preview.getByRole("heading", { name: "制作演示完成", exact: true })).toBeVisible();
  await preview.getByText("输入快照与制作日志", { exact: true }).click();
  await expect(preview.locator("pre")).toContainText("T17 第二版视频需求");
  await preview.getByLabel("制作历史", { exact: true }).selectOption(firstId);
  await expect(preview.locator("pre")).toContainText("T17 第一版视频需求");
  await expect(preview.locator("pre")).not.toContainText("T17 第二版视频需求");
});

test("AI 图片独立参数、候选预览与停止均可操作 (ST-01、ST-04)", async ({ page }) => {
  await page.goto("/studio/ai_image");
  await page.getByRole("button", { name: "新建草稿", exact: true }).click();
  await expect(page.getByLabel("目标宽度", { exact: true })).toBeVisible();
  await expect(page.getByLabel("分镜要求", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "开始制作演示", exact: true }).click();
  await expect(page.getByText("请选择商品知识。", { exact: true })).toBeVisible();
  await page.getByLabel("创作要求", { exact: true }).fill("T17 主图候选");
  await page.getByLabel("风格要求", { exact: true }).fill("明亮柔光");
  await page.getByLabel("候选数量", { exact: true }).fill("2");
  await page.getByLabel("选择商品", { exact: true }).selectOption("seed-product-sunscreen");
  await page.getByLabel("素材 T17 参考图.png", { exact: true }).first().check();
  await page.getByRole("button", { name: "开始制作演示", exact: true }).click();
  const preview = page.getByRole("article", { name: "制作预览", exact: true });
  await preview.getByRole("button", { name: "停止制作演示", exact: true }).click();
  await expect(preview.getByRole("heading", { name: "制作已停止", exact: true })).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(0);
  await preview.getByRole("button", { name: "再次制作演示", exact: true }).click();
  await expect(preview.getByRole("heading", { name: "制作演示完成", exact: true })).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(2);
  await expect(preview.locator("img").first()).toBeVisible();
  await page.reload();
  await expect(preview.locator("img")).toHaveCount(2);
  await expect(page.getByLabel("风格要求", { exact: true })).toHaveValue("明亮柔光");
});
