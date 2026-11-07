# 交付测试报告

版本 0.1.0，验证日期 2026-11-07，Windows 本机环境。

## 结果

| 验证层 | 命令或入口 | 结果 |
| --- | --- | --- |
| TypeScript 类型检查 | `npm run typecheck` | 通过 |
| 服务端集成测试 | `npm run test:server` | 168 项通过 |
| React 界面测试 | `npm run test:ui` | 31 项通过 |
| Chromium 端到端测试 | `npx playwright test` | 51 项通过 |
| 文档、媒体与验收证据检查 | Python unittest，`tests/test_*.py` | 12 项通过 |
| 生产构建 | `npm run build` | 通过 |
| Git 差异检查 | `git diff --check` | 通过 |
| 真实 Windows 重启 | `node scripts/reboot-acceptance.mjs verify` | 通过 |
| 真实 NAS 网页入口 | `node scripts/verify-nas.mjs http://192.168.110.72:5000` | HTTP 200，Synology NAS 网页 |

自动化测试共 262 项，零跳过。PRD 的 39 项编号、逐项操作与证据见 `ACCEPTANCE.md`。

最新追加变更的完整日志保存于 `.tmp/workspace-check.log`、`.tmp/workspace-browser-tests.log` 和 `.tmp/workspace-document-tests.log`。T24 基线日志保存在 `.tmp/final-*.log`。自动化服务、文件与恢复使用隔离数据目录。

## 新对话与团队动态追加变更

2026-11-07 按用户新增要求，将原“首页总览”重命名为“团队动态”，在其上方增加“新对话”，默认入口为 `/chat`。导航、搜索、卡片、按钮、筛选、输入框及共享内容采用统一的浅色工作空间样式。

`tests/ui/chat.test.tsx` 的 7 项验证模型待接入与禁用发送、提示追加与输入焦点、草稿恢复、损坏存储兼容、存储失败与恢复、回车编辑及实际目录链接。`tests/e2e/chat.spec.ts` 的 3 项通过正常入口验证导航顺序、原 `/home` 筛选链接、草稿切换与刷新、全局搜索及 390 像素窄屏布局。

首次窄屏验收发现样式导入顺序导致布局规则被覆盖，修正后继续核对页面实际宽度。全量回归检出全局搜索按钮与目录搜索输入框的标签重叠，修复为独立的全局搜索名称。原导航与品牌测试按新增九模块及新默认入口更新，其余业务断言继续执行。

参考聊天地址在当前访问环境跳转登录页，浏览器安全策略拒绝访问参考站点。本次依据已读取的公开产品说明与现有团队功能设计，没有完成登录后界面的视觉对照。主 Agent 当前提供页面和浏览器输入草稿。

## Windows 日常入口验收

`tests/e2e/launcher-acceptance.spec.ts` 直接运行 Windows PowerShell 与 CMD 入口。

- 从其他工作目录启动，验证项目与数据位置、隐藏后台进程、监听端口和实例登记。
- 连续启动复用同一 PID，错误数据目录的启动及停止请求均给出端口占用反馈。
- 创建草稿并等待保存，停止并重开后核对相同数据集、名称和创作要求。
- 让另一个 Node 服务占用端口并返回相同应用名，启停脚本仍通过真实进程入口识别并保留它。
- 使用 `启动平台.cmd --no-browser` 运行实际日常入口，屏蔽外部网络请求，读取本地页面和真实可播放视频，下载完整备份并恢复，再停止重开核对原文件字节。

测试中的 `--no-browser` 只抑制系统默认浏览器打开，供自动化调用。用户双击启动文件会正常打开浏览器。

## 故障与一致性验证

| 场景 | 证据 |
| --- | --- |
| 上传磁盘写满、上传流中断、清理后重试 | `tests/integration/acceptance-regressions.test.ts` |
| 保存失败保留输入、串行保存与修订冲突 | `tests/ui/draft-save.test.tsx`、`tests/e2e/studio-drafts.spec.ts`、`tests/integration/drafts.test.ts` |
| 共享文件删除保护、删除失败回滚与历史文件保留 | `tests/integration/references.test.ts`、`tests/integration/acceptance-regressions.test.ts` |
| 演示停止、延迟回调、重启中断、部分批次失败与重试 | `tests/integration/demo-runs.test.ts`、`tests/e2e/libtv.spec.ts` |
| 归档并发及重复请求、来源冻结、删除后不复活 | `tests/integration/results.test.ts`、`tests/e2e/results.spec.ts` |
| 损坏备份、哈希错误、版本错误、遗漏文件清单 | `tests/integration/restore.test.ts`、`tests/integration/acceptance-regressions.test.ts` |
| 激活日志中断、新数据集初始化失败、指针回滚 | `tests/integration/restore.test.ts`、`tests/integration/acceptance-regressions.test.ts` |
| 流式上传期间切换数据集、旧页面写请求拒绝 | `tests/integration/acceptance-regressions.test.ts`、`tests/integration/data-settings.test.ts` |
| 文本正文、空文本、损坏媒体反馈与原文件下载 | `tests/ui/acceptance.test.tsx`、`tests/e2e/media-errors.spec.ts` |
| 后台刷新期间保留未保存流程资料及新附件 | `tests/e2e/workflows.spec.ts` |

## 重启及外部网页证据

用户实际重启 Windows 后，启动时间由 2026-11-07 14:00:40 变为 20:21:25（北京时间）。校验脚本确认同一数据集、完整草稿、C/A 九秒顺序、制作历史、来源快照及输入和成果 SHA 保留。摘要见 `tests/evidence/reboot-2026-11-07.json`。

用户提供的 NAS 网页地址已通过平台“资产库 / NAS 入口 / 打开网页”实际访问，返回 HTTP 200，网页标题包含 Synology NAS。摘要见 `tests/evidence/nas-2026-11-07.json`，本机截图见 `.tmp/nas-acceptance/nas-page.png`。

## 已修复问题

验收中发现并修复了视频样例缺少可解码画面、工作流附件上传后后台刷新覆盖输入、弹窗输入焦点重置、文本预览未读取正文、共用原文件误删、上传失败残留、遗漏备份清单未拒绝及恢复初始化失败后的连接回滚问题。对应回归用例随功能提交保留。

AI、LibTV、连接器同步及视频合成以本地演示数据验证。真实交付文件支持导入、预览、下载、版本记录、归档与完整恢复。交付操作见 `使用说明.md`。
