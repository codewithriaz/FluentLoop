import { Captions, Pause, Play, Repeat, Repeat1, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { IconButton, Select, cx } from "../../components/ui";
import { formatTime } from "../../lib/format";

export type Loop = { kind: "sentence"; id: string } | { kind: "range"; a: number; b: number } | null;

interface Props {
  enabled: boolean;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  volume: number;
  loop: Loop;
  rangeStart: number | null;
  subtitles: boolean;
  hasSentences: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onReplay: () => void;
  onLoopSentence: () => void;
  onRangeMark: () => void;
  onRate: (r: number) => void;
  onVolume: (v: number) => void;
  onSubtitles: () => void;
}

const RATES = [0.5, 0.6, 0.75, 0.85, 1, 1.1, 1.25, 1.5];

export function PlayerControls(p: Props) {
  const rangeLabel =
    p.loop?.kind === "range" ? `A-B ${formatTime(p.loop.a)}–${formatTime(p.loop.b)}` : p.rangeStart != null ? `A ${formatTime(p.rangeStart)} → set B` : "A-B";
  return (
    <div className={cx("border-b border-line bg-panel px-3 py-2", !p.enabled && "pointer-events-none opacity-50")}>
      <input
        type="range"
        min={0}
        max={Math.max(p.duration, 0.1)}
        step={0.1}
        value={Math.min(p.time, p.duration || 0)}
        onChange={(e) => p.onSeek(Number(e.target.value))}
        className="h-1 w-full"
        aria-label="Seek"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <IconButton icon={SkipBack} label="Previous sentence (←)" onClick={p.onPrev} disabled={!p.hasSentences} />
        <button
          type="button"
          onClick={p.onToggle}
          title="Play / pause (Space)"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover"
        >
          {p.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </button>
        <IconButton icon={SkipForward} label="Next sentence (→)" onClick={p.onNext} disabled={!p.hasSentences} />
        <IconButton icon={RotateCcw} label="Replay current sentence (R)" onClick={p.onReplay} disabled={!p.hasSentences} />
        <span className="ml-1 w-[96px] font-mono text-[11.5px] text-muted tabular-nums">
          {formatTime(p.time)} / {formatTime(p.duration)}
        </span>
        <div className="flex-1" />
        <IconButton icon={Repeat1} label="Loop current sentence (L)" active={p.loop?.kind === "sentence"} onClick={p.onLoopSentence} disabled={!p.hasSentences} />
        <button
          type="button"
          onClick={p.onRangeMark}
          title="Loop a time range: click to set A, again to set B, again to clear"
          className={cx(
            "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium",
            p.loop?.kind === "range" || p.rangeStart != null ? "bg-accent-soft text-accent-text" : "text-ink hover:bg-hover",
          )}
        >
          <Repeat size={13} /> {rangeLabel}
        </button>
        <IconButton icon={Captions} label="Show subtitle on video" active={p.subtitles} onClick={p.onSubtitles} />
        <Select value={String(p.rate)} onChange={(e) => p.onRate(Number(e.target.value))} className="h-7 w-[68px] text-[12px]" title="Playback speed ([ and ])">
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </Select>
        <IconButton icon={p.volume === 0 ? VolumeX : Volume2} label={p.volume === 0 ? "Unmute" : "Mute"} onClick={() => p.onVolume(p.volume === 0 ? 1 : 0)} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={p.volume}
          onChange={(e) => p.onVolume(Number(e.target.value))}
          className="h-1 w-16"
          aria-label="Volume"
        />
      </div>
    </div>
  );
}
