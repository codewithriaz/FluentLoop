import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  ArrowDown, ArrowUp, Check, ClipboardCopy, Clock, Copy, Download, FileUp, Flag, Languages, ListPlus, Merge, MoreHorizontal, PencilLine, Play,
  Scissors, Search, Sparkles, Star, StickyNote, Trash2, Users,
} from "lucide-react";
import { NoteEditor } from "../../components/NoteEditor";
import { Button, EmptyState, IconButton, Menu, Segmented, TextArea, TextInput, cx } from "../../components/ui";
import { formatTime } from "../../lib/format";
import type { PracticeState, Sentence, Speaker } from "../../lib/types";

export type Display = "en" | "bn" | "both";

export interface SentenceActions {
  seek: (s: Sentence) => void;
  play: (s: Sentence) => void;
  toggleNote: (id: string) => void;
  toggleSave: (s: Sentence) => void;
  copy: (text: string) => void;
  setState: (s: Sentence, state: PracticeState) => void;
  setSpeaker: (s: Sentence, sp: Speaker) => void;
  saveText: (s: Sentence, text: string) => Promise<boolean>;
  saveTranslation: (s: Sentence, text: string) => Promise<boolean>;
  split: (s: Sentence, at: number) => void;
  merge: (s: Sentence) => void;
  move: (s: Sentence, dir: -1 | 1) => void;
  insertAfter: (s: Sentence) => void;
  setTime: (s: Sentence, which: "start" | "end") => void;
  alternateFrom: (s: Sentence) => void;
  ai: (s: Sentence) => void;
  remove: (s: Sentence) => void;
  noteSaved: (id: string, body: string) => void;
}

const nextSpeaker: Record<Speaker, Speaker> = { U: "A", A: "B", B: "U" };

function SpeakerChip({ speaker, onClick }: { speaker: Speaker; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Speaker — click to change (A → B → Unknown)"
      className={cx(
        "mt-px h-5 w-5 shrink-0 rounded text-[10.5px] font-bold",
        speaker === "A" ? "bg-pa-soft text-pa" : speaker === "B" ? "bg-pb-soft text-pb" : "border border-dashed border-line-strong text-faint",
      )}
    >
      {speaker === "U" ? "?" : speaker}
    </button>
  );
}

