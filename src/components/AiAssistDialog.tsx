import { useEffect, useState } from "react";
import { Copy, Save, Sparkles } from "lucide-react";
import { useApp } from "../AppContext";
import { api, errorMessage } from "../lib/api";
import { AI_SYSTEM, AI_TASKS, buildPrompt } from "../lib/aiPrompts";
import type { AiTask } from "../lib/aiPrompts";
import type { AiConfig } from "../lib/types";
import { useFeedback } from "./feedback";
import { Button, ErrorBox, Modal, Select, Spinner, TextArea, TextInput } from "./ui";

interface Props {
  text: string;
  sourceLabel?: string;
  sourceType?: string;
  sourceId?: string;
  defaultTask?: AiTask;
  onClose: () => void;
  /** Offered for translation results, e.g. to store as a sentence meaning. */
  onUseResult?: { label: string; apply: (text: string) => Promise<void> | void };
}

/** Optional AI helper. Shows exactly what will be sent and where, and only sends on an explicit click. */
export function AiAssistDialog({ text, sourceLabel, sourceType, sourceId, defaultTask = "bengali", onClose, onUseResult }: Props) {
  const { navigate } = useApp();
  const { toast } = useFeedback();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [task, setTask] = useState<AiTask>(defaultTask);
  const [input, setInput] = useState(text);
  const [extra, setExtra] = useState("");
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAiConfig().then(setCfg).catch((e) => setError(errorMessage(e)));
  }, []);

  const ready = !!cfg?.hasKey && !!cfg.model;
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await api.aiComplete(AI_SYSTEM, buildPrompt(task, input, extra)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const saveTemplate = async () => {
    const t = AI_TASKS.find((x) => x.id === task);
    try {
      await api.createTemplate({
        title: `${t?.label ?? "AI"}: ${input.slice(0, 50)}${input.length > 50 ? "…" : ""}`,
        content: result,
        category: t?.category ?? "General",
        sourceType: sourceType ?? null,
        sourceId: sourceId ?? null,
        sourceLabel: sourceLabel ?? null,
      });
      toast("Saved to Templates");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <Modal
      title={
        <span className="flex items-center gap-1.5">
          <Sparkles size={15} className="text-accent" /> AI assistant
        </span>
      }
      onClose={onClose}
      width={640}
      footer={
        result ? (
          <>
            <Button icon={Copy} onClick={() => void navigator.clipboard.writeText(result).then(() => toast("Copied"))}>
              Copy
            </Button>
            {onUseResult && (
              <Button
                onClick={async () => {
                  await onUseResult.apply(result);
                  onClose();
                }}
              >
                {onUseResult.label}
              </Button>
            )}
            <Button icon={Save} variant="primary" onClick={() => void saveTemplate()}>
              Save as template
            </Button>
          </>
        ) : undefined
      }
    >
      {!cfg ? (
        <Spinner />
      ) : !ready ? (
        <div className="flex flex-col items-start gap-3 text-[13px]">
          <div>AI features are optional and off until you add a provider, model and API key. Everything else in FluentLoop works without AI.</div>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              navigate({ screen: "settings" });
            }}
          >
            Open Settings → AI
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Select value={task} onChange={(e) => setTask(e.target.value as AiTask)} className="flex-1">
              {AI_TASKS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
            <Button icon={Sparkles} variant="primary" onClick={() => void run()} loading={running} disabled={!input.trim()}>
              Generate
            </Button>
          </div>
          <TextArea rows={4} value={input} onChange={(e) => setInput(e.target.value)} />
          <TextInput placeholder="Optional extra instruction (e.g. “for a software client”)" value={extra} onChange={(e) => setExtra(e.target.value)} />
          <div className="rounded-md bg-warn-soft px-2.5 py-1.5 text-[11.5px] text-warn">
            When you click Generate, the text above is sent to {cfg.provider === "anthropic" ? "Anthropic" : "your AI provider"} ({cfg.endpoint}, model {cfg.model}).
            Notes and other library data are not sent.
          </div>
          {error && <ErrorBox>{error}</ErrorBox>}
          {running && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <Spinner size={14} /> Waiting for the AI response…
            </div>
          )}
          {result && <TextArea rows={10} value={result} onChange={(e) => setResult(e.target.value)} />}
        </div>
      )}
    </Modal>
  );
}
