export interface DiscoveryItem {
  id: string;
  type: string;
  name: string;
  description: string;
  tags: string[];
  origin: string;
  demo: boolean;
  updatedAt: string;
  href: string;
}
export const RESOURCE_LABELS: Record<string, string> = { agent: "智能体", skill: "技能", asset: "文件", workflow: "工作流" };

export interface HomeOverview {
  counts: { agents: number; skills: number; sharedFiles: number; workflows: number };
  shared: DiscoveryItem[];
  recent: Array<{ id: string; type: string; name: string; href: string; demo: boolean; visitedAt: string }>;
  activities: Array<{ id: string; action: string; href: string | null; demo: boolean; createdAt: string }>;
}
