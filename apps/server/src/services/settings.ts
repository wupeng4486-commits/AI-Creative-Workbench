import type Database from "better-sqlite3";
import { nowIso, parseJson } from "../util/time.ts";

export interface NasEntry {
  id: string;
  name: string;
  type: "web" | "windows_path";
  address: string;
  note: string;
}

export interface IntegrationConfig {
  url: string;
  note: string;
}

export interface UiPreferences {
  sidebarCollapsed: boolean;
  assetView: "list" | "grid";
}

export const SETTING_KEYS = {
  nas: "integrations.nas",
  libtv: "integrations.libtv",
  jianying: "integrations.jianying",
  preferences: "ui.preferences",
} as const;

export function getSetting<T>(db: Database.Database, key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return parseJson(row?.value, fallback);
}

export function setSetting(db: Database.Database, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), nowIso());
}

export function getIntegrations(db: Database.Database) {
  return {
    nas: getSetting<NasEntry[]>(db, SETTING_KEYS.nas, []),
    libtv: getSetting<IntegrationConfig>(db, SETTING_KEYS.libtv, { url: "", note: "" }),
    jianying: getSetting<IntegrationConfig>(db, SETTING_KEYS.jianying, { url: "", note: "" }),
  };
}

export function getPreferences(db: Database.Database): UiPreferences {
  return getSetting<UiPreferences>(db, SETTING_KEYS.preferences, {
    sidebarCollapsed: false,
    assetView: "list",
  });
}

/** Web integrations must use http(s); Windows paths are copied, never opened. */
export function validateWebUrl(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "入口地址必须以 http:// 或 https:// 开头。";
    }
    return null;
  } catch {
    return "请输入有效的网页地址。";
  }
}
