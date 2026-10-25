import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Menu as MenuIcon } from "lucide-react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { IconButton } from "./ui";

/**
 * Responsive sidebar behaviour:
 *  - ≥1024px: full sidebar, user can collapse to icons (remembered)
 *  - 768–1023px: icon rail
 *  - <768px: hidden; opened as an overlay drawer from the header's menu button
 */
interface ShellApi {
  mobile: boolean;
  collapsed: boolean;
  toggleCollapsed: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const c = useContext(ShellContext);
  if (!c) throw new Error("ShellProvider missing");
  return c;
}

const COLLAPSE_KEY = "fluentloop.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const mobile = useMediaQuery("(max-width: 767px)");
  const narrow = useMediaQuery("(max-width: 1023px)");
  const [userCollapsed, setUserCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setUserCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  }, []);

  // Leaving mobile width closes the drawer.
  useEffect(() => {
    if (!mobile && drawerOpen) {
      const t = setTimeout(() => setDrawerOpen(false), 0);
      return () => clearTimeout(t);
    }
  }, [mobile, drawerOpen]);

  const value = useMemo(
    () => ({ mobile, collapsed: !mobile && (narrow || userCollapsed), toggleCollapsed, drawerOpen, setDrawerOpen }),
    [mobile, narrow, userCollapsed, toggleCollapsed, drawerOpen],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/** Menu button that opens the navigation drawer; renders nothing on wider windows. */
export function ShellMenuButton() {
  const { mobile, setDrawerOpen } = useShell();
  if (!mobile) return null;
  return <IconButton icon={MenuIcon} label="Open navigation" onClick={() => setDrawerOpen(true)} className="h-9 w-9" size={18} />;
}
