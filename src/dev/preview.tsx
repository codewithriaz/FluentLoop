// Dev-only: renders the real UI in a normal browser with a mocked Tauri backend, for visual checks
// (`pnpm dev` then open http://localhost:1420/preview.html#<screen>). Not included in production builds.
import { mockIPC } from "@tauri-apps/api/mocks";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "../App";
import "../index.css";

const now = new Date().toISOString();
const video = {
  id: "v1", title: "422 好きな仕事 — Client call role-play", sourceUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw", platform: "facebook",
  channel: "English with Sara", thumbnailUrl: null, durationSec: 712, folderId: "f1", mediaPath: null, mediaKind: null, mediaStatus: "none",
  mediaError: null, mediaMissing: false, createdAt: now, updatedAt: now, lastPracticedAt: now, sentenceCount: 4, practicedCount: 1,
};
const lines: [string, string, string | null, string | null][] = [
  ["A", "Hi, thanks for joining the call today.", "আজকের কলে যোগ দেওয়ার জন্য ধন্যবাদ।", null],
  ["B", "Of course. I wanted to talk about the new pricing.", null, "Vocabulary: pricing = দাম নির্ধারণ"],
  ["A", "Sure, could you tell me what your budget looks like?", null, null],
  ["B", "We are looking at something around five thousand a month.", null, null],
];
const sentences = lines.map(([sp, text, tr, note], i) => ({
  id: `s${i}`, position: i + 1, text, translation: tr, startSec: i * 4 + 1, endSec: i * 4 + 4, speaker: sp,
  practiceState: i === 0 ? "practiced" : i === 3 ? "difficult" : "new", practiceCount: i === 0 ? 2 : 0, lastPracticedAt: null, note,
  savedId: i === 1 ? "x1" : null, recordingCount: 0,
}));
const tags = ["Client Communication", "Sales English", "Daily Conversation", "Grammar"].map((n, i) => ({ id: `t${i}`, name: n, count: i ? 0 : 1 }));
const saved = [{
  id: "x1", text: sentences[1].text, meaning: "অবশ্যই। আমি নতুন দাম নিয়ে কথা বলতে চেয়েছিলাম।", example: null, speaker: "B", status: "new", practiceCount: 0,
  lastPracticedAt: null, createdAt: now, updatedAt: now, note: "Polite way to open a topic", recordingCount: 0, tags: [tags[0]],
  sources: [{ id: "src", videoId: "v1", sentenceId: "s1", videoTitle: video.title, startSec: 5 }],
}];

