import { describe, expect, it } from "vitest";
import { formatBytes, formatTime, parseTime, relativeDate, safeFileName, transcriptWithTimestamps, youtubeId } from "./format";

describe("format helpers", () => {
  it("formats and parses times", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(75.9)).toBe("1:15");
    expect(formatTime(3725)).toBe("1:02:05");
    expect(formatTime(null)).toBe("--:--");
    expect(parseTime("1:15")).toBe(75);
    expect(parseTime("1:00:00")).toBe(3600);
    expect(parseTime("12.5")).toBe(12.5);
    expect(parseTime("abc")).toBeNull();
  });

  it("extracts YouTube ids", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=jNQXAC9IVRw&t=3")).toBe("jNQXAC9IVRw");
    expect(youtubeId("https://youtu.be/jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(youtubeId("https://www.youtube.com/shorts/abcdef123")).toBe("abcdef123");
    expect(youtubeId("https://facebook.com/x")).toBeNull();
    expect(youtubeId("not a url")).toBeNull();
  });

  it("formats bytes, dates and file names", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    const now = new Date("2026-01-10T12:00:00Z");
    expect(relativeDate("2026-01-10T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeDate(null, now)).toBe("Never");
    expect(safeFileName('a/b:c?"d')).toBe("a b c d");
  });

  it("formats transcripts with timestamps", () => {
    const s = [
      { text: "Every business is different.", startSec: 0 },
      { text: "A plumber needs quick service requests.", startSec: 5.4 },
      { text: "No time here.", startSec: null },
    ];
    expect(transcriptWithTimestamps(s.slice(0, 2), "paragraph")).toBe("(0:00) Every business is different. (0:05) A plumber needs quick service requests.");
    expect(transcriptWithTimestamps(s, "lines")).toBe("(0:00) Every business is different.\n(0:05) A plumber needs quick service requests.\nNo time here.");
  });
});
