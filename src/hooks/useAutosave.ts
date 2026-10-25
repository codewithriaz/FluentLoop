import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Debounced autosave. Call `change(value)` on every edit; `save` runs after `delay` ms of quiet,
 * and any pending value is flushed on unmount so edits are never lost when navigating away.
 */
export function useAutosave<T>(save: (value: T) => Promise<void>, delay = 700) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  useLayoutEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setStatus("saving");
    try {
      await saveRef.current(p.value);
      setError(null);
      setStatus(pending.current ? "dirty" : "saved");
    } catch (e) {
      setError(typeof e === "string" ? e : e instanceof Error ? e.message : "Save failed");
      setStatus("error");
    }
  }, []);

  const change = useCallback(
    (value: T) => {
      pending.current = { value };
      setStatus("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  useEffect(() => () => void flush(), [flush]);

  return { status, error, change, flush };
}
