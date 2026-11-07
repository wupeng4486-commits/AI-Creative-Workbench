# PRD 验收台账

本文件登记 PRD 第 10 节的 39 项验收编号。每项包含实际结果、证据与日期。
2026-11-07 已执行全部自动化验收。电脑重启与真实 NAS 可达性保留人工验收状态。

| 编号 | 实现任务 | 验证任务 | 当前状态 | 证据 |
| --- | --- | --- | --- | --- |
| NAV-01 | T08 | T23、T24 | 通过 | 2026-11-07，`tests/e2e/navigation.spec.ts`，八模块顺序、标题和导航状态 |
| NAV-02 | T08、T16 | T23 | 通过 | 2026-11-07，`tests/e2e/navigation.spec.ts`，四创作类型与通用详情标题 |
| NAV-03 | T21 | T23 | 通过 | 2026-11-07，`tests/e2e/discovery.spec.ts`，按原 ID 打开、返回搜索词与来源筛选 |
| HOME-01 | T21 | T23 | 通过 | 2026-11-07，`tests/e2e/discovery.spec.ts`、`tests/integration/discovery.test.ts`，智能体技能增删与去重目录数量 |
| HOME-02 | T21 | T23 | 通过 | 2026-11-07，`tests/integration/discovery.test.ts`，共享原文件口径、商品排除和团队流程数量 |
| HOME-03 | T21 | T23 | 通过 | 2026-11-07，`tests/e2e/discovery.spec.ts`、`tests/e2e/navigation.spec.ts`，快捷表单、工作室和四类共享详情 |
| HOME-04 | T21、T20 | T23 | 通过 | 2026-11-07，`tests/e2e/results.spec.ts`、`tests/e2e/discovery.spec.ts`，归档动态、最近草稿与资产、示例标识 |
| AG-01 | T12 | T23 | 通过 | 2026-11-07，`tests/e2e/agents.spec.ts`、`tests/integration/agents.test.ts`，编辑关联、复制独立与刷新恢复 |
| AG-02 | T12 | T23 | 通过 | 2026-11-07，`tests/e2e/agents.spec.ts`，来源筛选、共享保护和副本编辑 |
| AG-03 | T12、T16 | T23 | 通过 | 2026-11-07，`tests/e2e/agents.spec.ts`、`tests/e2e/studio-drafts.spec.ts`，示例对话与关联带入后无自动运行 |
| SK-01 | T11 | T23 | 通过 | 2026-11-07，`tests/e2e/skills.spec.ts`、`tests/e2e/agents.spec.ts`，完整正文、类型与连续关联 |
| REF-01 | T05 | T23 | 通过 | 2026-11-07，`tests/integration/references.test.ts`、`tests/integration/design-deliveries.test.ts`、`tests/integration/results.test.ts`，具体引用阻止、解除后删除与历史文件保留 |
| ST-01 | T16、T17、T18、T19 | T23 | 通过 | 2026-11-07，`tests/e2e/studio-production.spec.ts`、`tests/e2e/design-deliveries.spec.ts`、`tests/e2e/video-join.spec.ts`，四类参数、保存和预览 |
| ST-02 | T16 | T23 | 通过 | 2026-11-07，`tests/e2e/studio-drafts.spec.ts`，带入时明确加入当前或新建 |
| ST-03 | T17 | T23 | 通过 | 2026-11-07，`tests/e2e/studio-production.spec.ts`、`tests/integration/studio-runs.test.ts`，两次冻结输入与历史原快照重试 |
| ST-04 | T14、T17 | T23 | 通过 | 2026-11-07，`tests/e2e/libtv.spec.ts`、`tests/e2e/studio-production.spec.ts`、`tests/integration/demo-runs.test.ts`，必填、停止和终态竞态 |
| ST-05 | T20 | T23 | 通过 | 2026-11-07，`tests/e2e/results.spec.ts`、`tests/integration/results.test.ts`，重复并发归档、来源、有效媒体和首页动态 |
| JOIN-01 | T19 | T23 | 通过 | 2026-11-07，`tests/e2e/video-join.spec.ts`，真实鼠标排序 C/A/B、移除 B 后 C/A 九秒 |
| JOIN-02 | T19 | T23、T24 | 通过 | 2026-11-07，`tests/e2e/video-join.spec.ts`、`tests/e2e/restart-acceptance.spec.ts`，重开与服务重启后顺序、要求、文件和演示方案 |
| LINK-01 | T10、T19 | T23、T24 | 通过 | 2026-11-07，`tests/e2e/video-join.spec.ts`，未配置提示、等待保存和可访问测试网页新标签 |
| ASSET-01 | T04、T09 | T23 | 通过 | 2026-11-07，`tests/e2e/assets.spec.ts`、`tests/e2e/media-errors.spec.ts`、`tests/integration/files.test.ts`，真实图视频文档、备注、标签、下载字节 |
| ASSET-02 | T04、T09 | T23 | 通过 | 2026-11-07，`tests/integration/assets-api.test.ts`、`tests/integration/acceptance-regressions.test.ts`、`tests/ui/shell.test.tsx`，不支持预览、下载和导入写入失败 |
| ASSET-03 | T09、T10、T16 | T23 | 通过 | 2026-11-07，`tests/e2e/collections-nas.spec.ts`、`tests/e2e/studio-drafts.spec.ts`、`tests/integration/assets-api.test.ts`，商品知识、集合与引用带入 |
| NAS-01 | T10 | T23、T24 | 待人工验收 | 2026-11-07，`tests/e2e/collections-nas.spec.ts` 已验证可访问测试网页新标签及完整 Windows 路径剪贴板。尚待用户真实 NAS 网页可达性，需在实际网络环境打开并核对 |
| CON-01 | T15 | T23 | 通过 | 2026-11-07，`tests/e2e/connectors.spec.ts`、`tests/integration/connectors.test.ts`，配置、连接同步演示、日志与停用 |
| CON-02 | T15 | T23 | 通过 | 2026-11-07，`tests/e2e/connectors.spec.ts`、`tests/integration/connectors.test.ts`，显式导入与重试幂等 |
| WF-01 | T13 | T23 | 通过 | 2026-11-07，`tests/e2e/workflows.spec.ts`，来源、步骤预览、共享独立复制及附件上传时保留未保存输入 |
| WF-02 | T14 | T23 | 通过 | 2026-11-07，`tests/e2e/libtv.spec.ts`、`tests/integration/demo-runs.test.ts`，四类本地示例、输入参数与演示快照 |
| WF-03 | T13、T20 | T23 | 通过 | 2026-11-07，`tests/e2e/results.spec.ts`、`tests/e2e/libtv.spec.ts`、`tests/integration/discovery.test.ts`，另存流程、LibTV 引用和首页数量 |
| WF-04 | T14 | T23 | 通过 | 2026-11-07，`tests/e2e/libtv.spec.ts`、`tests/integration/demo-runs.test.ts`，批量条目、有效预览、部分失败与独立重试 |
| CFG-01 | T10、T22 | T23 | 通过 | 2026-11-07，`tests/e2e/data-settings.spec.ts`、`tests/e2e/video-join.spec.ts`、`tests/integration/data-settings.test.ts`，共用入口与偏好重开持久化 |
| DATA-01 | T03、T04、T16 | T23、T24 | 待电脑重启 | 2026-11-07，`tests/e2e/restart-acceptance.spec.ts` 已通过实际浏览器退出、服务进程终止重启、原文件字节与恢复。`scripts/reboot-acceptance.mjs` 已准备独立数据。尚待 Windows 真正重启后 verify 核对启动时间、草稿、顺序、历史和 SHA |
| DATA-02 | T03 | T23 | 通过 | 2026-11-07，`tests/integration/seed.test.ts`、`tests/integration/data-settings.test.ts`，幂等初始化、已改示例和删除记录保护 |
| BACK-01 | T06 | T23 | 通过 | 2026-11-07，`tests/integration/backup.test.ts`、`tests/e2e/data-settings.spec.ts`，完整清单、数据库、原文件和实际下载 |
| BACK-02 | T07 | T23、T24 | 通过 | 2026-11-07，`tests/e2e/restart-acceptance.spec.ts`、`tests/integration/restore.test.ts`，隔离恢复、重启、C/A 九秒与来源快照 |
| BACK-03 | T07、T22 | T23 | 通过 | 2026-11-07，`tests/e2e/data-settings.spec.ts`、`tests/integration/restore.test.ts`，预览取消前后数据集和原数据核对 |
| BACK-04 | T07 | T23 | 通过 | 2026-11-07，`tests/integration/restore.test.ts`、`tests/integration/acceptance-regressions.test.ts`，损坏包、版本、哈希篡改和遗漏清单拒绝 |
| ERR-01 | T04、T07、T14、T16 | T23 | 通过 | 2026-11-07，`tests/integration/acceptance-regressions.test.ts`、`tests/e2e/studio-drafts.spec.ts`、`tests/integration/drafts.test.ts`、`tests/integration/restore.test.ts`，磁盘写满、流中断、保存重试、修订冲突、删除回滚和恢复初始化失败回滚 |
| EMPTY-01 | T08、T21 | T23 | 通过 | 2026-11-07，`tests/e2e/data-settings.spec.ts`、`tests/e2e/discovery.spec.ts`、`tests/e2e/assets.spec.ts`，空数据集、无结果、清除筛选和示例补充 |

