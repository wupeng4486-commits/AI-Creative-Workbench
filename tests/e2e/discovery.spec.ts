import { expect, test } from "@playwright/test";

test("首页统计、四类共享内容、快捷表单和最近使用 (HOME-01 至 HOME-04)", async ({ page, request }) => {
  const upload = await request.post("/api/assets/import", { multipart: { origin: "shared", file: { name: "首页共享文本.txt", mimeType: "text/plain", buffer: Buffer.from("共享内容原文件") } } });
  expect(upload.ok()).toBe(true);
  await page.goto("/home");
  const home = await (await request.get("/api/home")).json();
  const board = page.getByRole("region", { name: "数量看板" });
  for (const [label, key] of [["团队智能体", "agents"], ["团队技能", "skills"], ["共享文件", "sharedFiles"], ["团队工作流", "workflows"]]) {
    await expect(board.getByRole("link", { name: new RegExp(label!) }).locator("strong")).toHaveText(String(home.counts[key!]));
  }
  const shared = page.getByRole("region", { name: "团队共享内容" });
  for (const [type, label, title] of [["agent", "智能体", "智能体详情"], ["skill", "技能", "技能详情"], ["asset", "文件", "资产详情"], ["workflow", "工作流", "工作流详情"]]) {
    await shared.getByRole("button", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`type=${type}`));
    const data = await (await request.get(`/api/home?type=${type}`)).json();
    await shared.getByRole("link", { name: data.shared[0].name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title!);
    await page.goBack();
    await expect(shared.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  for (const [label, title] of [["新建智能体", "新建智能体"], ["新建技能", "新建技能"], ["导入文件", "导入本地文件"]]) {
    await page.getByRole("region", { name: "快捷操作" }).getByRole("link", { name: label }).click();
    await expect(page.getByRole("dialog", { name: title })).toBeVisible();
    await page.goBack();
  }
  await expect(page.getByRole("region", { name: "最近使用" }).getByRole("link").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "本机动态" }).getByText("示例 / 演示").first()).toBeVisible();
});

test("全局搜索按类型分组，返回保留关键词、目录筛选并显示最新编辑 (NAV-03)", async ({ page, request }) => {
  const skill = await (await request.post("/api/skills", { data: { name: "检索专用技能", scenario: "AI 图片", tags: ["搜索唯一码"] } })).json();
  await page.goto("/skills?origin=owned&scenario=AI+图片");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "全局搜索" });
  await dialog.getByLabel("全局搜索", { exact: true }).fill("搜索唯一码");
  await dialog.getByRole("button", { name: "检索专用技能", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/skills/${skill.skill.id}`));
  await page.getByRole("button", { name: "返回搜索与原位置" }).click();
  await expect(page).toHaveURL(/origin=owned&scenario=/);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("全局搜索", { exact: true })).toHaveValue("搜索唯一码");
  await dialog.getByLabel("全局搜索", { exact: true }).fill("没有对应内容xyz");
  await expect(dialog.getByText("没有匹配结果，请调整关键词。")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/home");
  const before = await (await request.get("/api/home")).json();
  await page.getByRole("region", { name: "快捷操作" }).getByRole("link", { name: "新建智能体" }).click();
  const form = page.getByRole("dialog", { name: "新建智能体" });
  await form.getByLabel("智能体名称").fill("首页联动智能体");
  await form.getByLabel("智能体用途").fill("首页联动验证");
  await form.getByRole("button", { name: "创建并编辑", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("智能体详情");
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "首页总览" }).click();
  await expect(page.getByRole("region", { name: "数量看板" }).getByRole("link", { name: /团队智能体/ }).locator("strong")).toHaveText(String(before.counts.agents + 1));
  await expect(page.getByRole("region", { name: "本机动态" }).getByRole("link", { name: /新建智能体：首页联动智能体/ })).toBeVisible();
});
