import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { NoteEntity } from "../lib/types";
import { useAutosave } from "../hooks/useAutosave";
import { useFeedback } from "./feedback";
import { SaveIndicator } from "./SaveIndicator";
import { IconButton, Spinner, TextArea, cx } from "./ui";

const SNIPPETS = [
  { label: "Vocabulary", text: "Vocabulary: " },
  { label: "Grammar", text: "Grammar: " },
  { label: "Example", text: "My example: " },
  { label: "বাংলা", text: "বাংলা: " },
];

interface Props {
  entityType: NoteEntity;
  entityId: string;
  /** Known body (skips the initial fetch). `undefined` means unknown. */
  initial?: string | null;
  placeholder?: string;
  rows?: number;
  snippets?: boolean;
  autoFocus?: boolean;
  className?: string;
  onSaved?: (body: string) => void;
}

/** Autosaving note bound to one entity. Empty notes are removed by the backend. */
export function NoteEditor({ entityType, entityId, initial, placeholder, rows = 3, snippets, autoFocus, className, onSaved }: Props) {
  const { confirm } = useFeedback();
  const [body, setBody] = useState<string | null>(initial === undefined ? null : (initial ?? ""));
  const ref = useRef<HTMLTextAreaElement>(null);
  const onSavedRef = useRef(onSaved);
  useLayoutEffect(() => {
    onSavedRef.current = onSaved;
  });
  const { status, error, change } = useAutosave<string>(async (value) => {
    await api.saveNote(entityType, entityId, value);
    onSavedRef.current?.(value);
  });

  useEffect(() => {
    if (initial !== undefined) return;
    let alive = true;
    api
      .getNote(entityType, entityId)
      .then((n) => alive && setBody(n?.body ?? ""))
      .catch(() => alive && setBody(""));
    return () => {
      alive = false;
    };
  }, [entityType, entityId, initial]);

  if (body === null) return <Spinner />;

  const update = (v: string) => {
    setBody(v);
    change(v);
  };

  const insert = (text: string) => {
    const el = ref.current;
    const prefix = body && !body.endsWith("\n") ? "\n" : "";
    const pos = el ? el.selectionStart : body.length;
    const atEnd = !el || pos >= body.length;
    const next = atEnd ? `${body}${prefix}${text}` : body.slice(0, pos) + text + body.slice(pos);
    update(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = atEnd ? next.length : pos + text.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const remove = async () => {
    if (!(await confirm({ title: "Delete note?", message: "This note will be permanently deleted.", confirmLabel: "Delete", danger: true }))) return;
    update("");
  };

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <TextArea
        ref={ref}
        rows={rows}
        autoFocus={autoFocus}
        value={body}
        placeholder={placeholder ?? "Write a note… (English or বাংলা)"}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div className="flex items-center gap-1">
        {snippets &&
          SNIPPETS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => insert(s.text)}
              className="rounded border border-line px-1.5 py-px text-[11px] text-muted hover:bg-hover hover:text-ink"
            >
              + {s.label}
            </button>
          ))}
        <div className="flex-1" />
        <SaveIndicator status={status} error={error} />
        {body.trim() && <IconButton icon={Trash2} label="Delete note" tone="danger" size={13} className="h-6 w-6" onClick={() => void remove()} />}
      </div>
    </div>
  );
}
