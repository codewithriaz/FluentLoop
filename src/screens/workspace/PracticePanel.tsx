import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, Flag, Play, Shuffle, SkipForward, Star, StickyNote, Users, Volume2 } from "lucide-react";
import { NoteEditor } from "../../components/NoteEditor";
import { RecordingBar } from "../../components/RecordingBar";
import { useFeedback } from "../../components/feedback";
import { Badge, Button, EmptyState, IconButton, Kbd, Select, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { speakerLabel } from "../../lib/format";
import type { PracticeAction, PracticeMode, PracticeState, Sentence } from "../../lib/types";

export const MODES: { id: PracticeMode; label: string; help: string }[] = [
  { id: "full", label: "Full conversation", help: "Both speakers in the original order, everything visible." },
  { id: "practice_a", label: "Practice Person A", help: "Say Person A’s lines. Hide the reference to test yourself." },
  { id: "hide_a", label: "Hide Person A", help: "Person A’s lines are hidden. Recall them from memory, then reveal." },
  { id: "practice_b", label: "Practice Person B", help: "Hear/see Person A’s line, answer as Person B, then reveal the original answer." },
  { id: "both", label: "Both roles", help: "Every line is hidden; recall each side in order." },
  { id: "random", label: "Random recall", help: "Saved and difficult lines in random order (all lines if none are saved)." },
];

interface Item {
  target: Sentence;
  prompt: Sentence | null;
  hiddenByDefault: boolean;
}

function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildItems(mode: PracticeMode, sentences: Sentence[], seed: number): Item[] {
  const prev = (i: number) => (i > 0 ? sentences[i - 1] : null);
  const withIndex = sentences.map((s, i) => ({ s, i }));
  switch (mode) {
    case "full":
      return withIndex.map(({ s }) => ({ target: s, prompt: null, hiddenByDefault: false }));
    case "practice_a":
      return withIndex.filter(({ s }) => s.speaker === "A").map(({ s, i }) => ({ target: s, prompt: prev(i), hiddenByDefault: false }));
    case "hide_a":
      return withIndex.filter(({ s }) => s.speaker === "A").map(({ s, i }) => ({ target: s, prompt: prev(i), hiddenByDefault: true }));
    case "practice_b":
      return withIndex.filter(({ s }) => s.speaker === "B").map(({ s, i }) => ({ target: s, prompt: prev(i), hiddenByDefault: true }));
    case "both":
      return withIndex.map(({ s, i }) => ({ target: s, prompt: prev(i), hiddenByDefault: true }));
    case "random": {
      const marked = withIndex.filter(({ s }) => s.savedId || s.practiceState === "difficult");
      const pool = marked.length ? marked : withIndex;
      return shuffle(pool, seed).map(({ s, i }) => ({ target: s, prompt: prev(i), hiddenByDefault: true }));
    }
  }
}

interface Props {
  videoId: string;
  sentences: Sentence[];
  active: boolean;
  canPlay: boolean;
  playSegment: (s: Sentence) => Promise<void>;
  onPatch: (id: string, patch: Partial<Sentence>) => void;
  onToggleSave: (s: Sentence) => void;
  onAlternate: () => void;
}

const STORE_KEY = (videoId: string) => `fluentloop.practice.${videoId}`;

function loadPositions(videoId: string): Partial<Record<PracticeMode, string>> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY(videoId)) ?? "{}") as Partial<Record<PracticeMode, string>>;
  } catch {
    return {};
  }
}

