import path from "node:path";
import { expect, test } from "@playwright/test";

const image = path.resolve(import.meta.dirname, "../../fixtures/demo/测试产品图.png");

test("案例集引用资产且刷新后可恢复 (ASSET-03)", async ({ page }) => {
  await page.goto("/assets");
  await page.getByRole("button", { name: "导入文件" }).first().click();
  const dialog = page.getByRole("dialog", { name: "导入本地文件" });
  await dialog.getByLabel("文件").setInputFiles(image);
  await dialog.getByLabel("标签").fill("案例");
  await dialog.getByRole("button", { name: "导入", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "测试产品图.png", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "案例集" }).click();
  await page.getByRole("button", { name: "新建案例集", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "新建案例集" });
  await modal.getByLabel("案例集名称").fill("优秀参考案例");
  await modal.getByLabel("案例集用途").fill("作为创作参考");
  await modal.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("link", { name: "优秀参考案例" })).toBeVisible();
  await page.getByRole("link", { name: "优秀参考案例" }).click();
  await page.getByLabel("选择资产").selectOption({ label: "测试产品图.png" });
  await page.getByRole("button", { name: "加入案例集" }).click();
  await expect(page.getByRole("cell", { name: "测试产品图.png" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("cell", { name: "测试产品图.png" })).toBeVisible();
});

test("NAS 网页与 Windows 路径入口分别可用 (NAS-01)", async ({ page }) => {
  await page.goto("/assets");
  await page.getByRole("tab", { name: "NAS 入口" }).click();
  await page.getByLabel("NAS 名称").fill("测试 NAS");
  await page.getByLabel("地址类型").selectOption("web");
  await page.getByLabel("NAS 地址").fill("http://127.0.0.1:4173/");
  await page.getByRole("button", { name: "保存入口" }).click();
  await expect(page.getByText("NAS 入口已保存。")).toBeVisible();
  await expect(page.getByRole("link", { name: "打开网页" })).toHaveAttribute(
    "href",
    "http://127.0.0.1:4173/",
  );
  await expect(page.getByText("网页入口")).toBeVisible();

  await page.getByLabel("NAS 名称").fill("共享盘");
  await page.getByLabel("地址类型").selectOption("windows_path");
  await page.getByLabel("NAS 地址").fill("\\\\192.168.1.10\\团队\\素材");
  await page.getByRole("button", { name: "保存入口" }).click();
  await expect(page.getByText("Windows 路径", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "复制路径" })).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "NAS 入口" }).click();
  await expect(page.getByText("测试 NAS")).toBeVisible();
  await expect(page.getByText("共享盘")).toBeVisible();
});

test("外部网页地址必须使用 http 或 https", async ({ page }) => {
  await page.goto("/assets");
  await page.getByRole("tab", { name: "NAS 入口" }).click();
  await page.getByLabel("NAS 名称").fill("错误入口");
  await page.getByLabel("NAS 地址").fill("ftp://nas.local");
  await page.getByRole("button", { name: "保存入口" }).click();
  await expect(page.getByRole("alert")).toContainText("http:// 或 https://");
});