## 任务执行记录

| 任务 | 状态 | 提交 | 验证命令 | 结果 |
| --- | --- | --- | --- | --- |
| T01 | 已完成 | 66b436b | fixture 生成、文档检查 | 10 项 Python 测试通过 |
| T02 | 已完成 | T02 提交 | build、typecheck、test、test:e2e、启动/停止脚本 | 9 项集成测试、2 项 e2e 通过 |
| T11 | 已完成 | 本次 T11 提交 | npm run check、npx playwright test、Python unittest、git diff --check | 84 项服务端、15 项界面、14 项 e2e、10 项 Python 测试通过 |
| T12 | 已完成 | 本次 T12 提交 | npm run check、agents/skills/navigation e2e | 91 项服务端、15 项界面、10 项相关 e2e 通过 |
| T13 | 已完成 | 本次 T13 提交 | npm run check、workflows e2e | 98 项服务端、15 项界面、2 项工作流 e2e 通过 |
| T14 | 已完成 | 本次 T14 提交 | npm run check、libtv/workflows e2e | 111 项服务端、15 项界面、4 项相关 e2e 通过 |
| T15 | 已完成 | 本次 T15 提交 | npm run check、connectors/libtv e2e | 118 项服务端、15 项界面、3 项相关 e2e 通过 |
| T16 | 已完成 | 本次 T16 提交 | npm run check、studio-drafts/navigation e2e | 127 项服务端、21 项界面、8 项相关 e2e 通过 |
| T17 | 已完成 | 本次 T17 提交 | npm run check、studio-production/studio-drafts e2e | 134 项服务端、21 项界面、7 项相关 e2e 通过 |
| T18 | 已完成 | 本次 T18 提交 | npm run check、design-deliveries/studio-production/studio-drafts e2e | 140 项服务端、21 项界面、9 项相关 e2e 通过 |
| T19 | 已完成 | 本次 T19 提交 | npm run check、全部 e2e、Python unittest | 147 项服务端、21 项界面、36 项 e2e、10 项 Python 测试通过 |
| T20 | 已完成 | 2e03719 | npm run check、results/studio-production/design-deliveries e2e | 156 项服务端、21 项界面、5 项相关 e2e 通过 |
| T21 | 已完成 | b1c776d | npm run check、discovery/navigation e2e | 159 项服务端、21 项界面、5 项相关 e2e 通过 |
| T22 | 已完成 | fc521e2 | npm run check、data-settings/collections-nas/discovery e2e | 163 项服务端、21 项界面、7 项相关 e2e 通过 |
| T23 | 验证中 | 本次 T23 自动化提交 | npm run check、全部 Playwright、Python unittest、重启校验 prepare | 168 项服务端、24 项界面、45 项 e2e、10 项 Python 测试通过。尚待电脑重启与真实 NAS 人工证据 |

