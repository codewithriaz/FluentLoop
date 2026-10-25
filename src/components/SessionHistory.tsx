import { useEffect, useState } from "react";
import { History, StickyNote } from "lucide-react";
import { api } from "../lib/api";
import { relativeDate } from "../lib/format";
import type { Session } from "../lib/types";
import { MODES } from "../screens/workspace/PracticePanel";
import { NoteEditor } from "./NoteEditor";
import { Badge, EmptyState, IconButton, Spinner } from "./ui";

/** Practice sessions (optionally for one video), each with its own note. */
export function SessionHistory({ videoId, onOpenVideo, refreshKey }: { videoId: string | null; onOpenVideo?: (id: string) => void; refreshKey?: number }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);

  useEffect(() => {
    api.listSessions(videoId, 100).then(setSessions).catch(() => setSessions([]));
  }, [videoId, refreshKey]);

  if (!sessions) return <Spinner className="m-4" />;
  if (!sessions.length)
    return (
      <EmptyState icon={History} title="No practice sessions yet">
        Sessions are recorded when you mark lines as practiced, difficult, skipped or record yourself.
      </EmptyState>
    );
  return (
    <ul className="divide-y divide-line">
      {sessions.map((s) => {
        const started = new Date(s.startedAt);
        const mins = s.endedAt ? Math.max(1, Math.round((new Date(s.endedAt).getTime() - started.getTime()) / 60000)) : null;
        return (
          <li key={s.id} className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{MODES.find((m) => m.id === s.mode)?.label ?? s.mode}</div>
                <div className="truncate text-[11.5px] text-muted">
                  {started.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {relativeDate(s.startedAt)}
                  {mins ? ` · ${mins} min` : ""}
                  {!videoId && s.videoTitle && (
                    <>
                      {" · "}
                      <button type="button" className="text-accent-text hover:underline" onClick={() => s.videoId && onOpenVideo?.(s.videoId)}>
                        {s.videoTitle}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                {s.practiced > 0 && <Badge tone="success">{s.practiced} practiced</Badge>}
                {s.difficult > 0 && <Badge tone="warn">{s.difficult} difficult</Badge>}
                {s.skipped > 0 && <Badge>{s.skipped} skipped</Badge>}
                {s.recorded > 0 && <Badge tone="accent">{s.recorded} recorded</Badge>}
              </div>
              <IconButton icon={StickyNote} label="Session note" active={openNote === s.id} onClick={() => setOpenNote((o) => (o === s.id ? null : s.id))} />
            </div>
            {openNote === s.id && (
              <div className="mt-2">
                <NoteEditor entityType="practice_session" entityId={s.id} placeholder="How did this session go? What to repeat next time?" rows={2} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
