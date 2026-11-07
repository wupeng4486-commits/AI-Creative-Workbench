import { expect, test } from "@playwright/test";

test("技能正文保存、来源筛选与复制 (SK-01)", async ({ page }) => {
  await page.goto("/skills");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("技能");
  await expect(page.getByRole("link", { name: "视频拆解四步法" })).toBeVisible();
  await expect(page.getByText("LibTV 引用").first()).toBeVisible();

  await page.getByRole("link", { name: "视频拆解四步法" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("技能详情");
  await page.getByLabel("步骤或指令正文").fill("1. 拆分镜\n2. 标注动作\n3. 写成可复用模板");
  await page.getByRole("button", { name: "保存正文" }).click();
  await expect(page.getByText("已保存到本机")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("步骤或指令正文")).toHaveValue(/可复用模板/);

  await page.goto("/skills");
  await page.getByRole("button", { name: "与我共享的" }).click();
  await expect(page.getByRole("link", { name: "AI 图片提示词规范" })).toBeVisible();
  await expect(page.getByRole("link", { name: "视频拆解四步法" })).toBeHidden();

  await page.getByRole("link", { name: "AI 图片提示词规范" }).click();
  await page.getByRole("button", { name: "复制为我的技能" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("技能详情");
  await expect(page.getByLabel("名称")).toHaveValue(/副本/);
  await page.getByLabel("步骤或指令正文").fill("副本的新正文");
  await page.getByRole("button", { name: "保存正文" }).click();
  await expect(page.getByText("已保存到本机")).toBeVisible();

  await page.goto("/skills/seed-skill-ai-image");
  await expect(page.getByLabel("步骤或指令正文")).not.toHaveValue("副本的新正文");
  await expect(page.getByLabel("步骤或指令正文")).toBeDisabled();
  await expect(page.getByRole("button", { name: "删除", exact: true })).toHaveCount(0);
});

test("缺少必填项时就地提示", async ({ page }) => {
  await page.goto("/skills");
  await page.getByRole("button", { name: "新建技能" }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建技能" });
  await dialog.getByRole("button", { name: "创建并编辑" }).click();
  await expect(page.getByRole("alert")).toContainText("技能名称不能为空");
  await expect(dialog.getByRole("alert")).toHaveCount(1);
});

test("创建 LibTV 引用并保存全部正文，连续关联保留已有智能体", async ({ page }) => {
  await page.goto("/skills");
  await page.getByRole("button", { name: "新建技能", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建技能" });
  await dialog.getByLabel("技能名称").fill("端到端交付引用");
  await dialog.getByLabel("适用场景").selectOption("交付检查");
  await dialog.getByLabel("技能类型").selectOption("libtv_reference");
  await dialog.getByRole("button", { name: "创建并编辑" }).click();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("端到端交付引用");
  await page.getByLabel("输入要求", { exact: true }).fill("待交付图片和源文件");
  await page.getByLabel("步骤或指令正文").fill("检查尺寸、授权和附件完整性");
  await page.getByLabel("输出格式").fill("交付检查清单");
  await page.getByLabel("示例", { exact: true }).fill("示例：图片与源文件各一份");
  await page.getByLabel("标签", { exact: true }).fill("交付, 检查");
  await page.getByLabel("外部引用（LibTV 引用信息）").fill("libtv://delivery/check");
  await page.getByRole("button", { name: "保存正文" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存到本机");

  await page.getByLabel("选择智能体").selectOption("seed-agent-director");
  await page.getByRole("button", { name: "关联", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "电商广告导演" })).toBeVisible();
  await page.getByLabel("选择智能体").selectOption("seed-agent-image-maker");
  await page.getByRole("button", { name: "关联", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "AI 图片创作助手" })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("输入要求", { exact: true })).toHaveValue("待交付图片和源文件");
  await expect(page.getByLabel("步骤或指令正文")).toHaveValue("检查尺寸、授权和附件完整性");
  await expect(page.getByLabel("输出格式")).toHaveValue("交付检查清单");
  await expect(page.getByLabel("示例", { exact: true })).toHaveValue("示例：图片与源文件各一份");
  await expect(page.getByLabel("标签", { exact: true })).toHaveValue("交付, 检查");
  await expect(page.getByLabel("外部引用（LibTV 引用信息）")).toHaveValue("libtv://delivery/check");
  await expect(page.getByText("LibTV 引用", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "电商广告导演" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "AI 图片创作助手" })).toBeVisible();

  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog", { name: "删除技能" }).getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("alert")).toContainText("引用");
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("端到端交付引用");
});

test("场景和搜索筛选可清除，删除自己的技能后列表更新", async ({ page }) => {
  await page.goto("/skills");
  await page.getByLabel("场景筛选").selectOption("美工");
  await expect(page.getByRole("link", { name: "美工交付规范" })).toBeVisible();
  await expect(page.getByRole("link", { name: "视频拆解四步法" })).toHaveCount(0);
  await page.getByLabel("搜索技能").fill("不存在的技能关键词");
  await expect(page.getByText("没有符合筛选的技能")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.getByLabel("搜索技能")).toHaveValue("");
  await expect(page.getByLabel("场景筛选")).toHaveValue("");
  await expect(page.getByRole("link", { name: "视频拆解四步法" })).toBeVisible();

  await page.getByRole("button", { name: "新建技能", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建技能" });
  await dialog.getByLabel("技能名称").fill("端到端待删除技能");
  await dialog.getByRole("button", { name: "创建并编辑" }).click();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("端到端待删除技能");
  const detailUrl = page.url();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog", { name: "删除技能" }).getByRole("button", { name: "确认删除" }).click();
  await expect(page).toHaveURL(/\/skills$/);
  await expect(page.getByRole("link", { name: "端到端待删除技能" })).toHaveCount(0);
  await page.goto(detailUrl);
  await expect(page.getByText("技能不存在", { exact: true }).first()).toBeVisible();
});