### T11 验证记录

2026-11-07 完成技能目录、来源和场景筛选、全文搜索、空正文创建、正文编辑、独立复制、类型与外部引用保存、智能体及工作流引用服务和引用删除保护。

- `tests/integration/skills.test.ts` 的 15 项测试验证正文与类型重启恢复、来源与场景筛选、共享技能编辑和删除保护、复制独立性、关联事务回滚、重复请求、删除后重启及错误响应。
- `tests/ui/skills.test.tsx` 的 4 项测试验证中文表单标签、必填项单处报错、添加关联时保留已有引用与未保存正文，以及保存失败后保留输入并成功重试。
- `tests/e2e/skills.spec.ts` 的 4 项测试通过构建后的本机服务验证创建、编辑、刷新、来源筛选、复制、完整正文与 LibTV 引用、连续关联、删除保护和无结果恢复。
- 全量回归修正了两处历史测试。首页冒烟测试按 v3 检查首页标题、应用标识、演示标识和八项导航。案例集测试根据本次导入返回的资产 ID 选择和验证引用，并在刷新后核对同一 ID，以支持目录中存在同名文件的场景。

SK-01 的智能体详情选择与完整关联联调按计划在 T12 完成，PRD 验收状态在 T23 统一登记。

### T12 验证记录

