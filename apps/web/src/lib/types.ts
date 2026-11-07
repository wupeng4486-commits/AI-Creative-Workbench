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

export interface Agent {
  id: string;
  name: string;
  purpose: string;
  domain: string;
  origin: "owned" | "shared";
  author: string;
  instructions: string;
  output_requirements: string;
  cautions: string;
  example_dialog: Array<{ question: string; answer: string }>;
  created_at: string;
  updated_at: string;
  skills: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  assets: Array<{ id: string; name: string }>;
}

export interface Workflow {
  id: string;
  name: string;
  purpose: string;
  origin: "owned" | "shared";
  author: string;
  libtv_ref: string;
  input_spec: string;
  default_parameters: Record<string, unknown>;
  steps: string[];
  cover_file_id: string | null;
  created_at: string;
  updated_at: string;
  skills: Array<{ id: string; name: string }>;
  assets: AssetView[];
}

export interface Draft {
  id: string;
  creationType: "ai_video" | "ai_image" | "design" | "video_join";
  name: string;
  requirements: string;
  parameters: Record<string, unknown>;
  agentId: string | null;
  productId: string | null;
  workflowId: string | null;
  assetIds: string[];
  skillIds: string[];
  clips: Array<{ assetId: string; position: number }>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
