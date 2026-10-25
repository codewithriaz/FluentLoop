export function formatTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "--:--";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

/** Parses "1:02", "01:02.5", "1:00:00" or plain seconds. */
export function parseTime(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || Number.isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function relativeDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function platformLabel(p: string): string {
  switch (p) {
    case "youtube":
      return "YouTube";
    case "facebook":
      return "Facebook";
    case "local_video":
      return "Video file";
    case "local_audio":
      return "Audio file";
    case "none":
      return "Transcript";
    default:
      return "Link";
  }
}

export function speakerLabel(s: string): string {
  return s === "A" ? "Person A" : s === "B" ? "Person B" : "Unknown";
}

export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.includes("youtube.com")) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/);
      return m ? m[1] : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "export";
}

/**
 * Transcript text with a "(m:ss)" timestamp before each sentence, e.g.
 * "(0:00) Every business is different. (0:05) A plumber needs quick service requests."
 */
export function transcriptWithTimestamps(sentences: { text: string; startSec: number | null }[], layout: "paragraph" | "lines"): string {
  const parts = sentences.map((s) => (s.startSec != null ? `(${formatTime(s.startSec)}) ${s.text}` : s.text));
  return parts.join(layout === "paragraph" ? " " : "\n");
}