2026-11-07 完成智能体目录、来源与用途筛选、最近更新排序、新建编辑复制删除、四个详情页签、商品与技能及素材关联和示例对话。去创作传递智能体 ID，并按领域选择工作室类型。

`tests/integration/agents.test.ts` 的 7 项测试验证必填与对话格式、资料和关联重启恢复、共享保护、副本独立、关联事务回滚、草稿引用保护及删除后重启。`tests/e2e/agents.spec.ts` 的 3 项浏览器测试验证 AG-01、AG-02、示例对话和创作参数，并从技能详情核对反向关联。AG-03 的草稿实际带入在 T16 联调。

### T13 验证记录

2026-11-07 完成团队流程目录、来源用途筛选、搜索、封面与步骤预览、新建编辑复制删除、LibTV 引用、默认参数、技能引用及真实附件。预览接口保持只读。

`tests/integration/workflows.test.ts` 的 7 项测试覆盖参数与附件重启恢复、下载内容、共享保护和副本独立性、失败回滚、预览不运行、草稿引用保护与删除重启。`tests/e2e/workflows.spec.ts` 的 2 项测试验证浏览器实际创建、导入附件、保存重开、共享预览和复制。使用入口与运行在 T14 接通。

### T14 验证记录

2026-11-07 完成四项 LibTV 本地示例、保存为团队流程、结构化参数面板、输入快照、历史与日志、批量条目及本地有效图片视频预览。有限演示运行服务支持排队、运行、完成、失败、停止、重试与重启中断，全部结果均标记为演示。

`tests/integration/demo-runs.test.ts` 的 13 项测试验证参数限制、完整状态转换、结果文件字节、停止竞态、部分失败与独立重试、重启中断、快照冻结、备份写屏障与并发上限。`tests/e2e/libtv.spec.ts` 的 2 项测试实际验证四项示例、批量预览、保存团队流程、必填提示、停止与重试，另回归 T13 的 2 项浏览器测试。

### T15 验证记录

2026-11-07 完成 Shopify、Gmail、GitHub 与创作工具目录、添加和编辑演示配置、启停、模拟连接同步、条目与日志、显式导入样例和 LibTV 共用入口。停用会停止当前模拟，同步本身只记录结果，导入操作按运行及条目幂等登记。

`tests/integration/connectors.test.ts` 的 7 项测试验证配置校验、模拟前置条件、失败与重试、部分成功导入、重复导入与重启恢复、跨连接器隔离、错误配置不影响当前运行及停用约束。浏览器测试实际完成配置、模拟连接同步、两次导入、计数核对、停用重开和资产示例标识，另回归 2 项 LibTV 浏览器测试。

### T16 验证记录

2026-11-07 完成四类草稿、修订保存、商品智能体技能素材流程选择、默认关联带入、加入当前或新建选择、自动保存、失败重试、修订冲突处理及离开前保存。草稿创建支持幂等键，写入携带数据集标识，旧数据集请求会被拒绝。

