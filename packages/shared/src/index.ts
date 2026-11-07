export const APP_NAME = "AI Creative Workbench";
export const APP_VERSION = "0.1.0";
export const API_PREFIX = "/api";
export const DATA_SET_HEADER = "x-dataset-id";
export const LOCAL_ORIGIN = "http://127.0.0.1:4173";

export type Origin = "owned" | "shared";
export type Provenance = "seed" | "user_import" | "demo_result";
export type SkillType = "platform" | "libtv_reference";
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";
export type CreationType = "ai_video" | "ai_image" | "design" | "video_join";
export type AssetKind = "product" | "file" | "image" | "video" | "audio" | "document" | "other";
export type DemoRunKind = "ai_video" | "ai_image" | "video_join" | "workflow" | "connector";

export const ORIGIN_LABELS: Record<Origin, string> = {
  owned: "我创建的",
  shared: "与我共享的",
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "排队中（模拟）",
  running: "进行中（模拟）",
  completed: "已完成（模拟）",
  failed: "失败（模拟）",
  stopped: "已停止（模拟）",
  interrupted: "已中断（模拟）",
};

export const CREATION_TYPE_LABELS: Record<CreationType, string> = {
  ai_video: "AI 产品视频",
  ai_image: "AI 图片创作",
  design: "美工设计",
  video_join: "视频拼接",
};

export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
  datasetId?: string;
  references?: string[];
}

export interface SystemInfo {
  app: string;
  version: string;
  dataDir: string;
  datasetId: string;
  healthy: boolean;
  counts: Record<string, number>;
  disk: { freeBytes: number | null; totalBytes: number | null };
  lastBackup: { id: string; createdAt: string; size: number } | null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes}分${String(rest).padStart(2, "0")}秒` : `${rest}秒`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
