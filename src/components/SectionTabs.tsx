import { useApp } from "../AppContext";
import { SECTION_TABS } from "../lib/nav";
import type { NavId, ScreenName } from "../lib/nav";
import { PageTabs } from "./ui";

/** Tabs for sections that group several existing screens (Video Studio, Second Brain). */
export function SectionTabs({ section }: { section: NavId }) {
  const { route, navigate } = useApp();
  const tabs = SECTION_TABS[section] ?? [];
  return (
    <PageTabs<ScreenName>
      value={route.screen}
      tabs={tabs.map((t) => ({ value: t.screen, label: t.label }))}
      onChange={(screen) => {
        if (screen === "library") navigate({ screen: "library", folderId: null });
        else if (screen === "practice") navigate({ screen: "practice", videoId: null });
        else if (screen === "recent" || screen === "notes" || screen === "vault" || screen === "templates") navigate({ screen });
      }}
    />
  );
}
