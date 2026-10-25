import { useEffect, useState } from "react";
import { AudioLines, BookMarked, ChevronRight, Clapperboard, Film, StickyNote } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { lastOpenedVideo, useApp } from "../AppContext";
import type { Route } from "../AppContext";
import { ScreenHeader } from "../components/ScreenHeader";
import { Page } from "../components/ui";
import { api } from "../lib/api";
import { platformLabel, relativeDate } from "../lib/format";
import type { Video } from "../lib/types";

function Shortcut({ icon: Icon, label, hint, onClick }: { icon: LucideIcon; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-card border border-line bg-panel px-4 py-3 text-left shadow-card outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <Icon size={18} className="shrink-0 text-accent-text" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{label}</span>
        <span className="block truncate text-[12.5px] text-muted">{hint}</span>
      </span>
      <ChevronRight size={16} className="text-faint group-hover:text-muted" />
    </button>
  );
}

/** Deliberately minimal: where you left off, and the main places to go. Real data only. */
export function DashboardScreen() {
  const { navigate, openVideo, dataVersion } = useApp();
  const [last, setLast] = useState<Video | null>(null);

  useEffect(() => {
    const id = lastOpenedVideo();
    if (!id) return;
    api
      .getVideo(id)
      .then(setLast)
      .catch(() => setLast(null));
  }, [dataVersion]);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const go = (r: Route) => () => navigate(r);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title="Dashboard" subtitle={today} />
      <Page width="max-w-3xl">
        {last && (
          <section className="mb-8">
            <h2 className="mb-2 text-[13px] font-medium text-muted">Continue where you left off</h2>
            <button
              type="button"
              onClick={() => openVideo(last.id)}
              className="flex w-full items-center gap-4 rounded-card border border-line bg-panel p-3 text-left shadow-card outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {last.thumbnailUrl ? (
                <img src={last.thumbnailUrl} alt="" className="h-14 w-24 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="flex h-14 w-24 shrink-0 items-center justify-center rounded-md bg-sunken text-faint">
                  <Film size={18} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium">{last.title}</span>
                <span className="block text-[12.5px] text-muted">
                  {platformLabel(last.platform)} · {last.practicedCount}/{last.sentenceCount} sentences practiced · last practiced{" "}
                  {relativeDate(last.lastPracticedAt).toLowerCase()}
                </span>
              </span>
              <ChevronRight size={16} className="text-faint" />
            </button>
          </section>
        )}
        <section>
          <h2 className="mb-2 text-[13px] font-medium text-muted">Go to</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <Shortcut icon={Clapperboard} label="Video Studio" hint="Your videos, transcripts and practice" onClick={go({ screen: "library", folderId: null })} />
            <Shortcut icon={BookMarked} label="Saved Sentences" hint="Phrases you collected" onClick={go({ screen: "vault" })} />
            <Shortcut icon={StickyNote} label="Notes" hint="Everything you wrote down" onClick={go({ screen: "notes" })} />
            <Shortcut icon={AudioLines} label="Audio / TTS" hint="Turn text into speech on this Mac" onClick={go({ screen: "tts" })} />
          </div>
        </section>
      </Page>
    </div>
  );
}
