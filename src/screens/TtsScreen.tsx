import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { AlertCircle, AudioLines, Download, Eraser, FileAudio, Pause, Play, RotateCcw, Trash2, Type } from "lucide-react";
import { useApp } from "../AppContext";
import { useFeedback } from "../components/feedback";
import { ScreenHeader } from "../components/ScreenHeader";
import { Badge, Button, EmptyState, ErrorBox, IconButton, Select, Spinner, cx } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatTime, relativeDate, safeFileName } from "../lib/format";
import type { TtsClip, TtsProgress, TtsStatus } from "../lib/types";
import { DEFAULT_VOICE, VOICE_GROUPS, voiceInfo } from "../lib/voices";

const DRAFT_KEY = "fluentloop.tts.draft";

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function VoiceDot({ voice }: { voice: string }) {
  const v = voiceInfo(voice);
  return (
    <span
      className={cx(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
        v.gender === "Female" ? (v.accent === "American" ? "bg-pink-500" : "bg-fuchsia-600") : v.accent === "American" ? "bg-sky-600" : "bg-indigo-600",
      )}
    >
      {v.name[0]}
    </span>
  );
}

/** Play / pause / seek for one generated clip. */
function ClipPlayer({ clip, autoPlay }: { clip: TtsClip; autoPlay: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(clip.durationSec ?? 0);

  useEffect(() => {
    const a = audio.current;
    if (a && autoPlay) void a.play().catch(() => undefined);
  }, [clip.id, autoPlay]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };

  return (
    <div className="flex items-center gap-2">
      <audio
        ref={audio}
        src={convertFileSrc(clip.filePath)}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
      />
      <button
        type="button"
        onClick={toggle}
        title={playing ? "Pause" : "Play"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-bg hover:opacity-85"
      >
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
      </button>
      <span className="w-10 text-right font-mono text-[11.5px] tabular-nums text-muted">{formatTime(time)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.05}
        value={Math.min(time, duration)}
        onChange={(e) => {
          if (audio.current) audio.current.currentTime = Number(e.target.value);
        }}
        className="h-1 min-w-0 flex-1"
        aria-label="Seek"
      />
      <span className="w-10 font-mono text-[11.5px] tabular-nums text-muted">{formatTime(duration)}</span>
    </div>
  );
}

export function TtsScreen() {
  const { settings, updateSetting, navigate } = useApp();
  const { toast, confirm } = useFeedback();
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [text, setText] = useState(readDraft);
  const [tab, setTab] = useState<"settings" | "history">("settings");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<TtsProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<TtsClip | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [history, setHistory] = useState<TtsClip[] | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const voice = settings.ttsVoice && voiceInfo(settings.ttsVoice) ? settings.ttsVoice : DEFAULT_VOICE;
  const speed = Number(settings.ttsSpeed ?? "1") || 1;
  const maxChars = status?.maxChars ?? 10000;
  const chars = text.length;
  const tooLong = chars > maxChars;
  const ready = !!status?.python && status.modelReady;

  const loadHistory = useCallback(() => {
    api.listTtsClips().then(setHistory).catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    api.ttsStatus().then(setStatus).catch((e) => setError(errorMessage(e)));
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const un = listen<TtsProgress>("tts-progress", (e) => setProgress(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, text);
    } catch {
      /* storage unavailable */
    }
  }, [text]);

  const generate = async () => {
    if (generating) return;
    if (!text.trim()) {
      setError("Type or paste some text first.");
      textRef.current?.focus();
      return;
    }
    if (tooLong) {
      setError(`The text is too long (${chars.toLocaleString()} characters). The limit is ${maxChars.toLocaleString()}.`);
      return;
    }
    setGenerating(true);
    setError(null);
    setProgress(null);
    try {
      const clip = await api.ttsGenerate(text, voice, speed);
      setCurrent(clip);
      setAutoPlay(true);
      setHistory((h) => [clip, ...(h ?? [])]);
      toast(`Speech ready (${formatTime(clip.durationSec)})`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  const download = async (clip: TtsClip) => {
    const name = `${safeFileName(clip.text.split("\n")[0].slice(0, 40))} - ${voiceInfo(clip.voice).name}.wav`;
    const dest = await save({ defaultPath: name, filters: [{ name: "WAV audio", extensions: ["wav"] }] });
    if (!dest) return;
    try {
      await api.exportTtsClip(clip.id, dest);
      toast("WAV saved");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const remove = async (clip: TtsClip) => {
    if (!(await confirm({ title: "Delete this audio?", message: "The generated WAV file will be deleted.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteTtsClip(clip.id);
      setHistory((h) => h?.filter((c) => c.id !== clip.id) ?? h);
      if (current?.id === clip.id) setCurrent(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const clear = () => {
    setText("");
    setError(null);
    textRef.current?.focus();
  };

  const progressLabel = !progress
    ? "Generating…"
    : progress.total === 0
      ? "Loading the voice model…"
      : `Generating ${progress.done} / ${progress.total}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title="Audio / TTS" subtitle="Text to speech with Kokoro-82M · runs locally on this Mac" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        {/* Editor */}
        <section className="flex min-h-[420px] min-w-0 flex-1 flex-col bg-panel">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex h-full max-w-3xl flex-col px-8 pt-8">
              <button
                type="button"
                onClick={() => setTab("settings")}
                className="mb-3 inline-flex items-center gap-2 self-start rounded-md border border-line px-2.5 py-1 text-[13px] hover:bg-hover"
                title="Change voice in Settings"
              >
                <VoiceDot voice={voice} />
                {voiceInfo(voice).name} — {voiceInfo(voice).accent} {voiceInfo(voice).gender.toLowerCase()}
              </button>
              <textarea
                ref={textRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void generate();
                  }
                }}
                placeholder="Start typing here or paste any text you want to turn into speech…"
                className="min-h-[260px] w-full flex-1 resize-none border-0 bg-transparent text-[15px] leading-[1.75] text-ink outline-none placeholder:text-faint"
                spellCheck
              />
            </div>
          </div>

          {/* Bottom bar */}
          <div className="shrink-0 border-t border-line">
            <div className="mx-auto flex max-w-3xl flex-col gap-3 px-8 py-3">
              {error && (
                <div className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
                  <AlertCircle size={14} className="mt-px shrink-0" />
                  <span className="selectable whitespace-pre-wrap">{error}</span>
                </div>
              )}
              {generating && (
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <Spinner size={14} />
                  <span>{progressLabel}</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
                    <div
                      className={cx("h-full rounded-full bg-accent transition-[width]", (!progress || progress.total === 0) && "w-1/4 animate-pulse")}
                      style={progress && progress.total > 0 ? { width: `${(progress.done / progress.total) * 100}%` } : undefined}
                    />
                  </div>
                </div>
              )}
              {current && !generating && (
                <div className="rounded-xl border border-line bg-bg px-3 py-2.5">
                  <ClipPlayer key={current.id} clip={current} autoPlay={autoPlay} />
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="truncate text-[11.5px] text-faint">
                      {voiceInfo(current.voice).name} · {current.speed}× · {formatTime(current.durationSec)}
                    </span>
                    <div className="flex-1" />
                    <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void generate()} disabled={!text.trim()}>
                      Generate again
                    </Button>
                    <Button size="sm" icon={Download} onClick={() => void download(current)}>
                      Download WAV
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className={cx("text-[12px] tabular-nums", tooLong ? "font-medium text-danger" : "text-faint")}>
                  {chars.toLocaleString()} / {maxChars.toLocaleString()} characters
                </span>
                <div className="flex-1" />
                <Button variant="ghost" icon={Eraser} onClick={clear} disabled={!text || generating}>
                  Clear text
                </Button>
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={generating || !ready || !text.trim() || tooLong}
                  title="Generate speech (⌘↩)"
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-4 text-[13px] font-medium text-bg hover:opacity-85 disabled:opacity-40"
                >
                  {generating ? <Spinner size={14} className="text-bg" /> : <AudioLines size={15} />}
                  {generating ? "Generating…" : "Generate speech"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Settings / History */}
        <aside className="flex w-full shrink-0 flex-col border-t border-line bg-panel md:w-[320px] md:border-l md:border-t-0">
          <div className="flex shrink-0 gap-4 border-b border-line px-5 pt-3">
            {(["settings", "history"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  if (t === "history") loadHistory();
                }}
                className={cx("-mb-px border-b-2 pb-2 text-[13px] font-medium capitalize", tab === t ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "settings" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
              {status && !ready && (
                <div className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-[12.5px] text-ink">
                  <div className="mb-1 font-semibold">Speech engine not installed</div>
                  {!status.python ? "Python environment missing." : "Kokoro model not downloaded yet."} Run once in Terminal from the project folder:
                  <code className="selectable mt-1.5 block rounded bg-panel px-2 py-1 font-mono text-[11px]">./scripts/setup-tts.sh</code>
                </div>
              )}
              <div>
                <div className="mb-2 text-[13px] font-medium">Voice</div>
                <div className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                  <VoiceDot voice={voice} />
                  <Select value={voice} onChange={(e) => updateSetting("ttsVoice", e.target.value)} className="h-7 flex-1 border-0 px-0 focus:border-0">
                    {VOICE_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-[13px]">
                  <span className="font-medium">Speed</span>
                  <span className="font-mono text-[12px] text-muted">{speed.toFixed(2)}×</span>
                </div>
                <div className="flex justify-between text-[11.5px] text-faint">
                  <span>Slower</span>
                  <span>Faster</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={speed}
                  onChange={(e) => updateSetting("ttsSpeed", e.target.value)}
                  className="mt-1 h-1 w-full"
                  aria-label="Speed"
                />
                {speed !== 1 && (
                  <button type="button" className="mt-1 text-[11.5px] text-accent-text hover:underline" onClick={() => updateSetting("ttsSpeed", "1")}>
                    Reset to 1×
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium">Language</span>
                <Badge>English ({voiceInfo(voice).accent === "British" ? "UK" : "US"})</Badge>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium">Output format</span>
                <Badge>WAV · 24 kHz · 16-bit</Badge>
              </div>
              <div className="mt-auto text-[11.5px] leading-relaxed text-faint">
                Speech is generated on this Mac with Kokoro-82M (Apache-2.0). Your text is never uploaded. Long texts are split into sentences and
                joined in order. English only.
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {history === null ? (
                <Spinner className="m-5" />
              ) : history.length === 0 ? (
                <EmptyState icon={FileAudio} title="No audio yet">
                  Generated speech appears here.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {history.map((c) => (
                    <li key={c.id} className={cx("px-4 py-2.5", current?.id === c.id && "bg-accent-soft/50")}>
                      <div className="line-clamp-2 text-[12.5px] leading-snug">{c.text}</div>
                      <div className="mt-1 flex items-center gap-1">
                        <VoiceDot voice={c.voice} />
                        <span className="truncate text-[11px] text-muted">
                          {voiceInfo(c.voice).name} · {formatTime(c.durationSec)} · {relativeDate(c.createdAt)}
                        </span>
                        <div className="flex-1" />
                        <IconButton
                          icon={Play}
                          size={13}
                          label="Play"
                          disabled={c.fileMissing}
                          onClick={() => {
                            setCurrent(c);
                            setAutoPlay(true);
                          }}
                        />
                        <IconButton
                          icon={Type}
                          size={13}
                          label="Use this text and voice"
                          onClick={() => {
                            setText(c.text);
                            updateSetting("ttsVoice", c.voice);
                            setCurrent(c);
                            setAutoPlay(false);
                          }}
                        />
                        <IconButton icon={Download} size={13} label="Download WAV" disabled={c.fileMissing} onClick={() => void download(c)} />
                        <IconButton icon={Trash2} size={13} label="Delete" tone="danger" onClick={() => void remove(c)} />
                      </div>
                      {c.fileMissing && <div className="mt-1 text-[11px] text-danger">Audio file missing</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
      {status === null && error && (
        <div className="p-4">
          <ErrorBox>{error}</ErrorBox>
          <Button className="mt-2" onClick={() => navigate({ screen: "settings" })}>
            Open Settings
          </Button>
        </div>
      )}
    </div>
  );
}