`tests/integration/drafts.test.ts` 的 9 项测试覆盖四类草稿、幂等创建、关联与默认参数、并发修订竞争、事务回滚、陈旧数据集请求、追加引用、重启恢复及已有草稿兼容。`tests/ui/draft-save.test.tsx` 的 6 项测试覆盖合并编辑、串行提交、旧响应不覆盖新输入、失败重试、显式冲突覆盖与 StrictMode 生命周期。`tests/e2e/studio-drafts.spec.ts` 的 5 项测试实际验证自动保存重开、资产与技能带入选择、AG-03 默认关联、失败重试和保存后离开，另回归 3 项导航测试。

### T17 验证记录

2026-11-07 完成 AI 视频目标时长、比例、分镜要求与分镜视频示例，以及 AI 图片目标尺寸、构图风格、数量与候选预览。制作前等待草稿保存，按已保存修订冻结需求、参数、商品、智能体、技能正文与素材信息，历史重试沿用原快照。

`tests/integration/studio-runs.test.ts` 的 7 项测试验证视频与图片产物、两次制作及来源正文隔离、目录资料删除后原快照重试、停止、必填与参数校验。浏览器测试验证两次视频历史切换、图片候选与停止，并回归 T16 的 5 项流程。发现并修复了新建草稿等待保存与创建响应期间仍可编辑旧稿的竞态，快速新建后输入及带入操作均已重跑通过。

### T18 验证记录

2026-11-07 完成美工设计类型、尺寸、文案与交付要求、真实预览稿和源文件导入、版本说明、交付登记及历史预览。手动交付文件与制作演示分别标识，每个版本保留原文件引用和当时的资料快照。

`tests/integration/design-deliveries.test.ts` 的 6 项测试覆盖文件字节、源文件角色、版本独立性、目录删除后历史保留、必填与缺失文件保护、幂等登记和服务重启下载。浏览器实际完成两次交付、预览、SVG 源文件下载、版本切换与刷新恢复。另回归工作室流程，新增延迟创建时立即输入的竞态用例。原测试在已有设计草稿时过早捕获地址，现核对创建响应中的草稿 ID 后继续验证原有断言。

### T19 验证记录

2026-11-07 完成本地与资产库添加视频、拖动手柄与上下移动、移除、单段预览、顺序条、合计时长和重开恢复。重复使用同一视频按独立位置保存。剪映入口使用共用配置，未配置时提示，打开前等待草稿保存。

`tests/integration/video-join.test.ts` 的 7 项测试验证 C/A/B 排序、移除 B 后 9 秒、重启恢复、重复片段、引用删除保护、无效时长回滚及冻结拼接方案。浏览器以真实鼠标手势验证拖动、上下移动、移除、实际视频解码与剪映保存后跳转。随后运行全部现有测试，214 项全部通过。

### 视频样例可播放性修复

2026-11-07 在 T19 补充真实解码验收时，原视频的 `readyState` 始终为 0，确认原样例只有容器与元数据。已通过 FFmpeg 7.1 重新编码为测试 Chromium 支持的 VP9/MP4，并连续两次生成核对哈希稳定。`tests/e2e/media-decode.spec.ts` 的 3 项测试实际验证画面尺寸、4/6/5 秒时长、无解码错误及播放时间推进。原有哈希、时长和尺寸检查继续执行。修复提交为 `56b1805`。

### T20 验证记录

2026-11-07 完成成果归档、私有来源快照、准确历史跳转、另存团队流程和外部真实成片导入。归档按运行及条目幂等，成片按草稿及文件 SHA 幂等，重复操作复用原文件。来源与参数保留制作时快照。

`tests/integration/results.test.ts` 的 9 项测试覆盖并发归档、历史冻结、删除后不复活、部分成功结果、流程复用、真实成片、失败事务回滚与旧数据库迁移。`tests/e2e/results.spec.ts` 的 2 项测试验证页面重复归档与导入、数量、来源跳转、流程参数及真实视频解码，另回归 3 项制作与设计交付测试。

### T21 验证记录

2026-11-07 完成四项实时统计、四类共享内容筛选、四个快捷入口、最近使用、本机动态和分组全局搜索。资产目录统一映射来源快照，统计与共享文件目录复用排除商品知识的原文件筛选。详情访问记录最近使用，写入后统一刷新目录、引用、首页和搜索。

