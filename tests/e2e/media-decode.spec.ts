import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const [filename, duration] of [["测试视频A-4秒.mp4", 4], ["测试视频B-6秒.mp4", 6], ["测试视频C-5秒.mp4", 5]] as const) {
  test(`浏览器真实解码并播放 ${filename}`, async ({ page }) => {
    const response = await page.request.post("/api/assets/import", { multipart: { file: { name: filename, mimeType: "video/mp4", buffer: fs.readFileSync(path.resolve(import.meta.dirname, "../../fixtures/demo", filename)) } } });
    expect(response.ok()).toBe(true);
    const { asset } = await response.json();
    await page.goto(`/assets/${asset.id}`);
    const video = page.locator("video");
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((node) => node.readyState), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    expect(await video.evaluate((node) => node.error?.message ?? null)).toBeNull();
    expect(await video.evaluate((node) => node.videoWidth)).toBe(640);
    expect(await video.evaluate((node) => node.videoHeight)).toBe(360);
    expect(await video.evaluate((node) => node.duration)).toBe(duration);
    await video.evaluate(async (node) => { node.muted = true; await node.play(); });
    await expect.poll(() => video.evaluate((node) => node.currentTime)).toBeGreaterThan(0.1);
    await video.evaluate((node) => node.pause());
  });
}
