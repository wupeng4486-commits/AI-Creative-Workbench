import type Database from "better-sqlite3";
import { nowIso } from "../util/time.ts";

/**
 * Fixed identifiers keep restarts idempotent and let tests assert that sample
 * data is never duplicated. Deleted samples are remembered in seed_tombstones
 * so a restart does not recreate content the user removed.
 */
export const SEED_VERSION = 1;

export const SEED_AGENTS = [
  {
    id: "seed-agent-director",
    name: "电商广告导演",
    purpose: "把商品卖点组织成可拍摄、可生成广告片的分镜与节奏。",
    domain: "AI 视频",
    origin: "owned",
    author: "本机用户",
    instructions:
      "你是电商广告导演。先确认商品、受众和投放场景，再给出 15 秒与 30 秒两版分镜建议。",
    output: "输出镜头表：镜号、画面、动作、字幕、时长。",
    cautions: "不虚构商品功效；真人素材需确认授权。",
    dialog: [
      { question: "这支防晒乳广告怎么开场？", answer: "示例回复（未调用模型）：用 1 秒产品特写建立清爽感，再接人物户外场景。" },
    ],
  },
  {
    id: "seed-agent-visual",
    name: "电商视觉创意顾问",
    purpose: "为商品图与详情页提供构图、色彩和版式建议。",
    domain: "AI 图片",
    origin: "shared",
    author: "示例成员 · 视觉组",
    instructions: "你是视觉创意顾问，输出构图说明、配色方向与禁忌。",
    output: "三条构图方向，每条含主视觉、光线与文字区域。",
    cautions: "示例内容，不代表真实成员协作。",
    dialog: [
      { question: "蓝色产品适合什么背景？", answer: "示例回复（未调用模型）：暖灰或浅砂色背景能突出冷色产品。" },
    ],
  },
  {
    id: "seed-agent-video-planner",
    name: "AI 视频策划助手",
    purpose: "把需求整理为时长、比例与分镜要求。",
    domain: "AI 视频",
    origin: "shared",
    author: "示例成员 · 内容组",
    instructions: "先补齐商品、时长、比例、分镜要求四类信息。",
    output: "结构化需求与分镜清单。",
    cautions: "示例内容；不承诺真实生成。",
    dialog: [],
  },
  {
    id: "seed-agent-image-maker",
    name: "AI 图片创作助手",
    purpose: "整理尺寸、构图、风格与候选数量。",
    domain: "AI 图片",
    origin: "owned",
    author: "本机用户",
    instructions: "先确认用途，再给出 3 组提示词方向。",
    output: "提示词、负向提示与候选数量。",
    cautions: "不得使用未授权人物肖像。",
    dialog: [],
  },
  {
    id: "seed-agent-designer",
    name: "美工设计助手",
    purpose: "把设计类型、尺寸与文案落成可交付的版面要求。",
    domain: "美工",
    origin: "shared",
    author: "示例成员 · 设计组",
    instructions: "输出版面分区、字号层级与交付文件清单。",
    output: "版面示意说明与交付清单。",
    cautions: "示例内容；实际字体需确认授权。",
    dialog: [],
  },
  {
    id: "seed-agent-qc",
    name: "剪辑质检助手",
    purpose: "按交付检查清单核对视频顺序、时长与文件完整性。",
    domain: "交付检查",
    origin: "shared",
    author: "示例成员 · 质检组",
    instructions: "逐项检查顺序、时长、字幕与文件是否齐全。",
    output: "检查表与问题清单。",
    cautions: "示例内容；不替代人工验收。",
    dialog: [],
  },
] as const;

