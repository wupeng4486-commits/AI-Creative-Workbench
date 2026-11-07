import path from "node:path";
import { expect, test } from "@playwright/test";

test("团队流程创建、参数和原生附件保存后可重开 (WF-01、WF-03)", async ({ page }) => {
  await page.goto("/workflows");
  await page.getByRole("button", { name: "新建团队工作流" }).click();
  const dialog = page.getByRole("dialog", { name: "新建团队工作流" });
  await dialog.getByLabel("工作流名称").fill("T13 交付流程");
  await dialog.getByLabel("工作流用途").fill("交付测试");
  await dialog.getByRole("button", { name: "创建并编辑" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("工作流详情");
  await page.getByLabel("LibTV 流程引用", { exact: true }).fill("libtv://workflow/tietie");
  await page.getByLabel("输入说明", { exact: true }).fill("产品资料与成片");
  await page.getByLabel("默认参数", { exact: true }).fill('{"duration":15,"ratio":"9:16"}');
  await page.getByLabel("流程步骤", { exact: true }).fill("检查输入\n输出交付清单");
  await page.getByLabel("交付检查清单", { exact: true }).check();
  await page.getByLabel("导入流程附件", { exact: true }).setInputFiles(path.resolve(import.meta.dirname, "../../fixtures/demo/测试附件.txt"));
  await expect(page.getByRole("link", { name: "测试附件.txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存工作流" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存到本机");
  await page.reload();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("T13 交付流程");
  await expect(page.getByLabel("默认参数", { exact: true })).toHaveValue(/"duration": 15/);
  await expect(page.getByLabel("流程步骤", { exact: true })).toHaveValue("检查输入\n输出交付清单");
  await expect(page.getByLabel("交付检查清单", { exact: true })).toBeChecked();
  const attachment = page.getByRole("link", { name: "测试附件.txt", exact: true });
  expect((await page.request.get((await attachment.getAttribute("href"))!)).ok()).toBe(true);
});

test("共享流程预览与独立复制，预览不运行 (WF-01)", async ({ page }) => {
  const before = (await (await page.request.get("/api/system/info")).json()).counts.runs;
  await page.goto("/workflows");
  await page.getByRole("button", { name: "与我共享的", exact: true }).click();
  await page.getByRole("link", { name: "人物产品展示", exact: true }).click();
  await expect(page.getByLabel("名称", { exact: true })).toBeDisabled();
  await expect(page.getByRole("region", { name: "流程预览" })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "流程预览" })).toContainText("选择人物片段");
  expect((await (await page.request.get("/api/system/info")).json()).counts.runs).toBe(before);
  await page.getByRole("button", { name: "复制为我的流程", exact: true }).click();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue(/副本/);
  await page.getByLabel("流程步骤", { exact: true }).fill("T13 副本步骤");
  await page.getByRole("button", { name: "保存工作流" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存到本机");
  await page.goto("/workflows/seed-workflow-product-show");
  await expect(page.getByLabel("流程步骤", { exact: true })).not.toHaveValue("T13 副本步骤");
});
