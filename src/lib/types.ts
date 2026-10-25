// Mirrors the serialized Rust structs (camelCase). Keep in sync with src-tauri/src/commands/*.

export type Platform = "youtube" | "facebook" | "local_video" | "local_audio" | "other" | "none";
export type MediaStatus = "none" | "downloading" | "ready" | "failed";
export type Speaker = "A" | "B" | "U";
export type PracticeState = "new" | "practiced" | "difficult";
export type PracticeMode = "full" | "practice_a" | "hide_a" | "practice_b" | "both" | "random";
export type PracticeAction = "practiced" | "difficult" | "skipped" | "revealed" | "recorded";
export type NoteEntity = "video" | "folder" | "transcript" | "sentence" | "saved_sentence" | "practice_session" | "template" | "general";

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  videoCount: number;
}

export interface Video {
  id: string;
  title: string;
  sourceUrl: string | null;
  platform: Platform;
  channel: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  folderId: string | null;
  /** Absolute path of the local media file, if any. */
  mediaPath: string | null;
  mediaKind: "video" | "audio" | null;
  mediaStatus: MediaStatus;
  mediaError: string | null;
  mediaMissing: boolean;
  createdAt: string;
  updatedAt: string;
  lastPracticedAt: string | null;
  sentenceCount: number;
  practicedCount: number;
}

export interface UrlMetadata {
  platform: Platform;
  url: string;
  title: string | null;
  channel: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  hasEnglishCaptions: boolean;
  downloadable: boolean;
  error: string | null;
}

export interface Captions {
  content: string;
  language: string;
  fileName: string;
}

export interface Transcript {
  id: string;
  videoId: string;
  source: string;
  language: string;
  updatedAt: string;
}

export interface Sentence {
  id: string;
  position: number;
  text: string;
  translation: string | null;
  startSec: number | null;
  endSec: number | null;
  speaker: Speaker;
  practiceState: PracticeState;
  practiceCount: number;
  lastPracticedAt: string | null;
  note: string | null;
  savedId: string | null;
  recordingCount: number;
}

export interface TranscriptData {
  transcript: Transcript | null;
  sentences: Sentence[];
}

export interface Segment {
  text: string;
  start: number | null;
  end: number | null;
  speaker: Speaker;
}

export interface Preview {
  format: "txt" | "srt" | "vtt";
  segments: Segment[];
}

export interface Note {
  id: string;
  entityType: NoteEntity;
  entityId: string;
  title: string | null;
  body: string;
  updatedAt: string;
}

export interface NoteListItem extends Note {
  context: string | null;
  videoId: string | null;
  startSec: number | null;
}

export interface Tag {
  id: string;
  name: string;
  count: number;
}

export interface SentenceSource {
  id: string;
  videoId: string | null;
  sentenceId: string | null;
  videoTitle: string | null;
  startSec: number | null;
}

export interface SavedSentence {
  id: string;
  text: string;
  meaning: string | null;
  example: string | null;
  speaker: Speaker;
  status: PracticeState;
  practiceCount: number;
  lastPracticedAt: string | null;
  createdAt: string;
  updatedAt: string;
  note: string | null;
  recordingCount: number;
  tags: Tag[];
  sources: SentenceSource[];
}

export interface VaultFilter {
  search?: string;
  tagId?: string;
  speaker?: Speaker | "";
  status?: PracticeState | "unpracticed" | "";
  sort?: "recent" | "alpha" | "practiced";
}

export interface Session {
  id: string;
  videoId: string | null;
  videoTitle: string | null;
  mode: PracticeMode;
  startedAt: string;
  endedAt: string | null;
  practiced: number;
  difficult: number;
  skipped: number;
  recorded: number;
}

export interface Recording {
  id: string;
  sentenceId: string | null;
  savedSentenceId: string | null;
  filePath: string;
  mime: string | null;
  durationSec: number | null;
  createdAt: string;
  /** What local Whisper heard (null until transcribed). */
  transcript: string | null;
}

export interface Template {
  id: string;
  title: string;
  content: string;
  category: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiConfig {
  provider: "openai" | "anthropic";
  endpoint: string;
  model: string;
  hasKey: boolean;
}

export interface ToolsStatus {
  ytDlp: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
  whisper: string | null;
  whisperModel: string | null;
}

export interface LibraryInfo {
  path: string | null;
  schemaVersion: number | null;
  openError: string | null;
  tools: ToolsStatus;
}

export interface MissingFile {
  kind: "media" | "recording";
  id: string;
  label: string;
  path: string;
}

export interface StorageInfo {
  path: string;
  databaseBytes: number;
  mediaBytes: number;
  recordingsBytes: number;
  backupsBytes: number;
  videoCount: number;
  sentenceCount: number;
  savedCount: number;
  noteCount: number;
  missing: MissingFile[];
}

export interface TtsStatus {
  /** Python in the isolated TTS venv, if installed. */
  python: string | null;
  modelCache: string;
  modelReady: boolean;
  maxChars: number;
  busy: boolean;
}

export interface TtsClip {
  id: string;
  text: string;
  voice: string;
  speed: number;
  filePath: string;
  durationSec: number | null;
  createdAt: string;
  fileMissing: boolean;
}

export interface TtsProgress {
  done: number;
  total: number;
}

export interface TranscribeProgress {
  videoId: string;
  percent: number;
}

export interface DownloadProgress {
  videoId: string;
  percent: number | null;
  message: string;
}