export const SEED_SKILLS = [
  {
    id: "seed-skill-video-breakdown",
    name: "视频拆解四步法",
    scenario: "AI 视频",
    origin: "owned",
    author: "本机用户",
    type: "platform",
    tags: ["分镜", "拆解"],
    input: "一条参考视频与目标商品",
    steps:
      "1. 记录镜头时长与切换点\n2. 标注主体与动作\n3. 提取字幕与卖点\n4. 改写为可复用分镜",
    output: "镜号、时长、动作与字幕表",
    examples: "示例：4 秒产品特写 + 6 秒使用场景 + 5 秒收尾。",
    externalRef: "",
  },
  {
    id: "seed-skill-ai-image",
    name: "AI 图片提示词规范",
    scenario: "AI 图片",
    origin: "shared",
    author: "示例成员 · 视觉组",
    type: "platform",
    tags: ["提示词", "构图"],
    input: "商品图、用途、尺寸",
    steps: "1. 描述主体\n2. 指定构图与光线\n3. 约束文字区域\n4. 补充负向提示",
    output: "结构化提示词",
    examples: "示例：浅砂背景、45 度俯拍、右上留白。",
    externalRef: "",
  },
  {
    id: "seed-skill-design-spec",
    name: "美工交付规范",
    scenario: "美工",
    origin: "owned",
    author: "本机用户",
    type: "platform",
    tags: ["交付", "版式"],
    input: "设计类型与尺寸",
    steps: "1. 确认尺寸\n2. 划分版面\n3. 建立字号层级\n4. 输出源文件与预览稿",
    output: "交付清单",
    examples: "示例：1200×1600 主图，标题 96px。",
    externalRef: "",
  },
  {
    id: "seed-skill-asset-organize",
    name: "素材整理规则",
    scenario: "素材整理",
    origin: "shared",
    author: "示例成员 · 内容组",
    type: "platform",
    tags: ["素材", "标签"],
    input: "待导入文件",
    steps: "1. 命名\n2. 打标签\n3. 记录来源\n4. 关联商品",
    output: "可检索的资产记录",
    examples: "示例：测试视频A-4秒 → 标签“贴贴片”。",
    externalRef: "",
  },
  {
    id: "seed-skill-delivery-check",
    name: "交付检查清单",
    scenario: "交付检查",
    origin: "owned",
    author: "本机用户",
    type: "platform",
    tags: ["质检"],
    input: "成片与需求",
    steps: "1. 核对顺序\n2. 核对时长\n3. 核对字幕\n4. 核对文件",
    output: "检查结论",
    examples: "示例：顺序 C、A，合计 9 秒。",
    externalRef: "",
  },
  {
    id: "seed-skill-libtv-video",
    name: "LibTV 视频去字幕",
    scenario: "AI 视频",
    origin: "shared",
    author: "LibTV 示例",
    type: "libtv_reference",
    tags: ["LibTV", "去字幕"],
    input: "原视频与处理区域",
    steps: "在 LibTV 中选择去字幕流程并传入视频。",
    output: "去字幕视频",
    examples: "仅保存引用信息，第一版不执行外部技能。",
    externalRef: "libtv://workflow/video-subtitle-removal",
  },
] as const;

export const SEED_PRODUCT = {
  id: "seed-product-sunscreen",
  name: "示例：轻盈防晒乳",
  sku: "DEMO-SPF50",
  description: "用于演示商品知识与创作联动的示例商品。",
  sellingPoints: ["清爽不粘腻", "适合日常通勤", "示例包装版本 v2"],
  packageVersion: "示例包装 v2",
  notes: "本商品为示例资料，不代表真实产品功效。",
};

