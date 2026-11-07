import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Building2, ChevronRight, Menu, Search, Sparkles } from "lucide-react";
import { APP_NAME } from "@workbench/shared";
import { NAV_ITEMS } from "./nav.ts";
import { GlobalSearch } from "../features/search/GlobalSearch.tsx";
import { usePersisted } from "../lib/persisted.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import type { UiPreferences } from "../lib/types.ts";

export function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [localSidebar, setSidebar] = usePersisted<boolean>("sidebarCollapsed", false);
  const navigate = useNavigate();
  const location = useLocation();
  const currentModule = NAV_ITEMS.find((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`));
  const searchOrigin = useRef<{ key: string; scroll: number } | null>(null);
  const client = useQueryClient();
  const prefs = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api<{ preferences: UiPreferences }>("/api/settings"),
  });
  const updatePrefs = useMutation({
    mutationFn: (preferences: UiPreferences) =>
      api("/api/settings/preferences", { method: "PATCH", body: preferences }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["preferences"] }),
  });
  const sidebar = prefs.data?.preferences?.sidebarCollapsed ?? localSidebar;

  useEffect(() => {
    const changed = () => void client.invalidateQueries({ predicate: (query) => ["home", "search", "assets", "asset", "products", "agents", "agent", "skills", "skill", "workflows", "workflow", "collections", "collection", "system-info", "settings", "integrations", "preferences"].includes(String(query.queryKey[0])) });
    const recent = () => void client.invalidateQueries({ queryKey: ["home"] });
    window.addEventListener("workbench-data-changed", changed);
    window.addEventListener("workbench-recent-changed", recent);
    return () => { window.removeEventListener("workbench-data-changed", changed); window.removeEventListener("workbench-recent-changed", recent); };
  }, [client]);
  useEffect(() => {
    if (searchOrigin.current?.key === location.key) {
      window.scrollTo(0, searchOrigin.current.scroll);
      searchOrigin.current = null;
      setSearchOpen(true);
    }
  }, [location.key]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`app-shell ${sidebar ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden><Sparkles size={21} strokeWidth={1.8} /></span>
          <span className="brand-text"><span className="brand-name">{APP_NAME}</span><small>团队创意工作空间</small></span>
        </div>
        <p className="sidebar-caption">WORKSPACE</p>
        <nav aria-label="主导航">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              aria-label={label}
              title={sidebar ? label : undefined}
              className={({ isActive }) => `nav-item ${path === "/chat" ? "nav-chat" : ""} ${isActive ? "active" : ""}`}
            >
              <Icon size={18} aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="workspace-identity"><span className="workspace-avatar"><Building2 size={18} aria-hidden /></span><div className="workspace-details"><strong>团队工作空间</strong><span>本机资料 · 共享创作</span></div></div>
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebar ? "展开侧栏" : "收起侧栏"}
            onClick={() => {
              const next = !sidebar;
              setSidebar(next);
              updatePrefs.mutate({
                sidebarCollapsed: next,
                assetView: prefs.data?.preferences?.assetView ?? "list",
              });
            }}
          >
            <Menu size={16} />
          </button>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="workspace-breadcrumb"><span>团队工作空间</span><ChevronRight size={13} aria-hidden /><strong>{currentModule?.label ?? "新对话"}</strong></div>
          <button
            type="button"
            className="search-trigger"
            aria-label="打开全局搜索"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={16} aria-hidden />
            <span>搜索团队内容</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="demo-flag" title="所有 AI、LibTV、连接器执行均为本地演示">
            本地演示
          </span>
        </header>
        <main className={`page ${location.pathname === "/chat" ? "page-chat" : ""}`}>
          {location.state?.searchResult && <button className="btn" onClick={() => navigate(-1)}>返回搜索与原位置</button>}
          <Outlet />
        </main>
      </div>
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpen={(path) => {
          searchOrigin.current = { key: location.key, scroll: window.scrollY };
          setSearchOpen(false);
          navigate(path, { state: { searchResult: true } });
        }}
      />
    </div>
  );
}
