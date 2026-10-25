import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, ExternalLink, Keyboard, Paperclip, Star, StickyNote } from "lucide-react";
import { useApp } from "../../AppContext";
import { AiAssistDialog } from "../../components/AiAssistDialog";
import { useFeedback } from "../../components/feedback";
import { ShellMenuButton, useShell } from "../../components/Shell";
import { NoteEditor } from "../../components/NoteEditor";
import { SessionHistory } from "../../components/SessionHistory";
import { Badge, Button, ErrorBox, IconButton, Kbd, Modal, Segmented, Spinner, TextArea, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { formatTime, platformLabel, safeFileName, transcriptWithTimestamps } from "../../lib/format";
import type { PlayerApi } from "../../lib/player";
import type { Sentence, TranscriptData, Video } from "../../lib/types";
import { MEDIA_EXTENSIONS } from "../LibraryScreen";
import { ImportTranscriptDialog, ImportTranslationsDialog } from "./ImportTranscriptDialog";
import { MediaPlayer } from "./MediaPlayer";
import { PlayerControls } from "./PlayerControls";
import type { Loop } from "./PlayerControls";
import { PracticePanel } from "./PracticePanel";
import { TranscriptPanel } from "./TranscriptPanel";
import type { Display, SentenceActions } from "./TranscriptPanel";

type Tab = "transcript" | "practice" | "history";

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Previous / next sentence"],
  ["⇧← / ⇧→", "Back / forward 5 seconds"],
  ["R", "Replay current sentence"],
  ["L", "Loop current sentence"],
  ["N", "Note for current sentence"],
  ["S", "Save current sentence"],
  ["P", "Mark current sentence practiced"],
  ["[ / ]", "Slower / faster"],
  ["⌘F", "Search transcript"],
  ["?", "Show shortcuts"],
];

const ACTION_KEYS: (keyof SentenceActions)[] = [
  "seek", "play", "toggleNote", "toggleSave", "copy", "setState", "setSpeaker", "saveText", "saveTranslation", "split", "merge",
  "move", "insertAfter", "setTime", "alternateFrom", "ai", "remove", "noteSaved",
];

function sentenceEnd(list: Sentence[], i: number): number | null {
  const s = list[i];
  if (s.startSec == null) return null;
  if (s.endSec != null && s.endSec > s.startSec) return s.endSec;
  const next = list.slice(i + 1).find((x) => x.startSec != null);
  return next?.startSec ?? s.startSec + 5;
}