export const SEED_WORKFLOWS = [
  {
    id: "seed-workflow-tietie",
    name: "人物贴贴片",
    purpose: "使用已有真人实拍素材整理人物手持与贴敷动作。",
    origin: "owned",
    author: "本机用户",
    libtvRef: "libtv://workflow/tietie",
    input: "真人手持素材、贴敷完成镜头",
    parameters: { duration: 15, ratio: "9:16" },
    steps: ["导入真人素材", "按动作排序", "检查时长", "输出示例"],
  },
  {
    id: "seed-workflow-product-show",
    name: "人物产品展示",
    purpose: "人物展示商品并给出卖点字幕。",
    origin: "shared",
    author: "示例成员 · 内容组",
    libtvRef: "libtv://workflow/product-show",
    input: "人物素材、商品图",
    parameters: { duration: 20, ratio: "9:16" },
    steps: ["选择人物片段", "叠加商品特写", "生成字幕示例"],
  },
  {
    id: "seed-workflow-repack",
    name: "批量替换产品包装",
    purpose: "批量替换包装并以条目查看结果。",
    origin: "shared",
    author: "示例成员 · 设计组",
    libtvRef: "libtv://workflow/repack",
    input: "包装图与批量商品清单",
    parameters: { batch: true, count: 3 },
    steps: ["上传包装图", "按条目处理", "逐项查看结果"],
  },
  {
    id: "seed-workflow-desubtitle",
    name: "视频批量去字幕",
    purpose: "批量移除视频中的硬字幕。",
    origin: "owned",
    author: "本机用户",
    libtvRef: "libtv://workflow/desubtitle",
    input: "多个视频",
    parameters: { batch: true },
    steps: ["选择视频", "标记区域", "逐条处理"],
  },
] as const;

export const SEED_CONNECTORS = [
  { id: "seed-connector-shopify", type: "shopify", name: "Shopify 演示连接" },
  { id: "seed-connector-gmail", type: "gmail", name: "Gmail 演示连接" },
  { id: "seed-connector-github", type: "github", name: "GitHub 演示连接" },
  { id: "seed-connector-libtv", type: "creation_tool", name: "LibTV 接口位置" },
] as const;

function tombstoned(db: Database.Database, id: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM seed_tombstones WHERE seed_id = ?").get(id),
  );
}

function insertIfMissing(
  db: Database.Database,
  sql: string,
  id: string,
  params: unknown[],
): void {
  if (tombstoned(db, id)) return;
  db.prepare(sql).run(...params);
}

export interface SeedResult {
  applied: boolean;
  version: number;
}

/**
 * Applies seed version 1 and any later additions that are still missing.
 * Existing rows are never updated, so user edits survive restarts.
 */
