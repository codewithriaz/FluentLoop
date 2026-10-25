// Navigation model for the app shell. Pure data (no React) so it can be unit tested.
// Screen names are the `Route["screen"]` values in AppContext.

export type ScreenName =
  | "dashboard"
  | "inbox"
  | "youtube"
  | "library"
  | "recent"
  | "practice"
  | "tasks"
  | "ideas"
  | "planning"
  | "time"
  | "notes"
  | "vault"
  | "templates"
  | "lessons"
  | "tts"
  | "settings";

export type NavId =
  | "dashboard"
  | "inbox"
  | "youtube"
  | "studio"
  | "tasks"
  | "ideas"
  | "planning"
  | "time"
  | "brain"
  | "lessons"
  | "tts"
  | "settings";

export interface NavItem {
  id: NavId;
  label: string;
  /** Screen opened when the item is clicked. */
  screen: ScreenName;
  /** All screens that highlight this item. */
  screens: ScreenName[];
  /** Set for modules that are planned but not built yet. */
  placeholder?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", screen: "dashboard", screens: ["dashboard"] },
  { id: "inbox", label: "Content Inbox", screen: "inbox", screens: ["inbox"], placeholder: "Collect links, clips and ideas in one place and sort them later." },
  { id: "youtube", label: "YouTube Intelligence", screen: "youtube", screens: ["youtube"], placeholder: "Research channels and videos to learn what works." },
  { id: "studio", label: "Video Studio", screen: "library", screens: ["library", "recent", "practice"] },
  { id: "tasks", label: "My Tasks", screen: "tasks", screens: ["tasks"], placeholder: "Plan and track your tasks on a board, table or timeline." },
  { id: "ideas", label: "Ideas", screen: "ideas", screens: ["ideas"], placeholder: "Capture ideas quickly and develop the good ones." },
  { id: "planning", label: "Planning & Goals", screen: "planning", screens: ["planning"], placeholder: "Set goals and break them into weekly plans." },
  { id: "time", label: "Time Tracker", screen: "time", screens: ["time"], placeholder: "Track focused time on your work and practice." },
  { id: "brain", label: "Second Brain", screen: "notes", screens: ["notes", "vault", "templates"] },
  { id: "lessons", label: "Life Lessons", screen: "lessons", screens: ["lessons"], placeholder: "Write down lessons from books, people and experience." },
  { id: "tts", label: "Audio / TTS", screen: "tts", screens: ["tts"] },
  { id: "settings", label: "Settings", screen: "settings", screens: ["settings"] },
];

/** Tabs shown under the page header for sections that group several screens. */
export const SECTION_TABS: Partial<Record<NavId, { screen: ScreenName; label: string }[]>> = {
  studio: [
    { screen: "library", label: "Library" },
    { screen: "recent", label: "Recent" },
    { screen: "practice", label: "Watch & Practice" },
  ],
  brain: [
    { screen: "notes", label: "Notes" },
    { screen: "vault", label: "Saved Sentences" },
    { screen: "templates", label: "Templates" },
  ],
};

export function navItemFor(screen: ScreenName): NavItem {
  return NAV_ITEMS.find((n) => n.screens.includes(screen)) ?? NAV_ITEMS[0];
}

export function navItem(id: NavId): NavItem {
  const item = NAV_ITEMS.find((n) => n.id === id);
  if (!item) throw new Error(`Unknown nav item ${id}`);
  return item;
}
