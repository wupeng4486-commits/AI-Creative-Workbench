# 环境记录（T01）

记录时间：2026-11-07

| 项目 | 实测值 | 说明 |
| --- | --- | --- |
| 操作系统 | Windows（本机开发机） | 桌面浏览器本地运行 |
| Node.js | v22.17.0 | 计划建议 24 LTS；本机为 22，`engines` 按实际值登记，依赖均在 22 上验证 |
| npm | 10.9.2 | 使用一份锁文件，npm workspaces |
| Git | 2.56.0.windows.4 | 每次任务一个提交 |
| Python（文档与 fixture 脚本） | 3.12.14 | 使用本机内置 UTF-8 模式 |
| SQLite（Python 自带，参考） | 3.53.1 | 服务端使用 better-sqlite3 自带 SQLite |
| 磁盘与写入 | 工作区可写（fixture 生成成功） | 数据目录默认 `data\`，可用 `APP_DATA_DIR` 覆盖 |
| FFmpeg | 7.1 | T19 使用 imageio-ffmpeg 0.6.0 的临时编码工具重新生成真实 H.264 视频；通过 FFMPEG_EXE 指定路径 |

## 依赖兼容性

better-sqlite3 在 Windows + Node 22 上安装、打开文件数据库、执行 `backup()` 的结果记录于
`tests/test_fixtures.py` 与 T03 之后的集成测试。若安装失败，T02 会先处理再继续。

## 媒体样例

fixture 清单见 `fixtures/demo-manifest.json`，由 `scripts/generate_fixtures.py` 生成，
内容稳定可重复：

- 商品知识：一条“示例：轻盈防晒乳”，随 seed 初始化写入。
- 图片：`测试产品图.png`（320×200）。
- PDF：`测试说明文档.pdf`。
- 任意附件：`测试附件.txt`（中文文件名，用于下载与哈希验证）。
- 视频：`测试视频A-4秒.mp4`、`测试视频B-6秒.mp4`、`测试视频C-5秒.mp4`，
  时长分别为 4、6、5 秒，640×360，标注为测试素材。

真实业务真人素材在本机使用时由用户自行导入，不入库。

## T19 媒体复查

原视频样例只包含容器和时长元数据，真实浏览器解码测试检出无法播放。现使用 FFmpeg 7.1 编码为 VP9/MP4、yuv420p、12 fps，尺寸与 4、6、5 秒时长符合验收要求。当前 Playwright Chromium 的媒体能力检查确认支持 VP9/MP4，H.264 返回不支持。仓库保存编码后的成品文件及更新后的 SHA-256 清单。普通启动直接读取这些成品文件，重新生成素材时需设置 `FFMPEG_EXE`。

`tests/e2e/media-decode.spec.ts` 验证三个视频能够读取画面、得到正确尺寸和时长、开始播放并推进播放时间。T19 按该验证结果重新执行媒体相关回归。
