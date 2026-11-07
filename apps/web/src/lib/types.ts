export interface AssetFile {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
  sha256: string;
  duration: number | null;
  width: number | null;
  height: number | null;
}

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "none";

export interface AssetView {
  id: string;
  name: string;
  asset_type: string;
  file_id: string | null;
  origin: "owned" | "shared";
  provenance: "seed" | "user_import" | "demo_result";
  tags: string[];
  notes: string;
  catalog: string;
  created_at: string;
  updated_at: string;
  file: AssetFile | null;
  previewKind: PreviewKind;
  contentUrl: string | null;
  downloadUrl: string | null;
  thumbUrl: string | null;
}

export interface NasEntry {
  id: string;
  name: string;
  type: "web" | "windows_path";
  address: string;
  note: string;
}

export interface UiPreferences {
  sidebarCollapsed: boolean;
  assetView: "list" | "grid";
}

export interface Skill {
  id: string;
  name: string;
  scenario: string;
  origin: "owned" | "shared";
  author: string;
  skill_type: "platform" | "libtv_reference";
  tags: string[];
  input_spec: string;
  steps: string;
  output_spec: string;
  examples: string;
  external_ref: string;
  created_at: string;
  updated_at: string;
  agents: Array<{ id: string; name: string }>;
  workflows: Array<{ id: string; name: string }>;
}