`tests/integration/discovery.test.ts` 的 3 项测试验证去重数量、增删联动、商品排除、名称说明标签检索、共享类型、示例标识和移除失效链接。`tests/e2e/discovery.spec.ts` 的 2 项测试验证四类共享原记录跳转、快捷表单、动态、返回后的搜索词和目录筛选，以及新增资源后的看板更新。初次浏览器测试补足真实共享原文件前置数据并修正控件名称后，全部 5 项相关浏览器测试通过。

### T22 验证记录

2026-11-07 完成数据目录、计数、磁盘与最近备份展示，完整包下载、上传校验、恢复预览、取消、确认、失败及成功刷新。恢复可先备份当前数据，共用 NAS、LibTV、剪映与显示偏好已接通。清空使用精确文字二次确认并原子启用空数据集，旧完整数据集保留。补充示例保留用户编辑和已改关联。

`tests/integration/data-settings.test.ts` 的 4 项测试覆盖确认与陈旧数据集、重启空集、幂等补充、指针故障回滚和偏好持久化。2 项浏览器测试完成真实备份下载、取消、坏包、恢复替换及缓存刷新、偏好在资产目录生效、清空取消与确认和示例补充。写屏障跟踪已接受请求，备份、恢复及清空等待其完成。发现并修复旧响应缺少显示偏好时资产页报错，所有回归断言继续通过。

### T23 自动化验证记录

2026-11-07 完成全部现有自动化测试，合计 247 项，零跳过。类型检查、生产构建及 Git 差异检查通过。39 项矩阵逐项关联有效测试，37 项通过，2 项保留人工验收状态。

最后一轮完整运行输出保存在 `.tmp/t23-tests.log`、`.tmp/t23-browser-tests.log` 和 `.tmp/t23-document-tests.log`。

- `tests/integration/acceptance-regressions.test.ts` 的 5 项验证恢复初始化失败后的原连接与指针回滚、共享原文件保留、删除失败事务回滚、磁盘写满反馈与重试、流中断清理、遗漏备份清单拒绝及流式导入期间切换等待。
- `tests/ui/acceptance.test.tsx` 的 3 项验证弹窗连续输入焦点、真实文本读取与空文件、读取失败和损坏媒体的反馈及下载。
- `tests/e2e/restart-acceptance.spec.ts` 实际启动独立服务和浏览器，退出浏览器、终止服务进程后重新启动，核对草稿要求、C/A 九秒顺序、制作历史、来源及原文件字节，再执行隔离恢复。
- `tests/e2e/collections-nas.spec.ts` 实际打开可访问的测试网页新标签，并从系统剪贴板读回完整 Windows 路径。真实 NAS 可达性仍需用户实际网络环境证据。
- 全量回归发现工作流上传附件引发后台刷新、覆盖未保存输入的问题，已修复并增加上传后原参数、步骤和输入说明保持不变的断言。恢复初始化故障测试先复现原连接关闭及新连接泄漏，再完成回滚与关闭修复。完整套件重跑全部通过。
- `tests/test_fixtures.py` 将初始化阶段“全部待验收”检查升级为交付阶段的台账检查，继续严格验证 39 个唯一编号、状态、日期、真实证据文件和待验收剩余操作。

### 真实电脑重启验收接续

用户已选择自动化验收后重启。准备脚本在 `.tmp/reboot-acceptance/` 保存独立数据库、视频原文件、完整包与 `evidence.json`。该目录保留于 Playwright 清理目录之外。日常 `data/` 与本次重启校验资料独立。

保存其他工作并实际重启 Windows 后，在项目根目录执行以下命令。

```powershell
node scripts/reboot-acceptance.mjs verify
```

脚本先核对 Windows 实际启动时间已经变化，再核对同一数据集、完整草稿、C/A 顺序、九秒时长、历史、来源快照和输入及成果原文件 SHA。全部通过后更新 `.tmp/reboot-acceptance/evidence.json` 的状态与重启后时间。未经历实际电脑重启时校验命令返回失败。完成这项与真实 NAS 可达性证据后关闭 T23，按顺序继续 T24 的 Windows 启停交付和最终全量验证。
