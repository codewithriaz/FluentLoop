import { useEffect, useState } from "react";
import { Film, PlayCircle, Plus } from "lucide-react";
import { lastOpenedVideo, useApp } from "../AppContext";
import { ScreenHeader } from "../components/ScreenHeader";
import { SectionTabs } from "../components/SectionTabs";
import { SessionHistory } from "../components/SessionHistory";
import { Button, EmptyState, SectionTitle, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatTime, platformLabel, relativeDate } from "../lib/format";
import type { Video } from "../lib/types";

/** "Watch & Practice" landing: continue where you left off, pick a video, see history. */
export function PracticeHome() {
  const { openVideo, navigate, dataVersion } = useApp();
  const [videos, setVideos] = useState<Video[] | null>(null);
  const last = lastOpenedVideo();

  useEffect(() => {
    api.listVideos({}).then(setVideos).catch(() => setVideos([]));
  }, [dataVersion]);

  const lastVideo = videos?.find((v) => v.id === last) ?? videos?.[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title="Video Studio" subtitle="Pick a video to open the learning workspace" tabs={<SectionTabs section="studio" />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {videos === null ? (
          <Spinner className="m-6" />
        ) : videos.length === 0 ? (
          <EmptyState
            icon={Film}
            title="No videos yet"
            action={
              <Button variant="primary" icon={Plus} onClick={() => navigate({ screen: "library", folderId: null })}>
                Go to library
              </Button>
            }
          >
            Add a YouTube/Facebook link or import a file first.
          </EmptyState>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-6 p-5">
            {lastVideo && (
              <button
                type="button"
                onClick={() => openVideo(lastVideo.id)}
                className="flex items-center gap-4 rounded-xl border border-line bg-panel p-3 text-left hover:border-accent/50"
              >
                {lastVideo.thumbnailUrl ? (
                  <img src={lastVideo.thumbnailUrl} alt="" className="h-[72px] w-[128px] rounded-md object-cover" />
                ) : (
                  <div className="flex h-[72px] w-[128px] items-center justify-center rounded-md bg-sunken text-faint">
                    <Film size={20} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-text">Continue</div>
                  <div className="truncate text-[15px] font-semibold">{lastVideo.title}</div>
                  <div className="text-[12px] text-muted">
                    {platformLabel(lastVideo.platform)} · {lastVideo.practicedCount}/{lastVideo.sentenceCount} practiced · last practiced {relativeDate(lastVideo.lastPracticedAt).toLowerCase()}
                  </div>
                </div>
                <PlayCircle size={28} className="text-accent" />
              </button>
            )}
            <div>
              <SectionTitle>All videos</SectionTitle>
              <div className="overflow-hidden rounded-xl border border-line bg-panel">
                {videos.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => openVideo(v.id)}
                    className="flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-hover/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{v.title}</div>
                      <div className="text-[11.5px] text-muted">
                        {platformLabel(v.platform)}
                        {v.durationSec != null && ` · ${formatTime(v.durationSec)}`} · {v.sentenceCount} sentences
                      </div>
                    </div>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken" title={`${v.practicedCount}/${v.sentenceCount} practiced`}>
                      <div className="h-full bg-success" style={{ width: `${v.sentenceCount ? (v.practicedCount / v.sentenceCount) * 100 : 0}%` }} />
                    </div>
                    <span className="w-20 text-right text-[11.5px] text-faint">{relativeDate(v.lastPracticedAt)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <SectionTitle>Practice history</SectionTitle>
              <div className="overflow-hidden rounded-xl border border-line bg-panel">
                <SessionHistory videoId={null} onOpenVideo={(id) => openVideo(id)} refreshKey={dataVersion} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
