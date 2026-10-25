import { describe, expect, it } from "vitest";
import { NAV_ITEMS, SECTION_TABS, navItem, navItemFor } from "./nav";
import type { ScreenName } from "./nav";

const ALL_SCREENS: ScreenName[] = [
  "dashboard", "inbox", "youtube", "library", "recent", "practice", "tasks", "ideas", "planning", "time", "notes", "vault", "templates", "lessons", "tts", "settings",
];

describe("navigation", () => {
  it("lists the 12 sidebar items in order", () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual([
      "Dashboard", "Content Inbox", "YouTube Intelligence", "Video Studio", "My Tasks", "Ideas", "Planning & Goals", "Time Tracker",
      "Second Brain", "Life Lessons", "Audio / TTS", "Settings",
    ]);
  });

  it("maps every screen to exactly one nav item (no orphan or broken routes)", () => {
    for (const s of ALL_SCREENS) {
      expect(NAV_ITEMS.filter((n) => n.screens.includes(s)), s).toHaveLength(1);
    }
    for (const n of NAV_ITEMS) expect(n.screens).toContain(n.screen);
  });

  it("highlights the parent section for grouped screens", () => {
    expect(navItemFor("practice").id).toBe("studio");
    expect(navItemFor("recent").id).toBe("studio");
    expect(navItemFor("vault").id).toBe("brain");
    expect(navItemFor("templates").id).toBe("brain");
    expect(navItemFor("tts").label).toBe("Audio / TTS");
  });

  it("keeps section tabs inside their section", () => {
    for (const [id, tabs] of Object.entries(SECTION_TABS)) {
      for (const t of tabs ?? []) expect(navItemFor(t.screen).id).toBe(id);
    }
  });

  it("marks only unbuilt modules as placeholders", () => {
    const placeholders = NAV_ITEMS.filter((n) => n.placeholder).map((n) => n.id);
    expect(placeholders).toEqual(["inbox", "youtube", "tasks", "ideas", "planning", "time", "lessons"]);
    expect(navItem("studio").placeholder).toBeUndefined();
  });
});
