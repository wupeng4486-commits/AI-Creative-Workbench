import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Menu, Search } from "lucide-react";
import { APP_NAME } from "@workbench/shared";
import { NAV_ITEMS } from "./nav.ts";
import { GlobalSearch } from "../features/search/GlobalSearch.tsx";
import { usePersisted } from "../lib/persisted.ts";

export function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebar, setSidebar] = usePersisted<boolean>("sidebarCollapsed", false);
  const navigate = useNavigate();

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
          <span className="brand-mark" aria-hidden>
            AI
          </span>
          <span className="brand-text">{APP_NAME}</span>
        </div>
        <nav aria-label="主导航">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <Icon size={18} aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={sidebar ? "展开侧栏" : "收起侧栏"}
          onClick={() => setSidebar(!sidebar)}
        >
          <Menu size={16} />
        </button>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button
            type="button"
            className="search-trigger"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={16} aria-hidden />
            <span>搜索智能体、技能、资产和工作流</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="demo-flag" title="所有 AI、LibTV、连接器执行均为本地演示">
            本地演示
          </span>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpen={(path) => {
          setSearchOpen(false);
          navigate(path);
        }}
      />
    </div>
  );
}
