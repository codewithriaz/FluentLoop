import { useCallback, useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, ExternalLink, NotebookPen, Plus, StickyNote, Trash2 } from "lucide-react";
import { useApp } from "../AppContext";
import { useFeedback } from "../components/feedback";
import { NoteEditor } from "../components/NoteEditor";
import { ScreenHeader } from "../components/ScreenHeader";
import { SectionTabs } from "../components/SectionTabs";
import { Badge, Button, cx, EmptyState, IconButton, SearchField, Select, Spinner, TextInput } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatTime, relativeDate } from "../lib/format";
import type { NoteListItem } from "../lib/types";

const TYPE_LABELS: Record<string, string> = {
  general: "Notebook",
  video: "Video",
  folder: "Folder",
  transcript: "Transcript",
  sentence: "Sentence",
  saved_sentence: "Saved sentence",
  practice_session: "Practice session",
  template: "Template",
};

export function NotesScreen() {
  const { openVideo, navigate, dataVersion } = useApp();
  const { toast, confirm } = useFeedback();
  const [notes, setNotes] = useState<NoteListItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNotes(await api.listNotes(search || null, type || null));
    } catch (e) {
      toast(errorMessage(e), "error");
      setNotes([]);
    }
  }, [search, type, toast]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, dataVersion, search]);

  const current = notes?.find((n) => n.id === selected) ?? null;

  const createPage = async () => {
    try {
      const n = await api.createGeneralNote("Untitled note");
      await load();
      setSelected(n.id);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const exportAll = async () => {
    const path = await save({ defaultPath: "fluentloop-notes.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!path) return;
    try {
      await api.exportNotes(path);
      toast("Notes exported");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const openSource = (n: NoteListItem) => {
    if (n.entityType === "template") navigate({ screen: "templates", templateId: n.entityId });
    else if (n.entityType === "saved_sentence") navigate({ screen: "vault" });
    else if (n.entityType === "folder") navigate({ screen: "library", folderId: n.entityId });
    else if (n.videoId) openVideo(n.videoId, n.entityType === "sentence" ? { sentenceId: n.entityId } : undefined);
  };

  const remove = async (n: NoteListItem) => {
    if (!(await confirm({ title: "Delete note?", message: "This note will be permanently deleted.", confirmLabel: "Delete", danger: true }))) return;
    await api.deleteNote(n.id).catch((e) => toast(errorMessage(e), "error"));
    setSelected(null);
    void load();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title="Second Brain"
        subtitle="Every note you wrote — on sentences, videos, folders, sessions — plus free notebook pages"
        tabs={<SectionTabs section="brain" />}
        actions={
          <>
            <Button icon={Download} onClick={() => void exportAll()}>
              Export
            </Button>
            <Button icon={Plus} variant="primary" onClick={() => void createPage()}>
              New note
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <div className="flex max-h-[45vh] w-full shrink-0 flex-col border-b border-line md:max-h-none md:w-[340px] md:border-b-0 md:border-r">
          <div className="flex gap-2 border-b border-line p-3">
            <SearchField value={search} onChange={setSearch} placeholder="Search notes" shortcut className="flex-1" />
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {notes === null ? (
              <Spinner className="m-4" />
            ) : notes.length === 0 ? (
              <EmptyState icon={StickyNote} title={search || type ? "No matching notes" : "No notes yet"}>
                Notes you add under sentences, videos and practice sessions appear here.
              </EmptyState>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelected(n.id)}
                  className={cx("block w-full border-b border-line px-3 py-2 text-left", n.id === selected ? "bg-accent-soft" : "hover:bg-hover/60")}
                >
                  <div className="flex items-center gap-1.5">
                    <Badge tone={n.entityType === "general" ? "accent" : "neutral"}>{TYPE_LABELS[n.entityType]}</Badge>
                    <span className="ml-auto text-[11px] text-faint">{relativeDate(n.updatedAt)}</span>
                  </div>
                  <div className="mt-1 truncate text-[13px] font-medium">{n.title ?? n.context ?? "Untitled"}</div>
                  <div className="line-clamp-2 text-[12px] text-muted">{n.body || "Empty"}</div>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {current ? (
            <div className="mx-auto flex max-w-2xl flex-col gap-3">
              <div className="flex items-center gap-2">
                <Badge>{TYPE_LABELS[current.entityType]}</Badge>
                <div className="flex-1" />
                {current.entityType !== "general" && (
                  <Button size="sm" icon={ExternalLink} variant="ghost" onClick={() => openSource(current)}>
                    Open source
                  </Button>
                )}
                <IconButton icon={Trash2} label="Delete note" tone="danger" onClick={() => void remove(current)} />
              </div>
              {current.entityType === "general" ? (
                <TextInput
                  key={current.id}
                  defaultValue={current.title ?? ""}
                  className="h-9 text-[16px] font-semibold"
                  placeholder="Title"
                  onBlur={(e) =>
                    void api
                      .saveNote("general", current.entityId, current.body, e.target.value)
                      .then(load)
                      .catch((err) => toast(errorMessage(err), "error"))
                  }
                />
              ) : (
                current.context && (
                  <div className="selectable rounded-lg bg-sunken px-3 py-2 text-[14px]">
                    {current.context}
                    {current.startSec != null && <span className="ml-2 font-mono text-[11px] text-faint">{formatTime(current.startSec)}</span>}
                  </div>
                )
              )}
              <NoteEditor
                key={current.id}
                entityType={current.entityType}
                entityId={current.entityId}
                initial={current.body}
                rows={14}
                snippets
                onSaved={(b) => setNotes((ns) => ns?.map((x) => (x.id === current.id ? { ...x, body: b, updatedAt: new Date().toISOString() } : x)) ?? ns)}
              />
            </div>
          ) : (
            <EmptyState icon={NotebookPen} title="Select a note">
              Or create a free notebook page for anything — grammar rules, phrases, plans.
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
