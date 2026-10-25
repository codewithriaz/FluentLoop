import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { BookMarked, Check, ChevronDown, ChevronRight, Copy, Download, Eye, Flag, Plus, RotateCcw, Shuffle, SkipForward, Sparkles, Tags, Trash2, X } from "lucide-react";
import { useApp } from "../AppContext";
import { AiAssistDialog } from "../components/AiAssistDialog";
import { useFeedback } from "../components/feedback";
import { NoteEditor } from "../components/NoteEditor";
import { RecordingBar } from "../components/RecordingBar";
import { ScreenHeader } from "../components/ScreenHeader";
import { SectionTabs } from "../components/SectionTabs";
import { Badge, Button, cx, EmptyState, IconButton, Menu, Modal, SearchField, Select, Spinner, TextArea, TextInput } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { formatTime, relativeDate, speakerLabel } from "../lib/format";
import type { PracticeState, SavedSentence, Speaker, Tag, VaultFilter } from "../lib/types";

function statusBadge(s: SavedSentence) {
  if (s.status === "difficult") return <Badge tone="warn">Difficult</Badge>;
  if (s.status === "practiced") return <Badge tone="success">Practiced ×{s.practiceCount}</Badge>;
  return s.practiceCount === 0 ? <Badge>Not practiced</Badge> : <Badge>New</Badge>;
}

function Field({ label, value, placeholder, multiline, onSave }: { label: string; value: string; placeholder?: string; multiline?: boolean; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setV(value);
  }
  const commit = () => {
    if (v !== value) void onSave(v);
  };
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-muted">
      {label}
      {multiline ? (
        <TextArea rows={2} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} className="normal-case tracking-normal" />
      ) : (
        <TextInput
          value={v}
          placeholder={placeholder}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="normal-case tracking-normal"
        />
      )}
    </label>
  );
}