export function seedDatabase(db: Database.Database): SeedResult {
  const state = db.prepare("SELECT seed_version FROM seed_state WHERE seed_key = 'demo'").get() as
    | { seed_version: number }
    | undefined;
  const already = state?.seed_version ?? 0;

  const apply = db.transaction((): boolean => {
    const time = nowIso();

    if (already < 1) {
      for (const agent of SEED_AGENTS) {
        insertIfMissing(
          db,
          `INSERT OR IGNORE INTO agents
            (id, name, purpose, domain, origin, author, instructions, output_requirements, cautions, example_dialog, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          agent.id,
          [
            agent.id,
            agent.name,
            agent.purpose,
            agent.domain,
            agent.origin,
            agent.author,
            agent.instructions,
            agent.output,
            agent.cautions,
            JSON.stringify(agent.dialog),
            time,
            time,
          ],
        );
      }

      for (const skill of SEED_SKILLS) {
        insertIfMissing(
          db,
          `INSERT OR IGNORE INTO skills
            (id, name, scenario, origin, author, skill_type, tags, input_spec, steps, output_spec, examples, external_ref, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          skill.id,
          [
            skill.id,
            skill.name,
            skill.scenario,
            skill.origin,
            skill.author,
            skill.type,
            JSON.stringify(skill.tags),
            skill.input,
            skill.steps,
            skill.output,
            skill.examples,
            skill.externalRef,
            time,
            time,
          ],
        );
      }

      insertIfMissing(
        db,
        `INSERT OR IGNORE INTO products
          (id, name, sku, description, selling_points, package_version, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        SEED_PRODUCT.id,
        [
          SEED_PRODUCT.id,
          SEED_PRODUCT.name,
          SEED_PRODUCT.sku,
          SEED_PRODUCT.description,
          JSON.stringify(SEED_PRODUCT.sellingPoints),
          SEED_PRODUCT.packageVersion,
          SEED_PRODUCT.notes,
          time,
          time,
        ],
      );

      for (const workflow of SEED_WORKFLOWS) {
        insertIfMissing(
          db,
          `INSERT OR IGNORE INTO team_workflows
            (id, name, purpose, origin, author, libtv_ref, input_spec, default_parameters, steps, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          workflow.id,
          [
            workflow.id,
            workflow.name,
            workflow.purpose,
            workflow.origin,
            workflow.author,
            workflow.libtvRef,
            workflow.input,
            JSON.stringify(workflow.parameters),
            JSON.stringify(workflow.steps),
            time,
            time,
          ],
        );
      }

      for (const connector of SEED_CONNECTORS) {
        insertIfMissing(
          db,
          `INSERT OR IGNORE INTO connectors
            (id, service_type, name, demo_config, enabled, simulation_status, created_at, updated_at)
           VALUES (?, ?, ?, '{}', 1, 'unconfigured', ?, ?)`,
          connector.id,
          [connector.id, connector.type, connector.name, time, time],
        );
      }

      const relations: Array<[string, string]> = [
        ["seed-agent-director", "seed-skill-video-breakdown"],
        ["seed-agent-director", "seed-skill-delivery-check"],
        ["seed-agent-visual", "seed-skill-ai-image"],
        ["seed-agent-image-maker", "seed-skill-ai-image"],
        ["seed-agent-designer", "seed-skill-design-spec"],
        ["seed-agent-qc", "seed-skill-delivery-check"],
        ["seed-workflow-tietie", "seed-skill-video-breakdown"],
        ["seed-workflow-desubtitle", "seed-skill-libtv-video"],
      ];
      for (const [agentId, skillId] of relations) {
        if (agentId.startsWith("seed-agent-")) {
          db.prepare(
            "INSERT OR IGNORE INTO agent_skills (agent_id, skill_id) VALUES (?, ?)",
          ).run(agentId, skillId);
        } else {
          db.prepare(
            "INSERT OR IGNORE INTO workflow_skills (workflow_id, skill_id) VALUES (?, ?)",
          ).run(agentId, skillId);
        }
      }

      const activities = [
        {
          id: "seed-activity-1",
          action: "示例动态：团队共享了「人物产品展示」流程",
          type: "workflow",
          target: "seed-workflow-product-show",
          snapshot: { name: "人物产品展示", demo: true },
        },
        {
          id: "seed-activity-2",
          action: "示例动态：视觉组更新了「AI 图片提示词规范」",
          type: "skill",
          target: "seed-skill-ai-image",
          snapshot: { name: "AI 图片提示词规范", demo: true },
        },
      ];
      for (const activity of activities) {
        db.prepare(
          `INSERT OR IGNORE INTO activities
            (id, action, resource_type, resource_id, display_snapshot, demo, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
        ).run(
          activity.id,
          activity.action,
          activity.type,
          activity.target,
          JSON.stringify(activity.snapshot),
          time,
        );
      }
    }

    const defaults: Array<[string, unknown]> = [
      ["integrations.nas", []],
      ["integrations.libtv", { url: "", note: "" }],
      ["integrations.jianying", { url: "", note: "" }],
      ["ui.preferences", { sidebarCollapsed: false, assetView: "list" }],
    ];
    for (const [key, value] of defaults) {
      db.prepare(
        "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
      ).run(key, JSON.stringify(value), time);
    }

    if (already < SEED_VERSION) {
      db.prepare(
        `INSERT INTO seed_state (seed_key, seed_version, applied_at) VALUES ('demo', ?, ?)
         ON CONFLICT(seed_key) DO UPDATE SET seed_version = excluded.seed_version, applied_at = excluded.applied_at`,
      ).run(SEED_VERSION, time);
      return true;
    }
    return false;
  });

  const applied = apply();
  return { applied, version: SEED_VERSION };
}

export function rememberSeedDeletion(db: Database.Database, seedId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO seed_tombstones (seed_id, removed_at) VALUES (?, ?)",
  ).run(seedId, nowIso());
}
