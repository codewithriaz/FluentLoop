import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Mic, Pause, Play, Square, Trash2, ArrowLeftRight, AudioLines } from "lucide-react";
import { useApp } from "../AppContext";
import { api, errorMessage } from "../lib/api";
import { formatTime, relativeDate } from "../lib/format";
import type { Recording } from "../lib/types";
import { diffWords } from "../lib/wordDiff";
import { useRecorder } from "../hooks/useRecorder";
import { useFeedback } from "./feedback";
import { Button, IconButton, Spinner, cx } from "./ui";

interface Props {
  sentenceId?: string | null;
  savedId?: string | null;
  /** Plays the original audio of the sentence; resolves when it has finished. */
  playOriginal?: () => Promise<void>;
  onRecorded?: (r: Recording) => void;
  compact?: boolean;
  /** The sentence being practiced; what Whisper heard is compared against it word by word. */
  expectedText?: string;
}

/** What speech-to-text heard, aligned with the original sentence. */
function HeardComparison({ heard, expected }: { heard: string; expected?: string }) {
  if (!heard.trim()) return <div className="text-[12px] italic text-faint">No speech was detected in this recording.</div>;
  if (!expected) return <div className="selectable text-[13px]">“{heard}”</div>;
  const d = diffWords(expected, heard);
  return (
    <div className="flex flex-col gap-1">
      <div className="selectable text-[13px] leading-relaxed">
        {d.tokens.map((t, i) => (
          <span
            key={i}
            className={cx(
              "mr-1",
              t.status === "match" && "text-success",
              t.status === "missing" && "text-danger line-through decoration-danger/60",
              t.status === "extra" && "rounded bg-warn-soft px-0.5 italic text-warn",
            )}
            title={t.status === "missing" ? "Not heard" : t.status === "extra" ? "Heard, but not in the original" : undefined}
          >
            {t.word}
          </span>
        ))}
      </div>
      <div className="text-[11px] text-faint">
        Words matched {d.matched}/{d.expected} · <span className="text-danger">red</span> = not heard, <span className="text-warn">amber</span> = extra. This compares
        the speech-to-text result with the sentence — it is not a pronunciation score.
      </div>
    </div>
  );
}

/** Record your own voice for a sentence, play it back and compare with the original. Stored locally. */
export function RecordingBar({ sentenceId = null, savedId = null, playOriginal, onRecorded, compact, expectedText }: Props) {
  const { toast, confirm } = useFeedback();
  const { info } = useApp();
  const whisperReady = !!info?.tools.whisper && !!info.tools.whisperModel;
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const { recording, elapsed, error, start, stop } = useRecorder();
  const [items, setItems] = useState<Recording[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(() => {
    if (!sentenceId && !savedId) return;
    api.listRecordings(sentenceId, savedId).then(setItems).catch(() => setItems([]));
  }, [sentenceId, savedId]);

  useEffect(load, [load]);
  useEffect(() => () => audio.current?.pause(), []);

  const play = (r: Recording) =>
    new Promise<void>((resolve) => {
      audio.current?.pause();
      if (playingId === r.id) {
        setPlayingId(null);
        resolve();
        return;
      }
      const a = new Audio(convertFileSrc(r.filePath));
      audio.current = a;
      setPlayingId(r.id);
      const done = () => {
        setPlayingId((id) => (id === r.id ? null : id));
        resolve();
      };
      a.onended = done;
      a.onerror = () => {
        toast("This recording could not be played (file missing?)", "error");
        done();
      };
      void a.play().catch(done);
    });

  const transcribe = async (r: Recording) => {
    setTranscribing(r.id);
    try {
      const updated = await api.transcribeRecording(r.id);
      setItems((xs) => xs.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      toast(`Speech-to-text failed: ${errorMessage(e)}`, "error");
    } finally {
      setTranscribing((id) => (id === r.id ? null : id));
    }
  };

  const toggleRecord = async () => {
    if (!recording) {
      await start();
      return;
    }
    const audioData = await stop();
    if (!audioData) return;
    try {
      const r = await api.saveRecording(audioData.bytes, { sentenceId, savedId, mime: audioData.mime, durationSec: audioData.durationSec });
      setItems((xs) => [r, ...xs]);
      onRecorded?.(r);
      if (whisperReady) void transcribe(r);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const compare = async (r: Recording) => {
    if (!playOriginal) return;
    await playOriginal();
    await play(r);
  };

  const remove = async (r: Recording) => {
    if (!(await confirm({ title: "Delete recording?", message: "The audio file will be deleted from your Mac.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteRecording(r.id);
      setItems((xs) => xs.filter((x) => x.id !== r.id));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const latest = items[0];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant={recording ? "danger" : "secondary"}
          icon={recording ? Square : Mic}
          onClick={() => void toggleRecord()}
          title="Record your voice (stays on this Mac)"
        >
          {recording ? `Stop ${formatTime(elapsed)}` : latest ? "Record again" : "Record"}
        </Button>
        {latest && !recording && (
          <>
            <Button size="sm" icon={playingId === latest.id ? Pause : Play} onClick={() => void play(latest)}>
              My recording
            </Button>
            {playOriginal && (
              <Button size="sm" icon={ArrowLeftRight} variant="ghost" onClick={() => void compare(latest)} title="Play the original, then your recording">
                Compare
              </Button>
            )}
            <IconButton icon={Trash2} label="Delete latest recording" tone="danger" size={13} onClick={() => void remove(latest)} />
          </>
        )}
        {recording && <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />}
      </div>
      {error && <div className="text-[11.5px] text-danger">{error}</div>}
      {latest && !recording && (
        <div className="rounded-md bg-sunken px-2.5 py-1.5">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
            <AudioLines size={11} /> What I said
          </div>
          {transcribing === latest.id ? (
            <div className="flex items-center gap-1.5 text-[12px] text-muted">
              <Spinner size={12} /> Listening to your recording…
            </div>
          ) : latest.transcript != null ? (
            <HeardComparison heard={latest.transcript} expected={expectedText} />
          ) : whisperReady ? (
            <Button size="sm" variant="ghost" icon={AudioLines} onClick={() => void transcribe(latest)}>
              Convert my voice to text
            </Button>
          ) : (
            <div className="text-[11.5px] text-faint">Install Whisper (Settings → Media tools) to see your speech as text.</div>
          )}
        </div>
      )}
      {!compact && items.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {items.slice(1, 6).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => void play(r)}
              className={cx("rounded border border-line px-1.5 py-px text-[11px]", playingId === r.id ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-hover")}
              title={new Date(r.createdAt).toLocaleString()}
            >
              ▶ {relativeDate(r.createdAt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