mockIPC((cmd) => {
  switch (cmd) {
    case "library_info": return { path: "/Users/me/Library/Application Support/com.fluentloop.app/Library", schemaVersion: 1, openError: null, tools: { ytDlp: "/Users/me/.local/bin/yt-dlp", ffmpeg: "/Users/me/.local/bin/ffmpeg", ffprobe: null, whisper: "/Users/me/.local/bin/whisper-cli", whisperModel: "/Users/me/.local/share/whisper/ggml-small.en.bin" } };
    case "get_settings": return {};
    case "list_folders": return [{ id: "f1", name: "Client calls", parentId: null, videoCount: 1 }, { id: "f2", name: "Podcasts", parentId: null, videoCount: 0 }];
    case "list_videos": return [video, { ...video, id: "v2", title: "Daily conversation at a café", platform: "local_audio", mediaKind: "audio", mediaStatus: "ready", channel: null, lastPracticedAt: null, sentenceCount: 0, practicedCount: 0 }];
    case "get_video": return video;
    case "get_transcript": return { transcript: { id: "t", videoId: "v1", source: "captions:en", language: "en", updatedAt: now }, sentences };
    case "list_saved": return saved;
    case "list_tags": return tags;
    case "list_sessions": return [{ id: "p1", videoId: "v1", videoTitle: video.title, mode: "practice_b", startedAt: now, endedAt: now, practiced: 3, difficult: 1, skipped: 0, recorded: 2 }];
    case "list_notes": return [{ id: "n1", entityType: "sentence", entityId: "s1", title: null, body: "Vocabulary: pricing = দাম নির্ধারণ", updatedAt: now, context: sentences[1].text, videoId: "v1", startSec: 5 }];
    case "list_templates": return [{ id: "tp1", title: "Follow-up email after a call", content: "Hi [Name],\n\nThanks for your time today…", category: "Client Communication", sourceType: null, sourceId: null, sourceLabel: null, note: null, createdAt: now, updatedAt: now }];
    case "storage_info": return { path: "/Users/me/Library", databaseBytes: 245760, mediaBytes: 52428800, recordingsBytes: 1048576, backupsBytes: 0, videoCount: 2, sentenceCount: 4, savedCount: 1, noteCount: 1, missing: [] };
    case "get_ai_config": return { provider: "openai", endpoint: "https://api.openai.com/v1", model: "", hasKey: false };
    case "get_note": return null;
    case "tts_status": return { python: "/Users/me/.local/share/fluentloop/tts-venv/bin/python", modelCache: "/x", modelReady: true, maxChars: 10000, busy: false };
    case "list_tts_clips": return [
      { id: "c1", text: "Every business is different. So why should every website work the same way?", voice: "af_heart", speed: 1, filePath: "/x.wav", durationSec: 5.3, createdAt: now, fileMissing: false },
      { id: "c2", text: "Could you send me the invoice by Friday, please?", voice: "bm_george", speed: 1.1, filePath: "/y.wav", durationSec: 3.9, createdAt: now, fileMissing: false },
    ];
    case "list_recordings": return [{ id: "r1", sentenceId: "s0", savedSentenceId: null, filePath: "/x.m4a", mime: "audio/mp4", durationSec: 3, createdAt: now, transcript: "Hi thanks for join the call today" }];
    default: return null;
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// #screen in the URL clicks through to that screen for screenshots.
const target = location.hash.slice(1);
const clickText = (text: string) =>
  text.startsWith("@")
    ? document.querySelector<HTMLButtonElement>(`button[aria-label="${text.slice(1)}"]`)?.click()
    : Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(text))?.click();
const steps: Record<string, string[]> = {
  dashboard: [],
  library: ["Video Studio"],
  workspace: ["Video Studio", "422"],
  practice: ["Video Studio", "422", "Practice A/B"],
  vault: ["Second Brain", "Saved Sentences"],
  notes: ["Second Brain"],
  templates: ["Second Brain", "Templates"],
  settings: ["Settings"],
  add: ["Video Studio", "Add Video"],
  tasks: ["My Tasks"],
  drawer: ["Video Studio", "@Open navigation"],
  tts: ["Audio / TTS"],
  "tts-history": ["Audio / TTS", "history"],
};
if (target === "tts" || target === "tts-history") {
  try {
    localStorage.setItem("fluentloop.tts.draft", "Every business is different. So why should every website work the same way?\n\nA plumber needs quick service requests. An HVAC company needs emergency calls and easy bookings.");
  } catch {
    /* ignore */
  }
}
try {
  localStorage.setItem("fluentloop.lastVideo", "v1");
} catch {
  /* ignore */
}
(steps[target] ?? []).forEach((label, i) => setTimeout(() => clickText(label), 400 + i * 350));

// ?debug=overflow lists elements wider than the viewport (written into the DOM for --dump-dom).
if (new URLSearchParams(location.search).get("debug") === "overflow") {
  setTimeout(() => {
    const vw = document.documentElement.clientWidth;
    const rows = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((el) => el.getBoundingClientRect().right > vw + 1 && el.getBoundingClientRect().width > 0)
      .slice(0, 12)
      .map((el) => `${el.tagName}.${(el.className || "").toString().slice(0, 90)} w=${Math.round(el.getBoundingClientRect().width)} r=${Math.round(el.getBoundingClientRect().right)}`);
    const pre = document.createElement("pre");
    pre.id = "overflow-report";
    pre.textContent = `vw=${vw}\n${rows.join("\n")}`;
    document.body.appendChild(pre);
  }, 3000);
}
