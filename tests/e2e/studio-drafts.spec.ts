import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function createFromUi(page: Page) {
  const response = page.waitForResponse((item) => item.url().endsWith("/api/drafts") && item.request().method() === "POST");
  await page.getByRole("button", { name: "新建草稿", exact: true }).click();
  const created = await response;
  expect(created.status()).toBe(201);
  const { draft } = await created.json();
  await expect(page).toHaveURL(new RegExp(`/studio/${draft.creationType}/${draft.id}$`));
}

test("草稿自动保存需求、选择和修订，刷新后恢复 (DATA-01)", async ({ page }) => {
  await page.goto("/studio/ai_video");
  await createFromUi(page);
  await expect(page).toHaveURL(/\/studio\/ai_video\/[^/?]+$/);
  await page.getByLabel("草稿名称", { exact: true }).fill("T16 自动保存草稿");
  await page.getByLabel("创作要求", { exact: true }).fill("先展示商品，再展示使用场景");
  await page.getByLabel("选择商品", { exact: true }).selectOption("seed-product-sunscreen");
  await page.getByLabel("技能 视频拆解四步法", { exact: true }).check();
  await expect(page.getByRole("status")).toHaveText("已保存到本机");
  const url = page.url();
  await page.reload();
  await expect(page.getByLabel("草稿名称", { exact: true })).toHaveValue("T16 自动保存草稿");
  await expect(page.getByLabel("创作要求", { exact: true })).toHaveValue("先展示商品，再展示使用场景");
  await expect(page.getByLabel("选择商品", { exact: true })).toHaveValue("seed-product-sunscreen");
  await expect(page.getByLabel("技能 视频拆解四步法", { exact: true })).toBeChecked();
  expect(page.url()).toBe(url);
});

test("资产和技能带入时选择加入当前或新建，引用原资产 (ST-02、ASSET-03)", async ({ page }) => {
  const imported = await page.request.post("/api/assets/import", { multipart: { file: {
    name: "T16 带入素材.png", mimeType: "image/png", buffer: fs.readFileSync(path.resolve(import.meta.dirname, "../../fixtures/demo/测试产品图.png")),
  } } });
  expect(imported.ok()).toBe(true);
  const asset = (await imported.json()).asset;
  const before = (await (await page.request.get("/api/system/info")).json()).counts.assets;
  await page.goto("/studio/ai_video");
  await createFromUi(page);
  await page.getByLabel("草稿名称", { exact: true }).fill("T16 当前草稿");
  await page.getByLabel("创作要求", { exact: true }).fill("当前已有创作输入");
  await expect(page.getByRole("status")).toHaveText("已保存到本机");
  const currentUrl = page.url();
  await page.goto(`/assets/${asset.id}`);
  await page.getByRole("link", { name: "用于创作", exact: true }).click();
  const join = page.getByRole("dialog", { name: "带入创作资料", exact: true });
  await expect(join).toContainText("T16 当前草稿");
  await join.getByRole("button", { name: "加入当前草稿", exact: true }).click();
  await expect(page).toHaveURL(currentUrl);
  await expect(page.getByLabel("创作要求", { exact: true })).toHaveValue("当前已有创作输入");
  await expect(page.getByLabel("素材 T16 带入素材.png", { exact: true })).toBeChecked();
  expect((await (await page.request.get("/api/system/info")).json()).counts.assets).toBe(before);
  await page.goto("/skills/seed-skill-ai-image");
  await page.getByRole("link", { name: "用于创作", exact: true }).click();
  await page.getByRole("dialog", { name: "带入创作资料", exact: true }).getByRole("button", { name: "新建草稿并带入", exact: true }).click();
  await expect(page).not.toHaveURL(currentUrl);
  await expect(page.getByLabel("技能 AI 图片提示词规范", { exact: true })).toBeChecked();
  await expect(page.getByLabel("创作要求", { exact: true })).toHaveValue("");
});

test("智能体去创作预选关联资料且不自动运行 (AG-03)", async ({ page }) => {
  const before = (await (await page.request.get("/api/system/info")).json()).counts.runs;
  await page.goto("/agents/seed-agent-director");
  await page.getByRole("link", { name: "去创作", exact: true }).click();
  await page.getByRole("dialog", { name: "带入创作资料", exact: true }).getByRole("button", { name: "新建草稿并带入", exact: true }).click();
  await expect(page.getByLabel("选择智能体", { exact: true })).toHaveValue("seed-agent-director");
  await expect(page.getByLabel("技能 视频拆解四步法", { exact: true })).toBeChecked();
  await expect(page.getByLabel("技能 交付检查清单", { exact: true })).toBeChecked();
  expect((await (await page.request.get("/api/system/info")).json()).counts.runs).toBe(before);
});

test("自动保存失败保留输入并允许重试", async ({ page }) => {
  await page.goto("/studio/ai_image");
  await createFromUi(page);
  let fail = true;
  await page.route("**/api/drafts/*", async (route) => {
    if (route.request().method() === "PATCH" && fail) {
      fail = false;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL_ERROR", message: "测试注入的保存失败" }) });
      return;
    }
    await route.continue();
  });
  await page.getByLabel("创作要求", { exact: true }).fill("失败后必须保留的输入");
  await expect(page.getByRole("alert")).toContainText("测试注入的保存失败");
  await expect(page.getByLabel("创作要求", { exact: true })).toHaveValue("失败后必须保留的输入");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存到本机");
  await page.reload();
  await expect(page.getByLabel("创作要求", { exact: true })).toHaveValue("失败后必须保留的输入");
});

test("离开页面前可选择保存并继续，保存完成后恢复输入", async ({ page }) => {
  await page.goto("/studio/design");
  await createFromUi(page);
  const draftUrl = page.url();
  await page.route("**/api/drafts/*", async (route) => {
    if (route.request().method() === "PATCH") await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });
  await page.getByLabel("创作要求", { exact: true }).fill("离开前保存的设计要求");
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "资产库", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "保存草稿后离开", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "保存并离开", exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await page.goto(draftUrl);
  await expect(page.getByLabel("创作要求", { exact: true })).toHaveValue("离开前保存的设计要求");
});

test("新建请求延迟时立即输入会等待新草稿编辑器，内容写入正确记录", async ({ page }) => {
  await page.goto("/studio/ai_video");
  await createFromUi(page);
  const previousUrl = page.url();
  await page.route("**/api/drafts", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });
  const response = page.waitForResponse((item) => item.url().endsWith("/api/drafts") && item.request().method() === "POST");
  await page.getByRole("button", { name: "新建草稿", exact: true }).click();
  await page.getByLabel("草稿名称", { exact: true }).fill("T16 延迟新建快速输入");
  await expect(page.getByRole("status")).toHaveText("已保存到本机");
  const { draft } = await (await response).json();
  await expect(page).toHaveURL(new RegExp(`/studio/ai_video/${draft.id}$`));
  expect(page.url()).not.toBe(previousUrl);
  expect((await (await page.request.get(`/api/drafts/${draft.id}`)).json()).draft.name).toBe("T16 延迟新建快速输入");
  await expect(page.getByRole("dialog", { name: "保存草稿后离开", exact: true })).toHaveCount(0);
});
