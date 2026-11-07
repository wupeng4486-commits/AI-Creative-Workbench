import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildApp } from "../apps/server/dist/app.js";
import { createConfig } from "../apps/server/dist/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, ".tmp", "reboot-acceptance");
const evidenceFile = path.join(evidenceDir, "evidence.json");
const dataDir = path.join(evidenceDir, "data");
const mode = process.argv[2];
assert(["prepare", "verify"].includes(mode), "使用 node scripts/reboot-acceptance.mjs prepare 或 verify");
const boot = execFileSync("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')"], { encoding: "utf8", windowsHide: true }).trim();
assert(boot && !Number.isNaN(Date.parse(boot)), "无法读取 Windows 实际启动时间。");
if (mode === "prepare") assert(!fs.existsSync(evidenceFile), "已有重启校验资料，请先执行 verify，保留原始证据。");
const expected = mode === "verify" ? JSON.parse(fs.readFileSync(evidenceFile, "utf8")) : null;
if (expected) assert.notEqual(boot, expected.bootBefore, "当前仍是准备时的 Windows 启动会话。实际电脑重启尚未验证。");
fs.mkdirSync(evidenceDir, { recursive: true });
const app = await buildApp({ config: createConfig({ APP_DATA_DIR: dataDir }) });
async function json(method, url, body) {
  const response = await app.inject({ method, url, payload: body });
  assert(response.statusCode < 300, `${url} ${response.statusCode} ${response.body}`);
  return response.json();
}
async function importVideo(name) {
  const boundary = "rebootacceptance";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: video/mp4\r\n\r\n`),
    fs.readFileSync(path.join(root, "fixtures", "demo", name)),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({ method: "POST", url: "/api/assets/import", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().asset;
}
async function check(state) {
  assert.equal((await json("GET", "/api/system/info")).datasetId, state.backup.datasetId);
  const draft = (await json("GET", `/api/drafts/${state.draft.id}`)).draft;
  assert.deepEqual(draft, state.draft);
  const run = await json("GET", `/api/runs/${state.run.id}`);
  assert.deepEqual(run.inputSnapshot, state.run.inputSnapshot);
  assert.equal(run.status, "completed");
  const asset = (await json("GET", `/api/assets/${state.archive.id}`)).asset;
  assert.deepEqual(asset.sourceSnapshot, state.archive.sourceSnapshot);
  for (const item of [...state.assets, state.archive]) {
    const bytes = (await app.inject(item.downloadUrl)).rawPayload;
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), item.file.sha256);
  }
  assert.equal(draft.totalDuration, 9);
  assert.deepEqual(draft.clips.map((clip) => clip.assetId), state.assets.map((item) => item.id));
}
try {
  if (mode === "prepare") {
    const assets = [];
    for (const name of ["测试视频C-5秒.mp4", "测试视频A-4秒.mp4"]) assets.push(await importVideo(name));
    const draft = (await json("POST", "/api/drafts", { creationType: "video_join", name: "真实电脑重启验收", requirements: "C 后接 A，九秒顺序持久化", clipAssetIds: assets.map((item) => item.id) })).draft;
    const started = await json("POST", "/api/runs", { owner: "draft", ownerId: draft.id, requirements: "", draftRevision: draft.revision });
    let run;
    for (let attempt = 0; attempt < 30; attempt++) {
      run = await json("GET", `/api/runs/${started.id}`);
      if (run.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(run.status, "completed");
    const archive = (await json("POST", "/api/results/archive", { runId: run.id, resultItemId: run.items[0].id })).asset;
    const backup = await json("POST", "/api/backups");
    const state = { preparedAt: new Date().toISOString(), bootBefore: boot, dataDir, draft, assets, run, archive, backup, status: "awaiting_actual_reboot" };
    await check(state);
    fs.writeFileSync(evidenceFile, JSON.stringify(state, null, 2));
    console.log(`已准备真实重启验收。证据 ${evidenceFile}`);
    console.log("请保存其他工作并重启 Windows，重开后执行 node scripts/reboot-acceptance.mjs verify");
  } else {
    await check(expected);
    expected.bootAfter = boot;
    expected.verifiedAt = new Date().toISOString();
    expected.status = "passed_actual_reboot";
    fs.writeFileSync(evidenceFile, JSON.stringify(expected, null, 2));
    console.log(`真实电脑重启后草稿、C/A 顺序、九秒时长、历史、来源及原文件 SHA 全部通过。证据 ${evidenceFile}`);
  }
} finally { await app.close(); }
