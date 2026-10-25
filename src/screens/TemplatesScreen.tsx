import { useCallback, useEffect, useState } from "react";
import { Copy, LayoutTemplate, Plus, Sparkles, Trash2 } from "lucide-react";
import { useApp } from "../AppContext";
import { AiAssistDialog } from "../components/AiAssistDialog";
import { useFeedback } from "../components/feedback";
import { NoteEditor } from "../components/NoteEditor";
import { SaveIndicator } from "../components/SaveIndicator";
import { ScreenHeader } from "../components/ScreenHeader";
import { SectionTabs } from "../components/SectionTabs";
import { Button, cx, EmptyState, IconButton, SearchField, Select, Spinner, TextArea, TextInput } from "../components/ui";
import { useAutosave } from "../hooks/useAutosave";
import { api, errorMessage } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { relativeDate } from "../lib/format";
import type { Template } from "../lib/types";

const CATEGORIES = ["General", "Client Communication", "Sales English", "Role-play", "Vocabulary", "Grammar", "Explanation", "Rewrite", "Examples", "Meetings", "Negotiation"];

function Editor({ t, onChanged, onDeleted }: { t: Template; onChanged: (t: Template) => void; onDeleted: () => void }) {
  const { toast, confirm } = useFeedback();
  const [title, setTitle] = useState(t.title);
  const [content, setContent] = useState(t.content);
  const [category, setCategory] = useState(t.category);
  const { status, error, change } = useAutosave<{ title: string; content: string; category: string }>(async (v) => {
    onChanged(await api.updateTemplate(t.id, v));
  });
  const edit = (p: Partial<{ title: string; content: string; category: string }>) => {
    const next = { title, content, category, ...p };
    if (p.title !== undefined) setTitle(p.title);
    if (p.content !== undefined) setContent(p.content);
    if (p.category !== undefined) setCategory(p.category);
    change(next);
  };
  const remove = async () => {
    if (!(await confirm({ title: "Delete template?", message: `“${t.title}” will be permanently deleted.`, confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteTemplate(t.id);
      onDeleted();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
      <div className="flex items-center gap-2">
        <TextInput value={title} onChange={(e) => edit({ title: e.target.value })} className="h-9 text-[15px] font-semibold" />
        <Select value={CATEGORIES.includes(category) ? category : "__custom"} onChange={(e) => e.target.value !== "__custom" && edit({ category: e.target.value })}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
          {!CATEGORIES.includes(category) && <option value="__custom">{category}</option>}
        </Select>
        <IconButton icon={Copy} label="Copy content" onClick={() => void copyText(content).then(() => toast("Copied"))} />
        <IconButton icon={Trash2} label="Delete template" tone="danger" onClick={() => void remove()} />
      </div>
      <div className="flex items-center gap-2 text-[11.5px] text-faint">
        {t.sourceLabel && <span>Source: {t.sourceLabel}</span>}
        <span>Created {new Date(t.createdAt).toLocaleDateString()}</span>
        <span>· edited {relativeDate(t.updatedAt).toLowerCase()}</span>
        <div className="flex-1" />
        <SaveIndicator status={status} error={error} />
      </div>
      <TextArea value={content} onChange={(e) => edit({ content: e.target.value })} className="min-h-[300px] flex-1 font-[inherit] text-[14px]" placeholder="Template text…" />
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">My notes on this template</div>
        <NoteEditor entityType="template" entityId={t.id} initial={t.note} rows={2} />
      </div>
    </div>
  );
}

export function TemplatesScreen({ initialId }: { initialId?: string }) {
  const { dataVersion } = useApp();
  const { toast } = useFeedback();
  const [list, setList] = useState<Template[] | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [ai, setAi] = useState(false);

  const load = useCallback(async () => {
    try {
      const l = await api.listTemplates(search || null, category || null);
      setList(l);
      setSelected((s) => s ?? l[0]?.id ?? null);
    } catch (e) {
      toast(errorMessage(e), "error");
      setList([]);
    }
  }, [search, category, toast]);

  useEffect(() => {
    // Data fetch; state is set after the IPC call resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, dataVersion]);

  const create = async () => {
    try {
      const t = await api.createTemplate({ title: "New template", content: "", category: category || "General" });
      setList((l) => [t, ...(l ?? [])]);
      setSelected(t.id);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const current = list?.find((t) => t.id === selected) ?? null;
  const categories = Array.from(new Set([...CATEGORIES, ...(list ?? []).map((t) => t.category)]));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title="Second Brain"
        subtitle="Templates — reusable client messages, sales scripts, role-plays and explanations"
        tabs={<SectionTabs section="brain" />}
        actions={
          <>
            <Button icon={Sparkles} onClick={() => setAi(true)}>
              Generate with AI
            </Button>
            <Button icon={Plus} variant="primary" onClick={() => void create()}>
              New template
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <div className="flex max-h-[45vh] w-full shrink-0 flex-col border-b border-line md:max-h-none md:w-[300px] md:border-b-0 md:border-r">
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <SearchField value={search} onChange={setSearch} placeholder="Search templates" shortcut className="" />
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list === null ? (
              <Spinner className="m-4" />
            ) : list.length === 0 ? (
              <div className="p-4 text-[12.5px] text-muted">No templates{search || category ? " match" : " yet"}.</div>
            ) : (
              list.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t.id)}
                  className={cx("block w-full border-b border-line px-3 py-2 text-left", t.id === selected ? "bg-accent-soft" : "hover:bg-hover/60")}
                >
                  <div className="truncate text-[13px] font-medium">{t.title}</div>
                  <div className="truncate text-[11.5px] text-muted">
                    {t.category} · {t.content.slice(0, 60) || "Empty"}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
        {current ? (
          <Editor
            key={current.id}
            t={current}
            onChanged={(t) => setList((l) => l?.map((x) => (x.id === t.id ? t : x)) ?? l)}
            onDeleted={() => {
              setList((l) => l?.filter((x) => x.id !== current.id) ?? l);
              setSelected(null);
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={LayoutTemplate}
              title="No template selected"
              action={
                <Button icon={Plus} variant="primary" onClick={() => void create()}>
                  New template
                </Button>
              }
            >
              Write your own templates, or generate them with the optional AI assistant from any sentence or text.
            </EmptyState>
          </div>
        )}
      </div>
      {ai && (
        <AiAssistDialog
          text=""
          defaultTask="client"
          sourceLabel="Templates"
          onClose={() => {
            setAi(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