interface RowProps {
  s: Sentence;
  index: number;
  active: boolean;
  selected: boolean;
  noteOpen: boolean;
  display: Display;
  isLast: boolean;
  actions: SentenceActions;
  highlight: string;
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-warn-soft px-px text-ink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export const SentenceRow = memo(function SentenceRow({ s, index, active, selected, noteOpen, display, isLast, actions, highlight }: RowProps) {
  const [editing, setEditing] = useState<"text" | "translation" | null>(null);
  const [draft, setDraft] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);

  const startEdit = (kind: "text" | "translation") => {
    setDraft(kind === "text" ? s.text : (s.translation ?? ""));
    setEditing(kind);
  };
  const commit = async () => {
    if (!editing) return;
    const ok = editing === "text" ? await actions.saveText(s, draft) : await actions.saveTranslation(s, draft);
    if (ok) setEditing(null);
  };

  const showEn = display !== "bn";
  const showBn = display !== "en";

  return (
    <div
      data-sentence-id={s.id}
      className={cx(
        "group relative border-l-2 px-3 py-2 transition-colors",
        active ? "border-accent bg-accent-soft/60" : selected ? "border-line-strong bg-hover/70" : "border-transparent hover:bg-hover/50",
      )}
      onClick={() => !editing && actions.seek(s)}
    >
      <div className="flex gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.play(s);
          }}
          className="mt-px w-11 shrink-0 text-left font-mono text-[11px] text-faint hover:text-accent"
          title={s.startSec != null ? "Play this sentence" : "No timestamp"}
        >
          {s.startSec != null ? formatTime(s.startSec) : `#${index + 1}`}
        </button>
        <SpeakerChip speaker={s.speaker} onClick={() => actions.setSpeaker(s, nextSpeaker[s.speaker])} />
        <div className="min-w-0 flex-1">
          {editing === "text" ? (
            <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-1.5">
              <TextArea
                ref={editRef}
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void commit();
                  }
                  if (e.key === "Escape") setEditing(null);
                }}
              />
              <div className="flex gap-1.5">
                <Button size="sm" variant="primary" onClick={() => void commit()}>
                  Save
                </Button>
                <Button size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  icon={Scissors}
                  variant="ghost"
                  title="Split this sentence at the cursor position"
                  onClick={() => {
                    const at = editRef.current?.selectionStart ?? 0;
                    setEditing(null);
                    actions.split(s, at);
                  }}
                >
                  Split at cursor
                </Button>
              </div>
            </div>
          ) : (
            <>
              {showEn && (
                <div className={cx("selectable text-[14px] leading-relaxed", active && "font-medium")} onDoubleClick={() => startEdit("text")}>
                  <Highlight text={s.text} q={highlight} />
                </div>
              )}
              {showBn && editing !== "translation" && (
                <div
                  className={cx("selectable leading-relaxed", showEn ? "mt-0.5 text-[13px] text-muted" : "text-[14px]", !s.translation && "italic text-faint")}
                  onDoubleClick={() => startEdit("translation")}
                >
                  {s.translation ? <Highlight text={s.translation} q={highlight} /> : showEn ? null : `${s.text} (no translation yet)`}
                </div>
              )}
            </>
          )}
          {editing === "translation" && (
            <div onClick={(e) => e.stopPropagation()} className="mt-1 flex gap-1.5">
              <TextInput
                autoFocus
                value={draft}
                placeholder="বাংলা অর্থ / meaning"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") void commit();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
              <Button size="sm" variant="primary" onClick={() => void commit()}>
                Save
              </Button>
            </div>
          )}
          {s.note && !noteOpen && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                actions.toggleNote(s.id);
              }}
              className="mt-1 line-clamp-2 w-full rounded bg-warn-soft/70 px-2 py-1 text-left text-[12px] text-ink/80 whitespace-pre-wrap"
            >
              {s.note}
            </button>
          )}
          {noteOpen && (
            <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
              <NoteEditor entityType="sentence" entityId={s.id} initial={s.note} autoFocus snippets rows={3} onSaved={(b) => actions.noteSaved(s.id, b)} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-0.5">
          {s.practiceState === "practiced" && <Check size={13} className="mt-1 text-success" aria-label="Practiced" />}
          {s.practiceState === "difficult" && <Flag size={13} className="mt-1 text-warn" aria-label="Difficult" />}
          {s.savedId && <Star size={13} className="mt-1 fill-current text-warn" aria-label="Saved" />}
        </div>
      </div>
      {!editing && (
        <div
          className={cx(
            "absolute right-2 top-1 z-10 hidden items-center rounded-md border border-line bg-panel shadow-sm group-hover:flex",
            selected && "flex",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton icon={Play} label="Replay sentence" size={13} onClick={() => actions.play(s)} disabled={s.startSec == null} />
          <IconButton icon={StickyNote} label="Add note (N)" size={13} active={noteOpen} onClick={() => actions.toggleNote(s.id)} />
          <IconButton icon={Star} label={s.savedId ? "Remove from Saved Sentences" : "Save sentence (S)"} size={13} active={!!s.savedId} onClick={() => actions.toggleSave(s)} />
          <IconButton icon={Copy} label="Copy sentence" size={13} onClick={() => actions.copy(s.text)} />
          <IconButton
            icon={Check}
            label={s.practiceState === "practiced" ? "Mark as not practiced" : "Mark practiced (P)"}
            size={13}
            tone={s.practiceState === "practiced" ? "success" : "default"}
            onClick={() => actions.setState(s, s.practiceState === "practiced" ? "new" : "practiced")}
          />
          <IconButton icon={Languages} label="Show / edit meaning" size={13} onClick={() => startEdit("translation")} />
          <Menu
            trigger={(t) => <IconButton icon={MoreHorizontal} label="More" size={13} onClick={t} />}
            items={[
              { label: "Edit text", icon: PencilLine, onClick: () => startEdit("text") },
              { label: "Explain with AI", icon: Sparkles, onClick: () => actions.ai(s) },
              {
                label: s.practiceState === "difficult" ? "Unmark difficult" : "Mark difficult",
                icon: Flag,
                onClick: () => actions.setState(s, s.practiceState === "difficult" ? "new" : "difficult"),
              },
              "divider",
              { label: "Set start to current time", icon: Clock, onClick: () => actions.setTime(s, "start") },
              { label: "Set end to current time", icon: Clock, onClick: () => actions.setTime(s, "end") },
              { label: "Alternate A/B from here", icon: Users, onClick: () => actions.alternateFrom(s) },
              "divider",
              { label: "Insert sentence below", icon: ListPlus, onClick: () => actions.insertAfter(s) },
              { label: "Merge with next", icon: Merge, disabled: isLast, onClick: () => actions.merge(s) },
              { label: "Split…", icon: Scissors, onClick: () => startEdit("text") },
              { label: "Move up", icon: ArrowUp, disabled: index === 0, onClick: () => actions.move(s, -1) },
              { label: "Move down", icon: ArrowDown, disabled: isLast, onClick: () => actions.move(s, 1) },
              "divider",
              { label: "Delete sentence", icon: Trash2, danger: true, onClick: () => actions.remove(s) },
            ]}
          />
        </div>
      )}
    </div>
  );
});

interface PanelProps {
  sentences: Sentence[];
  activeId: string | null;
  selectedId: string | null;
  openNotes: Set<string>;
  display: Display;
  onDisplay: (d: Display) => void;
  follow: boolean;
  onFollow: (f: boolean) => void;
  actions: SentenceActions;
  searchRef: RefObject<HTMLInputElement | null>;
  onImport: () => void;
  onTranslations: () => void;
  onExport: (format: "txt" | "srt" | "vtt" | "md") => void;
  onCopyAll: () => void;
  onCopyTimed: (layout: "paragraph" | "lines") => void;
  onAddFirst: () => void;
  transcriptSource: string | null;
}

export function TranscriptPanel({ searchRef, ...p }: PanelProps) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return p.sentences.map((s, i) => ({ s, i }));
    return p.sentences
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.text.toLowerCase().includes(q) || (s.translation ?? "").toLowerCase().includes(q) || (s.note ?? "").toLowerCase().includes(q));
  }, [p.sentences, query]);

  useEffect(() => {
    if (!p.follow || !p.activeId || query) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-sentence-id="${p.activeId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [p.activeId, p.follow, query]);

  useEffect(() => {
    if (!p.selectedId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-sentence-id="${p.selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [p.selectedId]);

  const tagged = p.sentences.filter((s) => s.speaker !== "U").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="relative min-w-[140px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-2 text-faint" />
          <TextInput
            ref={searchRef}
            className="h-7 pl-7 text-[12.5px]"
            placeholder="Search transcript (⌘F)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
          />
        </div>
        <Segmented<Display>
          size="sm"
          value={p.display}
          onChange={p.onDisplay}
          options={[
            { value: "en", label: "EN", title: "English only" },
            { value: "bn", label: "বাং", title: "Bengali only" },
            { value: "both", label: "EN+বাং", title: "English and Bengali" },
          ]}
        />
        <button
          type="button"
          onClick={() => p.onFollow(!p.follow)}
          className={cx("h-7 rounded-md px-2 text-[11.5px] font-medium", p.follow ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-hover")}
          title="Auto-scroll to the sentence being played"
        >
          Follow
        </button>
        <Menu
          trigger={(t) => <IconButton icon={Download} label="Download transcript / subtitles (SRT, VTT, TXT)" onClick={t} disabled={!p.sentences.length} />}
          items={[
            { label: "Subtitles — SRT", hint: ".srt", icon: Download, onClick: () => p.onExport("srt") },
            { label: "Subtitles — VTT", hint: ".vtt", icon: Download, onClick: () => p.onExport("vtt") },
            { label: "Plain text", hint: ".txt", icon: Download, onClick: () => p.onExport("txt") },
            { label: "Text with notes & meanings", hint: ".md", icon: Download, onClick: () => p.onExport("md") },
          ]}
        />
        <Menu
          trigger={(t) => <IconButton icon={ClipboardCopy} label="Copy transcript" onClick={t} disabled={!p.sentences.length} />}
          items={[
            { label: "Copy with timestamps", hint: "(0:05) text", icon: Clock, onClick: () => p.onCopyTimed("paragraph") },
            { label: "Copy with timestamps, one per line", icon: Clock, onClick: () => p.onCopyTimed("lines") },
            { label: "Copy text only", icon: ClipboardCopy, onClick: p.onCopyAll },
          ]}
        />
        <Menu
          trigger={(t) => <IconButton icon={MoreHorizontal} label="Transcript actions" onClick={t} />}
          items={[
            { label: "Import / replace transcript…", icon: FileUp, onClick: p.onImport },
            { label: "Add Bengali translations…", icon: Languages, onClick: p.onTranslations, disabled: !p.sentences.length },
            { label: "Copy all text", icon: ClipboardCopy, onClick: p.onCopyAll, disabled: !p.sentences.length },
            { label: "Copy with timestamps — (0:05) text …", icon: Clock, onClick: () => p.onCopyTimed("paragraph"), disabled: !p.sentences.length },
            { label: "Copy with timestamps, one per line", icon: Clock, onClick: () => p.onCopyTimed("lines"), disabled: !p.sentences.length },
            "divider",
            { label: "Export as TXT", icon: Download, onClick: () => p.onExport("txt"), disabled: !p.sentences.length },
            { label: "Export as SRT", icon: Download, onClick: () => p.onExport("srt"), disabled: !p.sentences.length },
            { label: "Export as VTT", icon: Download, onClick: () => p.onExport("vtt"), disabled: !p.sentences.length },
            { label: "Export with notes (Markdown)", icon: Download, onClick: () => p.onExport("md"), disabled: !p.sentences.length },
          ]}
        />
      </div>
      {p.sentences.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1 text-[11px] text-faint">
          <span>{query ? `${visible.length} of ${p.sentences.length}` : `${p.sentences.length} sentences`}</span>
          <span>· {p.sentences.filter((s) => s.practiceState === "practiced").length} practiced</span>
          <span>· {tagged} with speaker</span>
          {p.transcriptSource && <span className="ml-auto">source: {p.transcriptSource}</span>}
        </div>
      )}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-24">
        {p.sentences.length === 0 ? (
          <EmptyState
            icon={FileUp}
            title="No transcript yet"
            action={
              <div className="flex gap-2">
                <Button variant="primary" icon={FileUp} onClick={p.onImport}>
                  Import transcript
                </Button>
                <Button icon={ListPlus} onClick={p.onAddFirst}>
                  Type a sentence
                </Button>
              </div>
            }
          >
            Paste text, import a TXT/SRT/VTT file, or fetch the video’s public captions. Nothing is invented — if no captions exist, paste your own.
          </EmptyState>
        ) : visible.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-muted">No sentence matches “{query}”.</div>
        ) : (
          visible.map(({ s, i }) => (
            <SentenceRow
              key={s.id}
              s={s}
              index={i}
              active={s.id === p.activeId}
              selected={s.id === p.selectedId}
              noteOpen={p.openNotes.has(s.id)}
              display={p.display}
              isLast={i === p.sentences.length - 1}
              actions={p.actions}
              highlight={query.trim()}
            />
          ))
        )}
      </div>
    </div>
  );
}
