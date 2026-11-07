import path from "node:path";
import { expect, test } from "@playwright/test";

const image = path.resolve(import.meta.dirname, "../../fixtures/demo/测试产品图.png");
const video = path.resolve(import.meta.dirname, "../../fixtures/demo/测试视频A-4秒.mp4");
const doc = path.resolve(import.meta.dirname, "../../fixtures/demo/测试说明文档.pdf");

test("导入真实文件、预览、标签与刷新后保留 (ASSET-01/02)", async ({ page }) => {
  await page.goto("/assets");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("资产库");
  await page.getByRole("button", { name: "导入文件" }).first().click();
  const dialog = page.getByRole("dialog", { name: "导入本地文件" });
  await dialog.getByLabel("文件").setInputFiles(image);
  await dialog.getByLabel("标签").fill("测试,主图");
  await dialog.getByRole("button", { name: "导入", exact: true }).click();
  await expect(dialog).toBeHidden();

  const imageCard = page.getByRole("button", { name: "测试产品图.png", exact: true });
  await expect(imageCard).toBeVisible();
  await expect(page.getByText("320×200")).toBeVisible();

  await imageCard.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("资产详情");
  await expect(page.locator("img.media-image")).toBeVisible();
  await expect(page.getByText("image/png")).toBeVisible();

  await page.goto("/assets");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("资产库");
  await expect(page.getByRole("button", { name: "测试产品图.png", exact: true })).toBeVisible();
  await page.getByLabel("标签筛选").selectOption("测试");
  await expect(page.getByRole("button", { name: "测试产品图.png", exact: true })).toBeVisible();
});

test("视频与 PDF 可预览，筛选无结果提供清除入口 (EMPTY-01)", async ({ page }) => {
  await page.goto("/assets");
  const importOne = async (file: string, tag: string) => {
    await page.getByRole("button", { name: "导入文件" }).first().click();
    const dialog = page.getByRole("dialog", { name: "导入本地文件" });
    await dialog.getByLabel("文件").setInputFiles(file);
    await dialog.getByLabel("标签").fill(tag);
    await dialog.getByRole("button", { name: "导入", exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  await importOne(video, "拼接");
  await importOne(doc, "说明");

  const videoCard = page.getByRole("button", { name: "测试视频A-4秒.mp4", exact: true });
  await expect(videoCard).toBeVisible();
  await videoCard.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("资产详情");
  await expect(page.locator("video")).toBeVisible();
  await page.goto("/assets");

  const docCard = page.getByRole("button", { name: "测试说明文档.pdf", exact: true });
  await expect(docCard).toBeVisible();
  await docCard.click();
  await expect(page.locator("iframe")).toBeVisible();
  await page.goto("/assets");

  await page.getByLabel("搜索资产").fill("不存在的资料");
  await expect(page.getByText("没有符合筛选的资产")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.getByLabel("搜索资产")).toHaveValue("");
  await expect(page.getByRole("button", { name: "测试说明文档.pdf", exact: true })).toBeVisible();
});