function VaultItem({
  item,
  tags,
  expanded,
  onToggle,
  onChanged,
  onDeleted,
}: {
  item: SavedSentence;
  tags: Tag[];
  expanded: boolean;
  onToggle: () => void;
  onChanged: (s: SavedSentence) => void;
  onDeleted: () => void;
}) {
  const { openVideo } = useApp();
  const { toast, confirm } = useFeedback();
  const [ai, setAi] = useState(false);

  const update = async (p: Parameters<typeof api.updateSaved>[1]) => {
    try {
      onChanged(await api.updateSaved(item.id, p));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const toggleTag = async (tagId: string) => {
    const ids = item.tags.some((t) => t.id === tagId) ? item.tags.filter((t) => t.id !== tagId).map((t) => t.id) : [...item.tags.map((t) => t.id), tagId];
    try {
      onChanged(await api.setSavedTags(item.id, ids));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Delete saved sentence?", message: "Its note, tags and recordings will be deleted. Transcripts are not affected.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteSaved(item.id);
      onDeleted();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <li className={cx("border-b border-line", expanded && "bg-panel")}>
      <div className="flex cursor-default items-start gap-2 px-5 py-2.5 hover:bg-hover/50" onClick={onToggle}>
        {expanded ? <ChevronDown size={14} className="mt-1 text-faint" /> : <ChevronRight size={14} className="mt-1 text-faint" />}
        <div className="min-w-0 flex-1">
          <div className="selectable text-[14px] leading-snug">{item.text}</div>
          {item.meaning && <div className="selectable mt-0.5 text-[12.5px] text-muted">{item.meaning}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {statusBadge(item)}
            {item.speaker !== "U" && <Badge tone={item.speaker === "A" ? "a" : "b"}>{speakerLabel(item.speaker)}</Badge>}
            {item.tags.map((t) => (
              <Badge key={t.id} tone="accent">
                {t.name}
              </Badge>
            ))}
            {item.note && <Badge>Note</Badge>}
            {item.sources.length > 0 && <span className="text-[11px] text-faint">{item.sources.length} source{item.sources.length > 1 ? "s" : ""}</span>}
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-faint">{relativeDate(item.lastPracticedAt ?? item.createdAt)}</span>
      </div>
      {expanded && (
        <div className="grid grid-cols-1 gap-4 px-11 pb-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Field label="Sentence" value={item.text} onSave={(v) => update({ text: v })} multiline />
            <Field label="Bengali meaning" value={item.meaning ?? ""} placeholder="বাংলা অর্থ" onSave={(v) => update({ meaning: v })} />
            <Field label="Example sentence" value={item.example ?? ""} placeholder="Your own example" onSave={(v) => update({ example: v })} multiline />
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Tags</div>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => {
                  const on = item.tags.some((x) => x.id === t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => void toggleTag(t.id)}
                      className={cx("rounded-full border px-2 py-0.5 text-[11.5px]", on ? "border-accent bg-accent-soft text-accent-text" : "border-line text-muted hover:bg-hover")}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Note</div>
              <NoteEditor entityType="saved_sentence" entityId={item.id} initial={item.note} snippets rows={3} onSaved={(b) => onChanged({ ...item, note: b.trim() ? b : null })} />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Sources</div>
              {item.sources.length === 0 ? (
                <div className="text-[12px] text-faint">Added manually</div>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {item.sources.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={!s.videoId}
                        onClick={() => s.videoId && openVideo(s.videoId, { sentenceId: s.sentenceId ?? undefined, seekTo: s.startSec ?? undefined })}
                        className="text-left text-[12.5px] text-accent-text hover:underline disabled:text-faint disabled:no-underline"
                      >
                        {s.videoTitle ?? "Deleted video"}
                        {s.startSec != null && ` @ ${formatTime(s.startSec)}`}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">My voice</div>
              <RecordingBar savedId={item.id} expectedText={item.text} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" icon={Check} variant={item.status === "practiced" ? "soft" : "secondary"} onClick={() => void update({ status: "practiced" })}>
                Practiced
              </Button>
              <Button size="sm" icon={Flag} variant={item.status === "difficult" ? "soft" : "secondary"} onClick={() => void update({ status: "difficult" })}>
                Difficult
              </Button>
              <Button size="sm" icon={RotateCcw} variant="ghost" onClick={() => void update({ status: "new" })}>
                Reset
              </Button>
              <Select value={item.speaker} onChange={(e) => void update({ speaker: e.target.value as Speaker })} className="h-7 text-[12px]">
                <option value="U">Speaker: unknown</option>
                <option value="A">Person A</option>
                <option value="B">Person B</option>
              </Select>
              <div className="flex-1" />
              <IconButton icon={Copy} label="Copy" onClick={() => void copyText(item.text).then(() => toast("Copied"))} />
              <IconButton icon={Sparkles} label="AI assistant" onClick={() => setAi(true)} />
              <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => void remove()} />
            </div>
          </div>
        </div>
      )}
      {ai && (
        <AiAssistDialog
          text={item.text}
          sourceType="saved_sentence"
          sourceId={item.id}
          sourceLabel="Saved sentence"
          onClose={() => setAi(false)}
          onUseResult={{ label: "Use as meaning", apply: (t) => update({ meaning: t.trim().split("\n")[0] }) }}
        />
      )}
    </li>
  );
}

/** Flashcards over the current vault selection in random order. Attempts are stored as a session. */
function RecallMode({ items, onClose, onChanged }: { items: SavedSentence[]; onClose: () => void; onChanged: (s: SavedSentence) => void }) {
  const { toast } = useFeedback();
  const [order] = useState(() => [...items].sort(() => Math.random() - 0.5));
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const session = useRef<string | null>(null);
  const item = order[i];

  useEffect(
    () => () => {
      if (session.current) void api.endSession(session.current);
    },
    [],
  );

  const act = async (action: "practiced" | "difficult" | "skipped") => {
    try {
      if (!session.current) session.current = await api.startSession(null, "random");
      await api.recordAttempt(session.current, null, item.id, action);
      if (action !== "skipped") onChanged({ ...item, status: action as PracticeState, practiceCount: item.practiceCount + 1, lastPracticedAt: new Date().toISOString() });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
    setShown(false);
    if (i < order.length - 1) setI(i + 1);
    else {
      toast("Round complete!");
      onClose();
    }
  };

  return (
    <Modal title={`Random recall · ${i + 1} / ${order.length}`} onClose={onClose} width={560}>
      <div className="flex flex-col gap-4 py-2">
        <div className="rounded-lg bg-sunken px-4 py-3 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{item.meaning ? "Say this in English" : "Recall the sentence"}</div>
          <div className="mt-1 text-[16px]">{item.meaning ?? (item.tags.map((t) => t.name).join(", ") || "Try to say it from memory")}</div>
          {item.sources[0]?.videoTitle && <div className="mt-1 text-[11.5px] text-faint">from {item.sources[0].videoTitle}</div>}
        </div>
        <div className="min-h-[56px] text-center">
          {shown ? (
            <div className="selectable text-[19px] font-medium leading-snug">{item.text}</div>
          ) : (
            <Button icon={Eye} variant="soft" onClick={() => setShown(true)}>
              Reveal
            </Button>
          )}
        </div>
        <RecordingBar key={item.id} savedId={item.id} compact expectedText={shown ? item.text : undefined} />
        <div className="flex items-center gap-1.5 border-t border-line pt-3">
          <Button icon={SkipForward} variant="ghost" onClick={() => void act("skipped")}>
            Skip
          </Button>
          <div className="flex-1" />
          <Button icon={Flag} onClick={() => void act("difficult")}>
            Difficult
          </Button>
          <Button icon={Check} variant="primary" onClick={() => void act("practiced")}>
            Got it
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function VaultScreen() {
  const { dataVersion } = useApp();
  const { toast, confirm } = useFeedback();
  const [items, setItems] = useState<SavedSentence[] | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [filter, setFilter] = useState<VaultFilter>({ search: "", tagId: "", speaker: "", status: "", sort: "recent" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recall, setRecall] = useState(false);
  const [adding, setAdding] = useState<{ text: string; meaning: string } | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [newTag, setNewTag] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, t] = await Promise.all([api.listSaved(filter), api.listTags()]);
      setItems(list);
      setTags(t);
    } catch (e) {
      toast(errorMessage(e), "error");
      setItems([]);
    }
  }, [filter, toast]);

  useEffect(() => {
    const t = setTimeout(() => void load(), filter.search ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, dataVersion, filter.search]);

  const replace = (s: SavedSentence) => setItems((xs) => xs?.map((x) => (x.id === s.id ? s : x)) ?? xs);
  const set = (p: Partial<VaultFilter>) => setFilter((f) => ({ ...f, ...p }));
  const activeFilters = useMemo(() => !!(filter.search || filter.tagId || filter.speaker || filter.status), [filter]);

  const doExport = async (format: "csv" | "txt") => {
    const path = await save({ defaultPath: `saved-sentences.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (!path) return;
    try {
      const n = await api.exportSaved(path, format, filter);
      toast(`Exported ${n} sentences`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const addManual = async () => {
    if (!adding?.text.trim()) return;
    try {
      const r = await api.saveSentence({ text: adding.text, meaning: adding.meaning || null });
      toast(r.created ? "Sentence saved" : "This sentence is already in your vault");
      setAdding(null);
      void load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title="Second Brain"
        subtitle={items ? `Saved sentences · ${items.length}${activeFilters ? " (filtered)" : ""}` : "Saved sentences"}
        tabs={<SectionTabs section="brain" />}
        actions={
          <>
            <Button icon={Shuffle} onClick={() => setRecall(true)} disabled={!items?.length}>
              Random recall
            </Button>
            <Menu
              trigger={(t) => (
                <Button icon={Download} onClick={t} disabled={!items?.length}>
                  Export
                </Button>
              )}
              items={[
                { label: "Export as CSV", onClick: () => void doExport("csv") },
                { label: "Export as text", onClick: () => void doExport("txt") },
              ]}
            />
            <Button icon={Plus} variant="primary" onClick={() => setAdding({ text: "", meaning: "" })}>
              Add sentence
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <SearchField value={filter.search ?? ""} onChange={(v) => set({ search: v })} placeholder="Search sentences, meanings, notes" shortcut className="w-full max-w-xs" />
          <Select value={filter.tagId} onChange={(e) => set({ tagId: e.target.value })}>
            <option value="">All topics</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.count})
              </option>
            ))}
          </Select>
          <Select value={filter.speaker} onChange={(e) => set({ speaker: e.target.value as Speaker | "" })}>
            <option value="">Any speaker</option>
            <option value="A">Person A</option>
            <option value="B">Person B</option>
            <option value="U">Unknown</option>
          </Select>
          <Select value={filter.status} onChange={(e) => set({ status: e.target.value as VaultFilter["status"] })}>
            <option value="">Any status</option>
            <option value="unpracticed">Never practiced</option>
            <option value="difficult">Difficult</option>
            <option value="practiced">Practiced</option>
            <option value="new">New</option>
          </Select>
          <Select value={filter.sort} onChange={(e) => set({ sort: e.target.value as VaultFilter["sort"] })}>
            <option value="recent">Newest first</option>
            <option value="practiced">Least recently practiced</option>
            <option value="alpha">A–Z</option>
          </Select>
          {activeFilters && (
            <Button size="sm" variant="ghost" icon={X} onClick={() => setFilter({ search: "", tagId: "", speaker: "", status: "", sort: filter.sort })}>
              Clear
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" icon={Tags} onClick={() => setTagsOpen(true)}>
            Manage tags
          </Button>
        </div>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items === null ? (
          <Spinner className="m-6" />
        ) : items.length === 0 ? (
          <EmptyState icon={BookMarked} title={activeFilters ? "No sentences match these filters" : "No saved sentences yet"}>
            {activeFilters ? "Try clearing the filters." : "Click the ☆ on any transcript sentence (or press S) to collect it here, or add one manually."}
          </EmptyState>
        ) : (
          <ul>
            {items.map((it) => (
              <VaultItem
                key={it.id}
                item={it}
                tags={tags}
                expanded={expanded === it.id}
                onToggle={() => setExpanded((e) => (e === it.id ? null : it.id))}
                onChanged={replace}
                onDeleted={() => setItems((xs) => xs?.filter((x) => x.id !== it.id) ?? xs)}
              />
            ))}
          </ul>
        )}
      </div>

      {recall && items && items.length > 0 && <RecallMode items={items} onClose={() => setRecall(false)} onChanged={replace} />}

      {adding && (
        <Modal
          title="Add sentence"
          onClose={() => setAdding(null)}
          width={480}
          footer={
            <>
              <Button onClick={() => setAdding(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void addManual()} disabled={!adding.text.trim()}>
                Save
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <TextArea autoFocus rows={2} placeholder="English sentence" value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value })} />
            <TextInput placeholder="Bengali meaning (optional)" value={adding.meaning} onChange={(e) => setAdding({ ...adding, meaning: e.target.value })} />
          </div>
        </Modal>
      )}

      {tagsOpen && (
        <Modal title="Tags" onClose={() => setTagsOpen(false)} width={420}>
          <div className="mb-3 flex gap-2">
            <TextInput placeholder="New tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
            <Button
              variant="primary"
              disabled={!newTag.trim()}
              onClick={async () => {
                try {
                  await api.createTag(newTag);
                  setNewTag("");
                  void load();
                } catch (e) {
                  toast(errorMessage(e), "error");
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className="divide-y divide-line">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                <span className="flex-1">{t.name}</span>
                <span className="text-[11.5px] text-faint">{t.count}</span>
                <IconButton
                  icon={Trash2}
                  label="Delete tag"
                  tone="danger"
                  onClick={async () => {
                    if (!(await confirm({ title: "Delete tag?", message: `“${t.name}” will be removed from ${t.count} sentence(s).`, confirmLabel: "Delete", danger: true }))) return;
                    await api.deleteTag(t.id).catch((e) => toast(errorMessage(e), "error"));
                    void load();
                  }}
                />
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
