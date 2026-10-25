/** Common control surface for local <video>/<audio> elements and the YouTube IFrame player. */
export interface PlayerApi {
  play(): void;
  pause(): void;
  seek(sec: number): void;
  getTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  /** False for embeds where seeking/reading time is unreliable. */
  readonly precise: boolean;
}

export function mediaElementApi(el: HTMLMediaElement): PlayerApi {
  return {
    play: () => void el.play().catch(() => undefined),
    pause: () => el.pause(),
    seek: (s) => {
      el.currentTime = Math.max(0, s);
    },
    getTime: () => el.currentTime,
    getDuration: () => (Number.isFinite(el.duration) ? el.duration : 0),
    isPlaying: () => !el.paused && !el.ended,
    setRate: (r) => {
      el.playbackRate = r;
    },
    setVolume: (v) => {
      el.volume = Math.min(1, Math.max(0, v));
    },
    precise: true,
  };
}

// ---- YouTube IFrame API (loaded on demand) ----

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
  destroy(): void;
}

interface YTEvent {
  target: YTPlayer;
  data: number;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: { onReady?: (e: YTEvent) => void; onError?: (e: YTEvent) => void; onStateChange?: (e: YTEvent) => void };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      ytPromise = null;
      reject(new Error("Could not load the YouTube player (are you offline?)"));
    };
    document.head.appendChild(s);
  });
  return ytPromise;
}

export function youtubeApi(p: YTPlayer): PlayerApi {
  return {
    play: () => p.playVideo(),
    pause: () => p.pauseVideo(),
    seek: (s) => p.seekTo(Math.max(0, s), true),
    getTime: () => p.getCurrentTime() || 0,
    getDuration: () => p.getDuration() || 0,
    isPlaying: () => p.getPlayerState() === 1,
    setRate: (r) => p.setPlaybackRate(r),
    setVolume: (v) => p.setVolume(Math.round(v * 100)),
    precise: true,
  };
}

export function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return "The YouTube link is invalid.";
    case 5:
      return "This video cannot be played in an embedded player.";
    case 100:
      return "The video was removed or is private.";
    case 101:
    case 150:
      return "The owner does not allow this video to be embedded.";
    default:
      return `The embedded YouTube player reported an error (${code}).`;
  }
}