export function WorkspaceScreen({ videoId, seekTo, focusSentenceId }: { videoId: string; seekTo?: number; focusSentenceId?: string }) {
  const { navigate, dataVersion, downloads, startDownload, settings, updateSetting, info } = useApp();
  const { toast, confirm } = useFeedback();
  const { mobile } = useShell();

  const [video, setVideo] = useState<Video | null>(null);
  const [data, setData] = useState<TranscriptData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [player, setPlayer] = useState<PlayerApi | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [loop, setLoop] = useState<Loop>(null);
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [subtitles, setSubtitles] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(focusSentenceId ?? null);
  const [follow, setFollow] = useState(true);
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("transcript");
  const [aiFor, setAiFor] = useState<Sentence | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [inserting, setInserting] = useState<{ afterId: string | null; text: string } | null>(null);
  const [videoNoteOpen, setVideoNoteOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  const display = (settings.transcriptDisplay as Display | undefined) ?? "en";
  const setDisplay = (d: Display) => updateSetting("transcriptDisplay", d);
  const sentences = useMemo(() => data?.sentences ?? [], [data]);
  const searchRef = useRef<HTMLInputElement>(null);

  // ---------- loading ----------
  const reloadTranscript = useCallback(async () => {
    try {
      setData(await api.getTranscript(videoId));
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [videoId]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.getVideo(videoId), api.getTranscript(videoId)])
      .then(([v, d]) => {
        if (!alive) return;
        setVideo(v);
        setData(d);
      })
      .catch((e) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [videoId, dataVersion]);

  const patch = useCallback((id: string, p: Partial<Sentence>) => {
    setData((d) => (d ? { ...d, sentences: d.sentences.map((s) => (s.id === id ? { ...s, ...p } : s)) } : d));
  }, []);

  // ---------- player polling, loops, segment playback ----------
  const sentencesRef = useRef(sentences);
  const loopRef = useRef(loop);
  const stopAt = useRef<number | null>(null);
  const segmentDone = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    sentencesRef.current = sentences;
    loopRef.current = loop;
  });

  useEffect(() => {
    if (!player) return;
    player.setRate(rate);
    player.setVolume(volume);
  }, [player, rate, volume]);

  useEffect(() => {
    if (!player) return;
    const id = setInterval(() => {
      const t = player.getTime();
      setTime(t);
      setPlaying(player.isPlaying());
      setDuration(player.getDuration());
      if (stopAt.current != null && t >= stopAt.current) {
        stopAt.current = null;
        player.pause();
        segmentDone.current?.();
        segmentDone.current = null;
      }
      const l = loopRef.current;
      if (l?.kind === "sentence") {
        const list = sentencesRef.current;
        const i = list.findIndex((s) => s.id === l.id);
        const start = i >= 0 ? list[i].startSec : null;
        const end = i >= 0 ? sentenceEnd(list, i) : null;
        if (start != null && end != null && (t >= end - 0.05 || t < start - 0.75)) player.seek(start);
      } else if (l?.kind === "range" && (t >= l.b || t < l.a - 0.75)) {
        player.seek(l.a);
      }
    }, 100);
    return () => clearInterval(id);
  }, [player]);

  // First seek once the player is ready (deep links from Notes / Vault).
  const didInitialSeek = useRef(false);
  useEffect(() => {
    if (!player || didInitialSeek.current) return;
    didInitialSeek.current = true;
    const target = focusSentenceId ? sentences.find((s) => s.id === focusSentenceId)?.startSec : seekTo;
    if (target != null) player.seek(target);
  }, [player, seekTo, focusSentenceId, sentences]);

  const activeIndex = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < sentences.length; i++) {
      const st = sentences[i].startSec;
      if (st != null && st <= time + 0.05) idx = i;
    }
    return idx;
  }, [sentences, time]);
  const activeId = activeIndex >= 0 && (playing || time > 0) ? sentences[activeIndex].id : null;
  const currentId = (follow && playing ? activeId : null) ?? selectedId ?? activeId;
  const currentIndex = sentences.findIndex((s) => s.id === currentId);
  const current = currentIndex >= 0 ? sentences[currentIndex] : null;

  const playSegment = useCallback(
    (s: Sentence) =>
      new Promise<void>((resolve) => {
        const list = sentencesRef.current;
        const i = list.findIndex((x) => x.id === s.id);
        if (!player || s.startSec == null || i < 0) {
          resolve();
          return;
        }
        segmentDone.current?.();
        const end = sentenceEnd(list, i);
        player.seek(s.startSec);
        stopAt.current = loopRef.current ? null : end;
        segmentDone.current = resolve;
        player.play();
        const ms = end != null ? ((end - s.startSec) / rate) * 1000 + 2500 : 10000;
        setTimeout(() => {
          if (segmentDone.current === resolve) {
            segmentDone.current = null;
            resolve();
          }
        }, ms);
      }),
    [player, rate],
  );

  const gotoSentence = useCallback(
    (i: number) => {
      const s = sentences[Math.max(0, Math.min(sentences.length - 1, i))];
      if (!s) return;
      setSelectedId(s.id);
      if (s.startSec != null && player) player.seek(s.startSec);
      if (loop?.kind === "sentence") setLoop({ kind: "sentence", id: s.id });
    },
    [sentences, player, loop],
  );

  // ---------- sentence actions (stable object, latest implementation via ref) ----------
  const toggleSave = async (s: Sentence) => {
    try {
      if (s.savedId) {
        await api.unsaveSentence(s.id);
        patch(s.id, { savedId: null });
        toast("Removed from Saved Sentences");
      } else {
        const r = await api.saveSentence({ text: s.text, meaning: s.translation, speaker: s.speaker, videoId, sentenceId: s.id, startSec: s.startSec });
        patch(s.id, { savedId: r.saved.id });
        toast(r.created ? "Saved to Saved Sentences" : "Already saved — this location was linked to it");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const impl: SentenceActions = {
    seek: (s) => {
      setSelectedId(s.id);
      if (s.startSec != null && player) player.seek(s.startSec);
      if (loop?.kind === "sentence") setLoop({ kind: "sentence", id: s.id });
    },
    play: (s) => {
      setSelectedId(s.id);
      void playSegment(s);
    },
    toggleNote: (id) => {
      setSelectedId(id);
      setOpenNotes((o) => {
        const n = new Set(o);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    },
    toggleSave: (s) => void toggleSave(s),
    copy: (text) => void copyText(text).then(() => toast("Copied")),
    setState: (s, st) =>
      void api
        .setPracticeState(s.id, st)
        .then((n) => patch(s.id, n))
        .catch((e) => toast(errorMessage(e), "error")),
    setSpeaker: (s, sp) =>
      void api
        .updateSentence(s.id, { speaker: sp })
        .then((n) => patch(s.id, n))
        .catch((e) => toast(errorMessage(e), "error")),
    saveText: async (s, text) => {
      try {
        patch(s.id, await api.updateSentence(s.id, { text }));
        return true;
      } catch (e) {
        toast(errorMessage(e), "error");
        return false;
      }
    },
    saveTranslation: async (s, text) => {
      try {
        patch(s.id, await api.updateSentence(s.id, { translation: text }));
        return true;
      } catch (e) {
        toast(errorMessage(e), "error");
        return false;
      }
    },
    split: (s, at) =>
      void api
        .splitSentence(s.id, at)
        .then(reloadTranscript)
        .catch((e) => toast(errorMessage(e), "error")),
    merge: (s) =>
      void api
        .mergeSentenceWithNext(s.id)
        .then(reloadTranscript)
        .catch((e) => toast(errorMessage(e), "error")),
    move: (s, dir) =>
      void api
        .moveSentence(s.id, dir)
        .then(reloadTranscript)
        .catch((e) => toast(errorMessage(e), "error")),
    insertAfter: (s) => setInserting({ afterId: s.id, text: "" }),
    setTime: (s, which) => {
      if (!player) {
        toast("Play the media first to capture the current time", "info");
        return;
      }
      const t = Math.round(player.getTime() * 100) / 100;
      void api
        .updateSentence(s.id, which === "start" ? { startSec: t } : { endSec: t })
        .then((n) => patch(s.id, n))
        .catch((e) => toast(errorMessage(e), "error"));
    },
    alternateFrom: (s) =>
      void api
        .alternateSpeakers(videoId, s.id, s.speaker === "B" ? "B" : "A")
        .then(setData)
        .catch((e) => toast(errorMessage(e), "error")),
    ai: (s) => setAiFor(s),
    remove: (s) =>
      void (async () => {
        const hasData = s.note || s.recordingCount > 0;
        if (
          !(await confirm({
            title: "Delete sentence?",
            message: hasData ? "This sentence has a note and/or recordings, which will be deleted too." : "The sentence will be removed from the transcript.",
            confirmLabel: "Delete",
            danger: true,
          }))
        )
          return;
        try {
          await api.deleteSentence(s.id);
          await reloadTranscript();
        } catch (e) {
          toast(errorMessage(e), "error");
        }
      })(),
    noteSaved: (id, body) => patch(id, { note: body.trim() ? body : null }),
  };
  const implRef = useRef(impl);
  useLayoutEffect(() => {
    implRef.current = impl;
  });
  // Stable identity (so memoized rows don't re-render) that always calls the latest implementation.
  const actions = useMemo(
    () =>
      Object.fromEntries(
        ACTION_KEYS.map((k) => [k, (...args: unknown[]) => (implRef.current[k] as (...a: unknown[]) => unknown)(...args)]),
      ) as unknown as SentenceActions,
    [],
  );

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setTab("transcript");
        requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      const a = implRef.current;
      const cur = current;
      switch (e.key) {
        case " ":
          if (player?.isPlaying()) player.pause();
          else player?.play();
          break;
        case "ArrowLeft":
          if (e.shiftKey && player) player.seek(player.getTime() - 5);
          else gotoSentence((currentIndex < 0 ? activeIndex : currentIndex) - 1);
          break;
        case "ArrowRight":
          if (e.shiftKey && player) player.seek(player.getTime() + 5);
          else gotoSentence((currentIndex < 0 ? activeIndex : currentIndex) + 1);
          break;
        case "r":
        case "R":
          if (cur) a.play(cur);
          break;
        case "l":
        case "L":
          if (cur) setLoop((l) => (l?.kind === "sentence" ? null : { kind: "sentence", id: cur.id }));
          break;
        case "n":
        case "N":
          if (cur) a.toggleNote(cur.id);
          break;
        case "s":
        case "S":
          if (cur) a.toggleSave(cur);
          break;
        case "p":
        case "P":
          if (cur) a.setState(cur, "practiced");
          break;
        case "[":
          setRate((r) => Math.max(0.5, Math.round((r - 0.1) * 100) / 100));
          break;
        case "]":
          setRate((r) => Math.min(2, Math.round((r + 0.1) * 100) / 100));
          break;
        case "?":
          setShortcutsOpen(true);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, current, currentIndex, activeIndex, gotoSentence]);

  // ---------- misc actions ----------
  const doExport = async (format: "txt" | "srt" | "vtt" | "md") => {
    if (!video) return;
    const path = await save({ defaultPath: `${safeFileName(video.title)}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (!path) return;
    try {
      await api.exportTranscript(video.id, path, format);
      toast("Transcript exported");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const attachFile = async () => {
    const picked = await open({ multiple: false, filters: [{ name: "Video or audio", extensions: MEDIA_EXTENSIONS }] });
    if (typeof picked !== "string") return;
    try {
      setVideo(await api.attachMediaFile(videoId, picked));
      toast("File attached");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const download = async () => {
    await startDownload(videoId);
    setVideo(await api.getVideo(videoId));
  };

  const onRangeMark = () => {
    if (!player) return;
    const t = player.getTime();
    if (loop?.kind === "range") {
      setLoop(null);
      setRangeStart(null);
    } else if (rangeStart == null) {
      setRangeStart(t);
    } else if (t > rangeStart + 0.3) {
      setLoop({ kind: "range", a: rangeStart, b: t });
      setRangeStart(null);
      player.seek(rangeStart);
    } else {
      toast("Set B after A (play forward a little first)", "info");
    }
  };

  const submitInsert = async () => {
    if (!inserting?.text.trim()) return;
    try {
      const s = await api.insertSentence(videoId, inserting.afterId, inserting.text);
      setInserting(null);
      await reloadTranscript();
      setSelectedId(s.id);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  if (loadError)
    return (
      <div className="p-6">
        <ErrorBox>{loadError}</ErrorBox>
        <Button className="mt-3" icon={ArrowLeft} onClick={() => navigate({ screen: "library", folderId: null })}>
          Back to library
        </Button>
      </div>
    );
  if (!video || !data)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );

  const dl = downloads[video.id];
  const downloading = !!dl || video.mediaStatus === "downloading";
  const canDownload = !!video.sourceUrl && !!info?.tools.ytDlp && !downloading;
  const hasLocal = video.mediaStatus === "ready" && !video.mediaMissing;
  const subtitleText = subtitles && activeId ? (sentences.find((s) => s.id === activeId)?.[display === "bn" ? "translation" : "text"] ?? null) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header data-tauri-drag-region className={cx("flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-bg px-4 pb-2.5 pt-3 md:px-5", mobile && "pt-9")}>
        <ShellMenuButton />
        <IconButton icon={ArrowLeft} label="Back to library" onClick={() => navigate({ screen: "library", folderId: video.folderId })} />
        <div data-tauri-drag-region className="min-w-0 flex-1 basis-[180px]">
          <div className="truncate text-[15px] font-semibold">{video.title}</div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <span>{platformLabel(video.platform)}</span>
            {video.channel && <span className="truncate">· {video.channel}</span>}
            {video.durationSec != null && <span>· {formatTime(video.durationSec)}</span>}
            {hasLocal && <Badge tone="success">Offline</Badge>}
            {downloading && (
              <Badge tone="accent">
                <Spinner size={10} className="text-accent-text" /> {dl?.percent != null ? `${Math.round(dl.percent)}%` : "Downloading"}
              </Badge>
            )}
          </div>
        </div>
        {canDownload && !hasLocal && (
          <Button size="sm" icon={Download} onClick={() => void download()}>
            Download
          </Button>
        )}
        <Button size="sm" icon={Paperclip} variant="ghost" onClick={() => void attachFile()} title="Attach your own video or audio file">
          Attach file
        </Button>
        {video.sourceUrl && <IconButton icon={ExternalLink} label="Open original link" onClick={() => void openUrl(video.sourceUrl ?? "")} />}
        <IconButton icon={StickyNote} label="Video notes" active={videoNoteOpen} onClick={() => setVideoNoteOpen((v) => !v)} />
        <IconButton icon={Keyboard} label="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden md:flex-row md:overflow-hidden">
        {/* Left: player + current sentence + notes */}
        <section className="flex min-w-0 flex-col border-line md:flex-[1.15] md:overflow-y-auto md:border-r">
          <MediaPlayer
            video={video}
            onApi={setPlayer}
            subtitle={subtitleText}
            downloading={downloading}
            canDownload={canDownload}
            onDownload={() => void download()}
            onAttach={() => void attachFile()}
          />
          <PlayerControls
            enabled={!!player}
            playing={playing}
            time={time}
            duration={duration || video.durationSec || 0}
            rate={rate}
            volume={volume}
            loop={loop}
            rangeStart={rangeStart}
            subtitles={subtitles}
            hasSentences={sentences.some((s) => s.startSec != null)}
            onToggle={() => player && (player.isPlaying() ? player.pause() : player.play())}
            onSeek={(t) => player?.seek(t)}
            onPrev={() => gotoSentence((currentIndex < 0 ? activeIndex : currentIndex) - 1)}
            onNext={() => gotoSentence((currentIndex < 0 ? activeIndex : currentIndex) + 1)}
            onReplay={() => current && void playSegment(current)}
            onLoopSentence={() => current && setLoop((l) => (l?.kind === "sentence" ? null : { kind: "sentence", id: current.id }))}
            onRangeMark={onRangeMark}
            onRate={setRate}
            onVolume={setVolume}
            onSubtitles={() => setSubtitles((v) => !v)}
          />

          {videoNoteOpen && (
            <div className="border-b border-line bg-panel px-4 py-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Video notes</div>
              <NoteEditor entityType="video" entityId={video.id} placeholder="Overall notes for this video…" rows={4} snippets />
            </div>
          )}

          <div className="flex flex-col gap-3 p-4">
            {current ? (
              <div className="rounded-xl border border-line bg-panel">
                <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
                  <Segmented<Display>
                    size="sm"
                    value={display}
                    onChange={setDisplay}
                    options={[
                      { value: "en", label: "EN" },
                      { value: "bn", label: "বাংলা" },
                      { value: "both", label: "EN+বাংলা" },
                    ]}
                  />
                  {current.speaker !== "U" && <Badge tone={current.speaker === "A" ? "a" : "b"}>Person {current.speaker}</Badge>}
                  <span className="text-[11px] text-faint">
                    {currentIndex + 1} / {sentences.length}
                    {current.startSec != null && ` · ${formatTime(current.startSec)}`}
                  </span>
                  <div className="flex-1" />
                  <IconButton icon={ChevronLeft} label="Previous sentence" onClick={() => gotoSentence(currentIndex - 1)} disabled={currentIndex <= 0} />
                  <IconButton icon={ChevronRight} label="Next sentence" onClick={() => gotoSentence(currentIndex + 1)} disabled={currentIndex >= sentences.length - 1} />
                  <IconButton icon={Star} label={current.savedId ? "Saved" : "Save sentence"} active={!!current.savedId} onClick={() => actions.toggleSave(current)} />
                  <IconButton
                    icon={Check}
                    label="Mark practiced"
                    tone={current.practiceState === "practiced" ? "success" : "default"}
                    onClick={() => actions.setState(current, current.practiceState === "practiced" ? "new" : "practiced")}
                  />
                </div>
                <div className="selectable px-5 py-5 text-center">
                  {display !== "bn" && <div className="text-[20px] font-medium leading-snug">{current.text}</div>}
                  {display !== "en" && (
                    <div className={cx(display === "bn" ? "text-[20px] font-medium" : "mt-2 text-[15px] text-muted", !current.translation && "italic text-faint")}>
                      {current.translation ?? "No Bengali meaning yet — double-click the sentence’s meaning line or use AI."}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
                {sentences.length ? "Play the video or click a sentence to focus it here." : "Import a transcript to see sentences here."}
              </div>
            )}

            {current && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Sentence note</span>
                  <span className="text-[11px] text-faint">Vocabulary, grammar, examples, বাংলা</span>
                </div>
                <NoteEditor
                  key={current.id}
                  entityType="sentence"
                  entityId={current.id}
                  initial={current.note}
                  rows={4}
                  snippets
                  onSaved={(b) => patch(current.id, { note: b.trim() ? b : null })}
                />
              </div>
            )}
          </div>
        </section>

        {/* Right: transcript / practice / history */}
        <section className="flex min-h-[520px] flex-1 flex-col border-t border-line bg-panel md:min-h-0 md:min-w-[380px] md:border-t-0">
          <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 pt-2">
            {(
              [
                ["transcript", "Transcript"],
                ["practice", "Practice A/B"],
                ["history", "History"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  if (id === "history") setHistoryKey((k) => k + 1);
                }}
                className={cx("-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium", tab === id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "transcript" && (
            <TranscriptPanel
              sentences={sentences}
              activeId={activeId}
              selectedId={selectedId}
              openNotes={openNotes}
              display={display}
              onDisplay={setDisplay}
              follow={follow}
              onFollow={setFollow}
              actions={actions}
              searchRef={searchRef}
              onImport={() => setImportOpen(true)}
              onTranslations={() => setTranslationsOpen(true)}
              onExport={(f) => void doExport(f)}
              onCopyAll={() => void copyText(sentences.map((s) => s.text).join("\n")).then(() => toast("Transcript copied"))}
              onCopyTimed={(layout) => void copyText(transcriptWithTimestamps(sentences, layout)).then(() => toast("Transcript copied with timestamps"))}
              onAddFirst={() => setInserting({ afterId: null, text: "" })}
              transcriptSource={data.transcript?.source ?? null}
            />
          )}
          {tab === "practice" && (
            <PracticePanel
              videoId={video.id}
              sentences={sentences}
              active={tab === "practice"}
              canPlay={!!player}
              playSegment={playSegment}
              onPatch={patch}
              onToggleSave={(s) => void toggleSave(s)}
              onAlternate={() =>
                void api
                  .alternateSpeakers(videoId, null, "A")
                  .then(setData)
                  .catch((e) => toast(errorMessage(e), "error"))
              }
            />
          )}
          {tab === "history" && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SessionHistory videoId={video.id} refreshKey={historyKey} />
            </div>
          )}
        </section>
      </div>

      {importOpen && <ImportTranscriptDialog video={video} hasExisting={sentences.length > 0} onClose={() => setImportOpen(false)} onImported={setData} />}
      {translationsOpen && <ImportTranslationsDialog video={video} count={sentences.length} onClose={() => setTranslationsOpen(false)} onDone={setData} />}
      {aiFor && (
        <AiAssistDialog
          text={aiFor.text}
          sourceLabel={`${video.title} @ ${formatTime(aiFor.startSec)}`}
          sourceType="sentence"
          sourceId={aiFor.id}
          onClose={() => setAiFor(null)}
          onUseResult={{
            label: "Use as Bengali meaning",
            apply: async (text) => {
              const s = aiFor;
              patch(s.id, await api.updateSentence(s.id, { translation: text.trim().split("\n")[0] }));
              toast("Meaning saved");
            },
          }}
        />
      )}
      {inserting && (
        <Modal
          title="Add sentence"
          onClose={() => setInserting(null)}
          width={480}
          footer={
            <>
              <Button onClick={() => setInserting(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void submitInsert()} disabled={!inserting.text.trim()}>
                Add
              </Button>
            </>
          }
        >
          <TextArea
            autoFocus
            rows={3}
            value={inserting.text}
            onChange={(e) => setInserting({ ...inserting, text: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submitInsert();
              }
            }}
            placeholder="Type the sentence"
          />
        </Modal>
      )}
      {shortcutsOpen && (
        <Modal title="Keyboard shortcuts" onClose={() => setShortcutsOpen(false)} width={400}>
          <table className="w-full text-[13px]">
            <tbody>
              {SHORTCUTS.map(([k, d]) => (
                <tr key={k}>
                  <td className="py-1 pr-4">
                    <Kbd>{k}</Kbd>
                  </td>
                  <td className="py-1 text-muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[11.5px] text-faint">In the Practice tab: Enter reveal/practiced, ←/→ move, R replay, D difficult.</div>
        </Modal>
      )}
    </div>
  );
}
