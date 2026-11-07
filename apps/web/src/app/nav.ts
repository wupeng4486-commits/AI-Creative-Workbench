import {
  Users,
  Sparkles,
  FolderOpen,
  PlugZap,
  ListChecks,
  GitBranch,
  Database,
  LayoutDashboard,
  SquarePen,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: typeof Users;
}

/** The general agent is the first entry, followed by the team workspace. */
export const NAV_ITEMS: NavItem[] = [
  { path: "/chat", label: "新对话", icon: SquarePen },
  { path: "/home", label: "团队动态", icon: LayoutDashboard },
  { path: "/agents", label: "智能体", icon: Users },
  { path: "/studio", label: "创作工作室", icon: Sparkles },
  { path: "/assets", label: "资产库", icon: FolderOpen },
  { path: "/connectors", label: "连接器", icon: PlugZap },
  { path: "/skills", label: "技能", icon: ListChecks },
  { path: "/workflows", label: "工作流", icon: GitBranch },
  { path: "/settings", label: "数据与设置", icon: Database },
];