export function PracticePanel({ videoId, sentences, active, canPlay, playSegment, onPatch, onToggleSave, onAlternate }: Props) {
  const { toast } = useFeedback();
  const [mode, setMode] = useState<PracticeMode>("full");
  const [onlyDifficult, setOnlyDifficult] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  // Position is remembered per mode by sentence id, so switching modes keeps progress.
  const [positions, setPositions] = useState<Partial<Record<PracticeMode, string>>>(() => loadPositions(videoId));
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [hideReference, setHideReference] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const session = useRef<{ id: string; mode: PracticeMode } | null>(null);

  const allItems = useMemo(() => buildItems(mode, sentences, seed), [mode, sentences, seed]);
  const items = useMemo(() => (onlyDifficult ? allItems.filter((i) => i.target.practiceState === "difficult") : allItems), [allItems, onlyDifficult]);
  const posId = positions[mode];
  const index = Math.max(0, items.findIndex((i) => i.target.id === posId));
  const item = items[index] ?? null;

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY(videoId), JSON.stringify(positions));
    } catch {
      /* ignore */
    }
  }, [positions, videoId]);

  const endSession = useCallback(() => {
    const s = session.current;
    session.current = null;
    if (s) void api.endSession(s.id).catch(() => undefined);
  }, []);

  useEffect(() => endSession, [endSession]);
  const changeMode = (m: PracticeMode) => {
    endSession();
    setRevealed(new Set());
    setNoteOpen(false);
    setMode(m);
  };

  const record = useCallback(
    async (action: PracticeAction, s: Sentence, recordingId: string | null = null) => {
      try {
        if (!session.current || session.current.mode !== mode) {
          endSession();
          session.current = { id: await api.startSession(videoId, mode), mode };
        }
        await api.recordAttempt(session.current.id, s.id, null, action, recordingId);
        if (action === "practiced" || action === "difficult") {
          onPatch(s.id, { practiceState: action as PracticeState, practiceCount: s.practiceCount + 1, lastPracticedAt: new Date().toISOString() });
        }
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [mode, videoId, endSession, onPatch, toast],
  );

  const go = useCallback(
    (delta: number) => {
      if (!items.length) return;
      const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
      setPositions((p) => ({ ...p, [mode]: next.target.id }));
      setNoteOpen(false);
    },
    [items, index, mode],
  );

  const hidden = !!item && (item.hiddenByDefault || (mode === "practice_a" && hideReference)) && !revealed.has(item.target.id);

  const reveal = useCallback(() => {
    if (!item) return;
    setRevealed((r) => new Set(r).add(item.target.id));
    void record("revealed", item.target);
  }, [item, record]);

  const mark = useCallback(
    (action: "practiced" | "difficult" | "skipped") => {
      if (!item) return;
      void record(action, item.target);
      if (action !== "difficult") go(1);
    },
    [item, record, go],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Enter") {
        if (hidden) reveal();
        else mark("practiced");
      }
      else if (e.key.toLowerCase() === "r" && item && canPlay) void playSegment(item.target);
      else if (e.key.toLowerCase() === "d") mark("difficult");
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, go, hidden, reveal, mark, item, canPlay, playSegment]);

  const hasSpeakers = sentences.some((s) => s.speaker !== "U");
  const needsSpeakers = ["practice_a", "hide_a", "practice_b"].includes(mode) && !hasSpeakers;
  const done = items.filter((i) => i.target.practiceState === "practiced").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Select value={mode} onChange={(e) => changeMode(e.target.value as PracticeMode)} className="h-7 text-[12.5px]">
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={() => setOnlyDifficult((v) => !v)}
          className={cx("h-7 rounded-md px-2 text-[11.5px] font-medium", onlyDifficult ? "bg-warn-soft text-warn" : "text-muted hover:bg-hover")}
          title="Repeat only the lines marked difficult"
        >
          <Flag size={11} className="mr-1 inline" />
          Difficult only
        </button>
        {mode === "practice_a" && (
          <button
            type="button"
            onClick={() => setHideReference((v) => !v)}
            className={cx("h-7 rounded-md px-2 text-[11.5px] font-medium", hideReference ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-hover")}
          >
            {hideReference ? "Reference hidden" : "Hide reference"}
          </button>
        )}
        {mode === "random" && <IconButton icon={Shuffle} label="Reshuffle" onClick={() => setSeed((s) => s + 1)} />}
        <div className="flex-1" />
        <span className="text-[11.5px] text-faint">
          {items.length ? `${index + 1} / ${items.length}` : "0"} · {done} practiced
        </span>
      </div>
      <div className="shrink-0 px-4 pt-2 text-[11.5px] text-muted">{MODES.find((m) => m.id === mode)?.help}</div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {needsSpeakers ? (
          <EmptyState
            icon={Users}
            title="Assign speakers first"
            action={
              <Button icon={Users} onClick={onAlternate}>
                Alternate A / B for all lines
              </Button>
            }
          >
            This mode needs Person A / Person B labels. Click the “?” chip next to a sentence to set its speaker, or alternate them automatically and correct mistakes.
          </EmptyState>
        ) : !item ? (
          <EmptyState icon={Flag} title={onlyDifficult ? "No difficult lines" : "Nothing to practice"}>
            {onlyDifficult ? "Lines you mark as difficult will appear here." : "Import a transcript to start practicing."}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {item.prompt && mode !== "full" && (
              <div className="rounded-lg border border-line bg-sunken px-3 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={item.prompt.speaker === "A" ? "a" : item.prompt.speaker === "B" ? "b" : "neutral"}>{speakerLabel(item.prompt.speaker)} says</Badge>
                  {canPlay && item.prompt.startSec != null && (
                    <IconButton icon={Volume2} label="Play this line" size={13} onClick={() => item.prompt && void playSegment(item.prompt)} />
                  )}
                </div>
                <div className="selectable text-[14px] leading-relaxed text-ink/85">{item.prompt.text}</div>
              </div>
            )}

            <div className={cx("rounded-xl border-2 px-4 py-4", item.target.speaker === "A" ? "border-pa/30" : item.target.speaker === "B" ? "border-pb/30" : "border-line")}>
              <div className="mb-2 flex items-center gap-2">
                <Badge tone={item.target.speaker === "A" ? "a" : item.target.speaker === "B" ? "b" : "neutral"}>
                  {mode === "full" ? speakerLabel(item.target.speaker) : `Your line · ${speakerLabel(item.target.speaker)}`}
                </Badge>
                {item.target.practiceState === "practiced" && <Badge tone="success">Practiced</Badge>}
                {item.target.practiceState === "difficult" && <Badge tone="warn">Difficult</Badge>}
                <div className="flex-1" />
                {hidden ? (
                  <Button size="sm" icon={Eye} variant="soft" onClick={reveal} title="Reveal (Enter)">
                    Reveal
                  </Button>
                ) : (
                  (item.hiddenByDefault || hideReference) && (
                    <IconButton
                      icon={EyeOff}
                      label="Hide again (retry)"
                      onClick={() =>
                        setRevealed((r) => {
                          const n = new Set(r);
                          n.delete(item.target.id);
                          return n;
                        })
                      }
                    />
                  )
                )}
              </div>
              {hidden ? (
                <div className="py-3 text-[15px] text-faint">
                  {item.target.text
                    .split(/\s+/)
                    .map((w) => "•".repeat(Math.min(w.length, 8)))
                    .join("  ")}
                </div>
              ) : (
                <div className="selectable text-[18px] font-medium leading-relaxed">{item.target.text}</div>
              )}
              {(showMeaning || (!hidden && mode === "full")) && item.target.translation && (
                <div className="selectable mt-1 text-[14px] text-muted">{item.target.translation}</div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Button size="sm" icon={Play} onClick={() => void playSegment(item.target)} disabled={!canPlay || item.target.startSec == null} title="Replay original (R)">
                  Original
                </Button>
                {item.target.translation && (
                  <Button size="sm" variant={showMeaning ? "soft" : "ghost"} onClick={() => setShowMeaning((v) => !v)}>
                    Meaning
                  </Button>
                )}
                <Button size="sm" variant={item.target.savedId ? "soft" : "ghost"} icon={Star} onClick={() => onToggleSave(item.target)}>
                  {item.target.savedId ? "Saved" : "Save"}
                </Button>
                <Button size="sm" variant={noteOpen ? "soft" : "ghost"} icon={StickyNote} onClick={() => setNoteOpen((v) => !v)}>
                  Note
                </Button>
              </div>
              <div className="mt-3 border-t border-line pt-3">
                <RecordingBar
                  key={item.target.id}
                  sentenceId={item.target.id}
                  expectedText={hidden ? undefined : item.target.text}
                  playOriginal={canPlay && item.target.startSec != null ? () => playSegment(item.target) : undefined}
                  onRecorded={(r) => {
                    void record("recorded", item.target, r.id);
                    onPatch(item.target.id, { recordingCount: item.target.recordingCount + 1 });
                  }}
                />
              </div>
              {noteOpen && (
                <div className="mt-3">
                  <NoteEditor
                    key={item.target.id}
                    entityType="sentence"
                    entityId={item.target.id}
                    initial={item.target.note}
                    snippets
                    onSaved={(b) => onPatch(item.target.id, { note: b.trim() ? b : null })}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <Button icon={ChevronLeft} onClick={() => go(-1)} disabled={index === 0} title="Previous (←)">
                Prev
              </Button>
              <Button icon={SkipForward} variant="ghost" onClick={() => mark("skipped")}>
                Skip
              </Button>
              <div className="flex-1" />
              <Button icon={Flag} variant={item.target.practiceState === "difficult" ? "soft" : "secondary"} onClick={() => mark("difficult")} title="Mark difficult (D)">
                Difficult
              </Button>
              <Button icon={Check} variant="primary" onClick={() => mark("practiced")} title="Mark practiced and go next (Enter)">
                Practiced
              </Button>
              <Button icon={ChevronRight} onClick={() => go(1)} disabled={index >= items.length - 1} title="Next (→)">
                Next
              </Button>
            </div>
            <div className="text-[11px] text-faint">
              <Kbd>Enter</Kbd> reveal / practiced · <Kbd>←</Kbd> <Kbd>→</Kbd> move · <Kbd>R</Kbd> replay · <Kbd>D</Kbd> difficult
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
