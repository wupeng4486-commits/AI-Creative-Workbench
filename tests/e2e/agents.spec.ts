import { expect, test } from "@playwright/test";

test("智能体创建、指令和知识技能保存后刷新恢复 (AG-01、SK-01)", async ({ page }) => {
  await page.goto("/agents");
  await page.getByRole("button", { name: "新建智能体", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建智能体" });
  await dialog.getByLabel("智能体名称").fill("T12 测试导演");
  await dialog.getByLabel("智能体用途").fill("生成产品广告分镜");
  await dialog.getByRole("button", { name: "创建并编辑" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("智能体详情");
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("T12 测试导演");
  await page.getByRole("tab", { name: "指令配置" }).click();
  await page.getByLabel("角色指令").fill("先确认受众再逐镜头输出");
  await page.getByLabel("输出要求").fill("输出镜头表");
  await page.getByLabel("注意事项").fill("核对商品功效");
  await page.getByRole("tab", { name: "知识与技能" }).click();
  await page.getByLabel("视频拆解四步法", { exact: true }).check();
  await page.getByLabel("示例：轻盈防晒乳", { exact: true }).check();
  await page.getByRole("button", { name: "保存智能体" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存到本机");
  await page.reload();
  await page.getByRole("tab", { name: "指令配置" }).click();
  await expect(page.getByLabel("角色指令")).toHaveValue("先确认受众再逐镜头输出");
  await page.getByRole("tab", { name: "知识与技能" }).click();
  await expect(page.getByLabel("视频拆解四步法", { exact: true })).toBeChecked();
  await expect(page.getByLabel("示例：轻盈防晒乳", { exact: true })).toBeChecked();
  const id = new URL(page.url()).pathname.split("/").at(-1);
  await expect(page.getByRole("link", { name: "去创作", exact: true })).toHaveAttribute("href", `/studio/ai_video?agentId=${id}`);
  await page.goto("/skills/seed-skill-video-breakdown");
  await expect(page.getByRole("link", { name: "T12 测试导演", exact: true })).toBeVisible();
});

test("共享智能体可筛选、查看示例对话并独立复制 (AG-02、AG-03)", async ({ page }) => {
  await page.goto("/agents");
  await page.getByRole("button", { name: "与我共享的", exact: true }).click();
  await expect(page.getByRole("link", { name: "电商广告导演", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "电商视觉创意顾问", exact: true }).click();
  await expect(page.getByLabel("名称", { exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "示例对话" }).click();
  await page.getByRole("button", { name: "蓝色产品适合什么背景？" }).click();
  await expect(page.getByRole("status")).toContainText("未调用真实模型");
  await expect(page.getByRole("link", { name: "去创作", exact: true })).toHaveAttribute("href", "/studio/ai_image?agentId=seed-agent-visual");
  await page.getByRole("button", { name: "复制为我的智能体" }).click();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue(/副本/);
  await page.getByLabel("名称", { exact: true }).fill("T12 我的视觉顾问");
  await page.getByRole("button", { name: "保存智能体" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存到本机");
  await page.goto("/agents/seed-agent-visual");
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("电商视觉创意顾问");
});

test("智能体必填项、无结果和清除筛选有明确反馈", async ({ page }) => {
  await page.goto("/agents");
  await page.getByLabel("搜索智能体").fill("不存在的智能体T12");
  await expect(page.getByText("没有符合条件的智能体")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.getByRole("link", { name: "电商广告导演", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建智能体", exact: true }).click();
  await page.getByRole("dialog", { name: "新建智能体" }).getByRole("button", { name: "创建并编辑" }).click();
  await expect(page.getByRole("alert")).toHaveText("请填写智能体名称与用途。");
});
