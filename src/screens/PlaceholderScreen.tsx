import { Clock3 } from "lucide-react";
import { ScreenHeader } from "../components/ScreenHeader";
import { Page } from "../components/ui";
import type { NavItem } from "../lib/nav";

/** Intentional page for modules that are planned but not built yet (no mock data). */
export function PlaceholderScreen({ item }: { item: NavItem }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title={item.label} subtitle={item.placeholder} />
      <Page width="max-w-xl">
        <div className="mt-10 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent-text">
            <Clock3 size={22} />
          </div>
          <div className="text-[16px] font-semibold">{item.label} is coming soon</div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
            This module is planned for a later phase. Nothing here is stored yet, and the rest of Fluent Loop works as usual.
          </p>
        </div>
      </Page>
    </div>
  );
}
