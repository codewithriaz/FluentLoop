import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { AudioLines, FileUp, Subtitles } from "lucide-react";
import { useApp } from "../../AppContext";
import { useFeedback } from "../../components/feedback";
import { Badge, Button, ErrorBox, Modal, Segmented, Select, Spinner, TextArea } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatTime, speakerLabel } from "../../lib/format";
import type { Preview, TranscribeProgress, TranscriptData, Video } from "../../lib/types";

type Source = "paste" | "file" | "captions" | "transcribe";

export function ImportTranscriptDialog({
  video,
  hasExisting,
  onClose,
  onImported,
}: {
  video: Video;
  hasExisting: boolean;
  onClose: () => void;
  onImported: (d: TranscriptData) => void;
}) {
  const { toast } = useFeedback();
  const { info } = useApp();
  const captionsAvailable = !!video.sourceUrl && (video.platform === "youtube" || video.platform === "facebook");
  const whisperReady = !!info?.tools.whisper && !!info.tools.whisperModel;
  const hasLocalMedia = video.mediaStatus === "ready" && !video.mediaMissing;
  // Whisper is the natural default for media without online captions (Facebook, local files).
  const [source, setSource] = useState<Source>(whisperReady && hasLocalMedia && video.platform !== "youtube" ? "transcribe" : "paste");
  const [progress, setProgress] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [format, setFormat] = useState("auto");
  const [origin, setOrigin] = useState<string | null>(null);
  const [rawPreview, setPreview] = useState<Preview | null>(null);
  const preview = content.trim() ? rawPreview : null;
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!content.trim()) return;
    const t = setTimeout(() => {
      api
        .previewTranscript(content, format === "auto" ? null : format)
        .then(setPreview)
        .catch((e) => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [content, format]);

  const pickFile = async () => {
    const p = await open({ multiple: false, filters: [{ name: "Transcript", extensions: ["txt", "srt", "vtt"] }] });
    if (typeof p !== "string") return;
    setError(null);
    try {
      setContent(await api.readTextFile(p));
      const ext = p.split(".").pop()?.toLowerCase();
      setFormat(ext === "srt" || ext === "vtt" || ext === "txt" ? ext : "auto");
      setOrigin(ext ?? "file");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const fetchCaptions = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await api.fetchCaptions(video.id);
      setContent(c.content);
      setFormat("vtt");
      setOrigin(`captions:${c.language}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const un = listen<TranscribeProgress>("transcribe-progress", (e) => {
      if (e.payload.videoId === video.id) setProgress(e.payload.percent);
    });
    return () => {
      void un.then((f) => f());
    };
  }, [video.id]);

  const transcribe = async () => {
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const c = await api.transcribeMedia(video.id);
      setContent(c.content);
      setFormat("vtt");
      setOrigin("whisper");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.importTranscript(video.id, content, format === "auto" ? null : format, origin ?? (format === "auto" ? null : format), replace);
      toast(`Imported ${d.sentences.length} sentences`);
      onImported(d);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import transcript"
      onClose={onClose}
      width={680}
      footer={
        <>
          {hasExisting && (
            <Segmented
              size="sm"
              value={replace ? "replace" : "append"}
              onChange={(v) => setReplace(v === "replace")}
              options={[
                { value: "replace", label: "Replace existing", title: "Sentences with identical text keep their notes, saved links and recordings" },
                { value: "append", label: "Append to end" },
              ]}
            />
          )}
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void doImport()} loading={busy && !!preview} disabled={!preview?.segments.length}>
            Import {preview ? `${preview.segments.length} sentences` : ""}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Segmented<Source>
            value={source}
            onChange={(s) => {
              setSource(s);
              setError(null);
            }}
            options={[
              { value: "paste", label: "Paste text" },
              { value: "file", label: "TXT / SRT / VTT file" },
              ...(captionsAvailable ? [{ value: "captions" as Source, label: "Online captions" }] : []),
              { value: "transcribe" as Source, label: "Transcribe audio" },
            ]}
          />
          <div className="flex-1" />
          <Select value={format} onChange={(e) => setFormat(e.target.value)} className="h-7 text-[12px]" title="Format">
            <option value="auto">Detect format</option>
            <option value="txt">Plain text</option>
            <option value="srt">SRT</option>
            <option value="vtt">WebVTT</option>
          </Select>
        </div>

        {source === "file" && (
          <Button icon={FileUp} onClick={() => void pickFile()} className="self-start">
            Choose file…
          </Button>
        )}
        {source === "captions" && (
          <div className="flex items-center gap-2">
            <Button icon={Subtitles} onClick={() => void fetchCaptions()} loading={busy && !preview}>
              Fetch English captions
            </Button>
            <span className="text-[12px] text-muted">Uses the video’s public captions (manual captions preferred over auto-generated).</span>
          </div>
        )}
        {source === "transcribe" && (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            {!whisperReady ? (
              <div className="text-[12.5px] text-warn">Whisper is not installed (see Settings → Media tools).</div>
            ) : !hasLocalMedia ? (
              <div className="text-[12.5px] text-muted">
                Whisper needs the audio on this Mac. Download the video (or attach your own file) first, then transcribe.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Button icon={AudioLines} variant="primary" onClick={() => void transcribe()} loading={busy && progress != null} disabled={busy}>
                    Transcribe audio on this Mac
                  </Button>
                  <span className="text-[12px] text-muted">Offline speech-to-text (Whisper). Nothing is uploaded.</span>
                </div>
                {progress != null && (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.max(3, progress)}%` }} />
                    </div>
                    <span className="w-10 text-right font-mono text-[11px] text-muted">{Math.round(progress)}%</span>
                  </div>
                )}
                <div className="text-[11.5px] text-faint">
                  Takes roughly 1 minute per 10–20 minutes of audio on Apple Silicon. Machine transcripts can contain mistakes — check names and numbers.
                </div>
              </>
            )}
          </div>
        )}
        <TextArea
          rows={source === "paste" ? 9 : 5}
          placeholder={
            "Paste a transcript. Supported:\n• Plain text (sentences are split automatically)\n• YouTube “Show transcript” copy (0:12 lines)\n• Speaker lines like “Person A: …”, “B: …”, “John: …”\n• SRT / VTT subtitles"
          }
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setOrigin(null);
          }}
          className="font-mono text-[12px]"
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        {preview && (
          <div className="rounded-lg border border-line">
            <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] text-muted">
              Preview <Badge tone="accent">{preview.format.toUpperCase()}</Badge>
              <span>{preview.segments.length} sentences</span>
              <span>· {preview.segments.filter((s) => s.start != null).length} with timestamps</span>
            </div>
            <div className="max-h-48 overflow-y-auto px-3 py-1.5">
              {preview.segments.length === 0 && <div className="py-2 text-[12.5px] text-muted">No sentences found.</div>}
              {preview.segments.slice(0, 40).map((s, i) => (
                <div key={i} className="flex gap-2 py-0.5 text-[12.5px]">
                  <span className="w-12 shrink-0 font-mono text-[11px] text-faint">{s.start != null ? formatTime(s.start) : "—"}</span>
                  {s.speaker !== "U" && <Badge tone={s.speaker === "A" ? "a" : "b"}>{speakerLabel(s.speaker)}</Badge>}
                  <span className="min-w-0">{s.text}</span>
                </div>
              ))}
              {preview.segments.length > 40 && <div className="py-1 text-[11.5px] text-faint">…and {preview.segments.length - 40} more</div>}
            </div>
          </div>
        )}
        {busy && !preview && source === "file" && <Spinner />}
      </div>
    </Modal>
  );
}

export function ImportTranslationsDialog({ video, count, onClose, onDone }: { video: Video; count: number; onClose: () => void; onDone: (d: TranscriptData) => void }) {
  const { toast } = useFeedback();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const lines = text.split("\n").filter((l) => l.trim()).length;
  return (
    <Modal
      title="Add Bengali translations"
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!lines}
            onClick={async () => {
              setBusy(true);
              try {
                const d = await api.importTranslations(video.id, text);
                toast(`Added ${Math.min(lines, count)} translations`);
                onDone(d);
                onClose();
              } catch (e) {
                toast(errorMessage(e), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="mb-2 text-[12.5px] text-muted">
        Paste one translation per line, in the same order as the transcript ({count} sentences). Line 1 goes to sentence 1, and so on. Existing
        translations for those sentences are replaced.
      </div>
      <TextArea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="আমি ভালো আছি।&#10;তুমি কেমন আছো?" />
      <div className="mt-1 text-[11.5px] text-faint">
        {lines} line{lines === 1 ? "" : "s"}
        {lines > count ? ` — ${lines - count} extra will be ignored` : ""}
      </div>
    </Modal>
  );
}
