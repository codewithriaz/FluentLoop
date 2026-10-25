import { useEffect } from "react";
import {
  AudioLines, BookOpen, Brain, Clapperboard, Clock, Inbox, LayoutDashboard, Lightbulb, ListTodo, MonitorPlay, PanelLeftClose, PanelLeftOpen, Repeat2,
  Settings, Target, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApp } from "../AppContext";
import type { Route } from "../AppContext";
import { NAV_ITEMS, navItemFor } from "../lib/nav";
import type { NavId, NavItem } from "../lib/nav";
import { useShell } from "./Shell";
import { IconButton, cx } from "./ui";

const ICONS: Record<NavId, LucideIcon> = {
  dashboard: LayoutDashboard,
  inbox: Inbox,
  youtube: MonitorPlay,
  studio: Clapperboard,
  tasks: ListTodo,
  ideas: Lightbulb,
  planning: Target,
  time: Clock,
  brain: Brain,
  lessons: BookOpen,
  tts: AudioLines,
  settings: Settings,
};

export function routeFor(item: NavItem): Route {
  switch (item.screen) {
    case "library":
      return { screen: "library", folderId: null };
    case "practice":
      return { screen: "practice", videoId: null };
    default:
      return { screen: item.screen } as Route;
  }
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cx("flex items-center gap-2.5", collapsed && "justify-center")}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-accent text-white">
        <Repeat2 size={18} strokeWidth={2.4} />
      </span>
      {!collapsed && <span className="text-[17px] font-semibold tracking-tight">Fluent Loop</span>}
    </div>
  );
}

function NavButton({ item, active, collapsed, onClick }: { item: NavItem; active: boolean; collapsed: boolean; onClick: () => void }) {
  const Icon = ICONS[item.id];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cx(
        "flex h-9 w-full items-center gap-3 rounded-control text-left text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        collapsed ? "justify-center px-0" : "px-3",
        active ? "bg-accent-soft font-medium text-ink" : "text-ink/85 hover:bg-hover hover:text-ink",
      )}
    >
      <Icon size={18} strokeWidth={1.9} className={cx("shrink-0", active ? "text-accent-text" : "text-muted")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { route, navigate } = useApp();
  const activeId = navItemFor(route.screen).id;
  const main = NAV_ITEMS.filter((n) => n.id !== "settings");
  const settings = NAV_ITEMS.find((n) => n.id === "settings");
  const go = (item: NavItem) => {
    navigate(routeFor(item));
    onNavigate?.();
  };
  return (
    <>
      <nav aria-label="Main" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {main.map((item) => (
          <NavButton key={item.id} item={item} active={item.id === activeId} collapsed={collapsed} onClick={() => go(item)} />
        ))}
      </nav>
      {settings && (
        <div className="border-t border-line px-3 py-3">
          <NavButton item={settings} active={activeId === "settings"} collapsed={collapsed} onClick={() => go(settings)} />
        </div>
      )}
    </>
  );
}

export function Sidebar() {
  const { mobile, collapsed, toggleCollapsed, drawerOpen, setDrawerOpen } = useShell();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, setDrawerOpen]);

  if (mobile) {
    if (!drawerOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Navigation">
        <div className="absolute inset-0 bg-black/25" onClick={() => setDrawerOpen(false)} />
        <aside className="relative flex w-[264px] max-w-[85vw] flex-col border-r border-line bg-panel shadow-pop">
          <div data-tauri-drag-region className="h-[38px] shrink-0" />
          <div className="flex items-center justify-between px-5 pb-3">
            <Brand collapsed={false} />
            <IconButton icon={X} label="Close navigation" onClick={() => setDrawerOpen(false)} autoFocus />
          </div>
          <NavList collapsed={false} onNavigate={() => setDrawerOpen(false)} />
        </aside>
      </div>
    );
  }

  return (
    <aside className={cx("flex shrink-0 flex-col border-r border-line bg-panel transition-[width] duration-150", collapsed ? "w-[76px]" : "w-[248px]")}>
      <div data-tauri-drag-region className="h-[38px] shrink-0" />
      <div data-tauri-drag-region className={cx("flex items-center pb-3", collapsed ? "flex-col gap-2 px-3" : "justify-between px-5")}>
        <Brand collapsed={collapsed} />
        <IconButton
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
          className="text-muted"
        />
      </div>
      <NavList collapsed={collapsed} />
    </aside>
  );
}
