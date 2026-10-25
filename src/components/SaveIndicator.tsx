import { Check, AlertCircle } from "lucide-react";
import type { SaveStatus } from "../hooks/useAutosave";
import { Spinner } from "./ui";

export function SaveIndicator({ status, error }: { status: SaveStatus; error?: string | null }) {
  if (status === "idle") return null;
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-danger" title={error ?? undefined}>
        <AlertCircle size={12} /> Not saved
      </span>
    );
  if (status === "saved")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-success">
        <Check size={12} /> Saved
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-faint">
      {status === "saving" ? <Spinner size={11} /> : null}
      {status === "saving" ? "Saving" : "Editing…"}
    </span>
  );
}
