import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { Button, Modal, cx } from "./ui";

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

interface FeedbackApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  toast: (text: string, kind?: Toast["kind"]) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("FeedbackProvider missing");
  return ctx;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), []);
  const toast = useCallback((text: string, kind: Toast["kind"] = "success") => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3200);
  }, []);

  const close = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <FeedbackContext.Provider value={{ confirm, toast }}>
      {children}
      {pending && (
        <Modal
          title={pending.title}
          onClose={() => close(false)}
          width={420}
          footer={
            <>
              <Button onClick={() => close(false)}>Cancel</Button>
              <Button variant={pending.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
                {pending.confirmLabel ?? "Confirm"}
              </Button>
            </>
          }
        >
          <div className="text-[13px] leading-relaxed text-ink">{pending.message}</div>
        </Modal>
      )}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
        {toasts.map((t) => {
          const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? AlertCircle : Info;
          return (
            <div
              key={t.id}
              className={cx(
                "pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border bg-panel px-3 py-2 text-[13px] shadow-lg selectable",
                t.kind === "error" ? "border-danger/40" : "border-line",
              )}
            >
              <Icon size={16} className={cx("mt-px shrink-0", t.kind === "success" ? "text-success" : t.kind === "error" ? "text-danger" : "text-accent")} />
              <span className="whitespace-pre-wrap">{t.text}</span>
            </div>
          );
        })}
      </div>
    </FeedbackContext.Provider>
  );
}
