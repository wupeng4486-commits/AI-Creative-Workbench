import { expect, test } from "@playwright/test";

test("资产详情读取真实文本与备注，损坏媒体显示反馈并保留下载 (ASSET-01、ERR-01)", async ({ page, request }) => {
  const text = await (await request.post("/api/assets/import", { multipart: { notes: "正文备注持久化", file: { name: "真实正文.txt", mimeType: "text/plain", buffer: Buffer.from("文本预览必须显示这段真实正文。") } } })).json();
  await page.goto(`/assets/${text.asset.id}`);
  await expect(page.getByText("文本预览必须显示这段真实正文。", { exact: true })).toBeVisible();
  await expect(page.getByText("正文备注持久化", { exact: true })).toBeVisible();
  const broken = await (await request.post("/api/assets/import", { multipart: { file: { name: "损坏视频.mp4", mimeType: "video/mp4", buffer: Buffer.from("invalid video content") } } })).json();
  await page.goto(`/assets/${broken.asset.id}`);
  await expect(page.getByRole("alert")).toContainText("媒体无法解码或读取");
  const bytes = await (await request.get(broken.asset.downloadUrl)).body();
  expect(bytes.toString()).toBe("invalid video content");
});
