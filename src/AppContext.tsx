import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errorMessage } from "./lib/api";
import type { DownloadProgress, LibraryInfo } from "./lib/types";
import { useFeedback } from "./components/feedback";

export type Route =
  | { screen: "dashboard" }
  | { screen: "inbox" | "youtube" | "tasks" | "ideas" | "planning" | "time" | "lessons" }
  | { screen: "library"; folderId: string | null }
  | { screen: "recent" }
  | { screen: "practice"; videoId: string | null; seekTo?: number; sentenceId?: string }
  | { screen: "vault" }
  | { screen: "templates"; templateId?: string }
  | { screen: "notes" }
  | { screen: "tts" }
  | { screen: "settings" };

interface AppApi {
  route: Route;
  navigate: (r: Route) => void;
  openVideo: (videoId: string, opts?: { seekTo?: number; sentenceId?: string }) => void;
  /** Incremented whenever library data changes so lists can refetch. */
  dataVersion: number;
  bump: () => void;
  downloads: Record<string, DownloadProgress>;
  startDownload: (videoId: string) => Promise<boolean>;
  settings: Record<string, string>;
  updateSetting: (key: string, value: string) => void;
  info: LibraryInfo | null;
  refreshInfo: () => Promise<void>;
}

const Ctx = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppProvider missing");
  return c;
}

const LAST_ROUTE_KEY = "fluentloop.lastVideo";

export function AppProvider({ children }: { children: ReactNode }) {
  const { toast } = useFeedback();
  const [route, setRoute] = useState<Route>({ screen: "dashboard" });
  const [dataVersion, setDataVersion] = useState(0);
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({});
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  const running = useRef(new Set<string>());

  const bump = useCallback(() => setDataVersion((v) => v + 1), []);

  const refreshInfo = useCallback(async () => {
    const i = await api.libraryInfo();
    setInfo(i);
    if (i.path) setSettings(await api.getSettings().catch(() => ({})));
  }, []);

  useEffect(() => {
    // Initial fetch; state is set asynchronously after the IPC call resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshInfo();
  }, [refreshInfo]);

  useEffect(() => {
    const un = listen<DownloadProgress>("download-progress", (e) => {
      setDownloads((d) => ({ ...d, [e.payload.videoId]: e.payload }));
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Theme + font size
  useEffect(() => {
    const theme = settings.theme ?? "light";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    document.documentElement.style.setProperty("--font-scale", settings.fontScale ?? "1");
    return () => media.removeEventListener("change", apply);
  }, [settings.theme, settings.fontScale]);

  const updateSetting = useCallback(
    (key: string, value: string) => {
      setSettings((s) => ({ ...s, [key]: value }));
      api.setSetting(key, value).catch((e) => toast(errorMessage(e), "error"));
    },
    [toast],
  );

  const startDownload = useCallback(
    async (videoId: string) => {
      if (running.current.has(videoId)) return false;
      running.current.add(videoId);
      setDownloads((d) => ({ ...d, [videoId]: { videoId, percent: 0, message: "Starting download" } }));
      bump();
      try {
        const v = await api.downloadMedia(videoId);
        toast(`Downloaded “${v.title}” for offline practice`);
        return true;
      } catch (e) {
        toast(`Download failed: ${errorMessage(e)}`, "error");
        return false;
      } finally {
        running.current.delete(videoId);
        setDownloads((d) => {
          const next = { ...d };
          delete next[videoId];
          return next;
        });
        bump();
      }
    },
    [bump, toast],
  );

  const navigate = useCallback((r: Route) => {
    setRoute(r);
    if (r.screen === "practice" && r.videoId) {
      try {
        localStorage.setItem(LAST_ROUTE_KEY, r.videoId);
      } catch {
        /* storage unavailable */
      }
    }
  }, []);

  const openVideo = useCallback(
    (videoId: string, opts?: { seekTo?: number; sentenceId?: string }) => navigate({ screen: "practice", videoId, ...opts }),
    [navigate],
  );

  const value = useMemo(
    () => ({ route, navigate, openVideo, dataVersion, bump, downloads, startDownload, settings, updateSetting, info, refreshInfo }),
    [route, navigate, openVideo, dataVersion, bump, downloads, startDownload, settings, updateSetting, info, refreshInfo],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function lastOpenedVideo(): string | null {
  try {
    return localStorage.getItem(LAST_ROUTE_KEY);
  } catch {
    return null;
  }
}
