import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AlertTriangle, Download, ExternalLink, FileText, Music, Paperclip } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Spinner } from "../../components/ui";
import { youtubeId } from "../../lib/format";
import { loadYouTubeApi, mediaElementApi, youtubeApi, youtubeErrorMessage } from "../../lib/player";
import type { PlayerApi, YTPlayer } from "../../lib/player";
import type { Video } from "../../lib/types";

interface Props {
  video: Video;
  onApi: (api: PlayerApi | null) => void;
  subtitle: string | null;
  downloading: boolean;
  canDownload: boolean;
  onDownload: () => void;
  onAttach: () => void;
}

function LocalPlayer({ video, onApi, subtitle }: { video: Video; onApi: Props["onApi"]; subtitle: string | null }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);
  const src = convertFileSrc(video.mediaPath ?? "");
  const audio = video.mediaKind === "audio";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ready = () => onApi(mediaElementApi(el));
    el.addEventListener("loadedmetadata", ready);
    if (el.readyState >= 1) ready();
    return () => {
      el.removeEventListener("loadedmetadata", ready);
      onApi(null);
    };
  }, [onApi, src]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  if (error) {
    return (
      <div className="flex w-full aspect-video flex-col items-center justify-center gap-2 bg-black/90 p-6 text-center text-[13px] text-white/80">
        <AlertTriangle size={20} />
        {error}
      </div>
    );
  }

  return (
    <div className="relative bg-black">
      {audio ? (
        <div className="flex w-full aspect-[16/7] flex-col items-center justify-center gap-2 bg-gradient-to-b from-neutral-800 to-neutral-900 text-white/80" onClick={toggle}>
          <Music size={30} />
          <div className="max-w-[80%] truncate text-[13px]">{video.title}</div>
          <audio ref={ref} src={src} preload="metadata" onError={() => setError("This audio file could not be played.")} />
        </div>
      ) : (
        <video
          ref={ref}
          src={src}
          preload="metadata"
          playsInline
          onClick={toggle}
          onError={() => setError("This video file could not be played. It may use a codec macOS does not support (try an H.264 MP4).")}
          className="block aspect-video w-full bg-black"
        />
      )}
      {subtitle && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-6">
          <span className="rounded bg-black/70 px-2 py-1 text-center text-[15px] leading-snug text-white">{subtitle}</span>
        </div>
      )}
    </div>
  );
}

function YouTubePlayer({ videoId, onApi, onFail }: { videoId: string; onApi: Props["onApi"]; onFail: (msg: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let player: YTPlayer | null = null;
    let cancelled = false;
    const mount = document.createElement("div");
    host.current?.appendChild(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        player = new YT.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0, origin: window.location.origin },
          events: {
            onReady: (e) => {
              setLoading(false);
              onApi(youtubeApi(e.target));
            },
            onError: (e) => {
              setLoading(false);
              onFail(youtubeErrorMessage(e.data));
            },
          },
        });
      })
      .catch((e: Error) => {
        setLoading(false);
        onFail(e.message);
      });
    return () => {
      cancelled = true;
      onApi(null);
      player?.destroy();
      mount.remove();
    };
  }, [videoId, onApi, onFail]);

  return (
    <div className="relative aspect-video w-full bg-black [&_iframe]:h-full [&_iframe]:w-full" ref={host}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner className="text-white/70" />
        </div>
      )}
    </div>
  );
}

/** Picks the best available source: verified local file → YouTube embed → explanation + actions. */
export function MediaPlayer({ video, onApi, subtitle, downloading, canDownload, onDownload, onAttach }: Props) {
  const [embedError, setEmbedError] = useState<string | null>(null);
  const ytId = video.platform === "youtube" ? youtubeId(video.sourceUrl) : null;
  const hasLocal = video.mediaStatus === "ready" && !!video.mediaPath && !video.mediaMissing;

  if (hasLocal) return <LocalPlayer video={video} onApi={onApi} subtitle={subtitle} />;

  if (ytId && !embedError) return <YouTubePlayer videoId={ytId} onApi={onApi} onFail={setEmbedError} />;

  let message: string;
  if (downloading) message = "Downloading for offline practice…";
  else if (video.mediaMissing) message = "The local media file is missing. Re-download it or attach the file again.";
  else if (embedError) message = `${embedError} Download the video for offline practice instead.`;
  else if (video.platform === "facebook") message = "Facebook videos are practiced offline. Download the public video first (no login is used).";
  else if (video.platform === "none") message = "This item has a transcript only. You can attach an audio or video file any time.";
  else if (video.mediaStatus === "failed") message = video.mediaError ?? "The download failed.";
  else message = "No playable media yet.";

  return (
    <div className="flex w-full aspect-video flex-col items-center justify-center gap-3 bg-sunken p-6 text-center">
      {downloading ? <Spinner size={22} /> : video.platform === "none" ? <FileText size={22} className="text-muted" /> : <AlertTriangle size={22} className="text-warn" />}
      <div className="max-w-md whitespace-pre-wrap text-[13px] text-muted">{message}</div>
      {!downloading && (
        <div className="flex flex-wrap justify-center gap-2">
          {canDownload && (
            <Button icon={Download} variant="primary" onClick={onDownload}>
              {video.mediaStatus === "failed" ? "Retry download" : "Download for offline"}
            </Button>
          )}
          <Button icon={Paperclip} onClick={onAttach}>
            Attach my own file
          </Button>
          {video.sourceUrl && (
            <Button icon={ExternalLink} variant="ghost" onClick={() => void openUrl(video.sourceUrl ?? "")}>
              Open in browser
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
