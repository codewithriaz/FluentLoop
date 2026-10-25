import { invoke } from "@tauri-apps/api/core";
import type {
  AiConfig, Captions, Folder, LibraryInfo, Note, NoteEntity, NoteListItem, PracticeAction, PracticeMode, PracticeState,
  Preview, Recording, TtsClip, TtsStatus, SavedSentence, Sentence, Session, Speaker, StorageInfo, Tag, Template, TranscriptData, UrlMetadata,
  VaultFilter, Video,
} from "./types";

/** Every backend call goes through here; errors arrive as plain strings. */
export const api = {
  // library
  listFolders: () => invoke<Folder[]>("list_folders"),
  createFolder: (name: string, parentId: string | null = null) => invoke<string>("create_folder", { name, parentId }),
  renameFolder: (id: string, name: string) => invoke<void>("rename_folder", { id, name }),
  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),
  listVideos: (query: { folderId?: string | null; search?: string; recentOnly?: boolean }) => invoke<Video[]>("list_videos", { query }),
  getVideo: (id: string) => invoke<Video>("get_video", { id }),
  createVideo: (input: { title: string; sourceUrl?: string | null; channel?: string | null; thumbnailUrl?: string | null; durationSec?: number | null; folderId?: string | null }) =>
    invoke<Video>("create_video", { input }),
  updateVideo: (id: string, patch: { title?: string; channel?: string; folderId?: string }) => invoke<Video>("update_video", { id, patch }),
  deleteVideo: (id: string) => invoke<void>("delete_video", { id }),
  importMediaFile: (path: string, folderId: string | null) => invoke<Video>("import_media_file", { path, folderId }),
  attachMediaFile: (videoId: string, path: string) => invoke<Video>("attach_media_file", { videoId, path }),
  fetchUrlMetadata: (url: string) => invoke<UrlMetadata>("fetch_url_metadata", { url }),
  downloadMedia: (videoId: string) => invoke<Video>("download_media", { videoId }),
  fetchCaptions: (videoId: string) => invoke<Captions>("fetch_captions", { videoId }),

  // transcript
  getTranscript: (videoId: string) => invoke<TranscriptData>("get_transcript", { videoId }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  previewTranscript: (content: string, format: string | null) => invoke<Preview>("preview_transcript", { content, format }),
  importTranscript: (videoId: string, content: string, format: string | null, source: string | null, replace: boolean) =>
    invoke<TranscriptData>("import_transcript", { videoId, content, format, source, replace }),
  importTranslations: (videoId: string, content: string) => invoke<TranscriptData>("import_translations", { videoId, content }),
  updateSentence: (
    id: string,
    patch: { text?: string; translation?: string; speaker?: Speaker; startSec?: number; endSec?: number; clearTimes?: boolean },
  ) => invoke<Sentence>("update_sentence", { id, patch }),
  insertSentence: (videoId: string, afterId: string | null, text: string) => invoke<Sentence>("insert_sentence", { videoId, afterId, text }),
  deleteSentence: (id: string) => invoke<void>("delete_sentence", { id }),
  mergeSentenceWithNext: (id: string) => invoke<void>("merge_sentence_with_next", { id }),
  splitSentence: (id: string, at: number) => invoke<void>("split_sentence", { id, at }),
  moveSentence: (id: string, direction: -1 | 1) => invoke<void>("move_sentence", { id, direction }),
  setSpeakers: (ids: string[], speaker: Speaker) => invoke<void>("set_speakers", { ids, speaker }),
  alternateSpeakers: (videoId: string, fromId: string | null, first: "A" | "B") => invoke<TranscriptData>("alternate_speakers", { videoId, fromId, first }),
  setPracticeState: (sentenceId: string, practiceState: PracticeState) => invoke<Sentence>("set_practice_state", { sentenceId, practiceState }),
  exportTranscript: (videoId: string, path: string, format: "txt" | "srt" | "vtt" | "md") => invoke<void>("export_transcript", { videoId, path, format }),

  // notes
  getNote: (entityType: NoteEntity, entityId: string) => invoke<Note | null>("get_note", { entityType, entityId }),
  saveNote: (entityType: NoteEntity, entityId: string, body: string, title: string | null = null) =>
    invoke<Note | null>("save_note", { entityType, entityId, body, title }),
  createGeneralNote: (title: string) => invoke<Note>("create_general_note", { title }),
  deleteNote: (id: string) => invoke<void>("delete_note", { id }),
  listNotes: (search: string | null, entityType: string | null) => invoke<NoteListItem[]>("list_notes", { search, entityType }),
  exportNotes: (path: string) => invoke<void>("export_notes", { path }),

  // vault
  saveSentence: (input: { text: string; meaning?: string | null; speaker?: Speaker; videoId?: string | null; sentenceId?: string | null; startSec?: number | null }) =>
    invoke<{ saved: SavedSentence; created: boolean }>("save_sentence", { input }),
  unsaveSentence: (sentenceId: string) => invoke<void>("unsave_sentence", { sentenceId }),
  listSaved: (filter: VaultFilter) => invoke<SavedSentence[]>("list_saved", { filter }),
  updateSaved: (id: string, patch: { text?: string; meaning?: string; example?: string; speaker?: Speaker; status?: PracticeState }) =>
    invoke<SavedSentence>("update_saved", { id, patch }),
  deleteSaved: (id: string) => invoke<void>("delete_saved", { id }),
  setSavedTags: (id: string, tagIds: string[]) => invoke<SavedSentence>("set_saved_tags", { id, tagIds }),
  listTags: () => invoke<Tag[]>("list_tags"),
  createTag: (name: string) => invoke<Tag>("create_tag", { name }),
  deleteTag: (id: string) => invoke<void>("delete_tag", { id }),
  exportSaved: (path: string, format: "csv" | "txt", filter: VaultFilter | null) => invoke<number>("export_saved", { path, format, filter }),

  // practice
  startSession: (videoId: string | null, mode: PracticeMode) => invoke<string>("start_session", { videoId, mode }),
  endSession: (id: string) => invoke<void>("end_session", { id }),
  recordAttempt: (sessionId: string, sentenceId: string | null, savedId: string | null, action: PracticeAction, recordingId: string | null = null) =>
    invoke<void>("record_attempt", { sessionId, sentenceId, savedId, action, recordingId }),
  listSessions: (videoId: string | null, limit = 50) => invoke<Session[]>("list_sessions", { videoId, limit }),

  // recordings
  saveRecording: (bytes: Uint8Array, meta: { sentenceId?: string | null; savedId?: string | null; mime: string; durationSec: number }) =>
    invoke<Recording>("save_recording", bytes, {
      headers: {
        "x-sentence-id": meta.sentenceId ?? "",
        "x-saved-id": meta.savedId ?? "",
        "x-mime": meta.mime,
        "x-duration": String(meta.durationSec),
      },
    }),
  listRecordings: (sentenceId: string | null, savedId: string | null) => invoke<Recording[]>("list_recordings", { sentenceId, savedId }),
  deleteRecording: (id: string) => invoke<void>("delete_recording", { id }),

  // text-to-speech (local Kokoro)
  ttsStatus: () => invoke<TtsStatus>("tts_status"),
  ttsGenerate: (text: string, voice: string, speed: number) => invoke<TtsClip>("tts_generate", { text, voice, speed }),
  listTtsClips: () => invoke<TtsClip[]>("list_tts_clips"),
  deleteTtsClip: (id: string) => invoke<void>("delete_tts_clip", { id }),
  exportTtsClip: (id: string, dest: string) => invoke<void>("export_tts_clip", { id, dest }),

  // speech-to-text (local Whisper)
  transcribeMedia: (videoId: string) => invoke<Captions>("transcribe_media", { videoId }),
  transcribeRecording: (recordingId: string) => invoke<Recording>("transcribe_recording", { recordingId }),

  // templates
  listTemplates: (search: string | null, category: string | null) => invoke<Template[]>("list_templates", { search, category }),
  createTemplate: (input: { title: string; content: string; category?: string; sourceType?: string | null; sourceId?: string | null; sourceLabel?: string | null }) =>
    invoke<Template>("create_template", { input }),
  updateTemplate: (id: string, patch: { title?: string; content?: string; category?: string }) => invoke<Template>("update_template", { id, patch }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),

  // ai
  getAiConfig: () => invoke<AiConfig>("get_ai_config"),
  setAiConfig: (provider: string, endpoint: string, model: string) => invoke<void>("set_ai_config", { provider, endpoint, model }),
  setAiKey: (key: string) => invoke<void>("set_ai_key", { key }),
  clearAiKey: () => invoke<void>("clear_ai_key"),
  aiComplete: (system: string, prompt: string) => invoke<string>("ai_complete", { system, prompt }),

  // settings / library
  getSettings: () => invoke<Record<string, string>>("get_settings"),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  libraryInfo: () => invoke<LibraryInfo>("library_info"),
  storageInfo: () => invoke<StorageInfo>("storage_info"),
  createBackup: (dest: string, includeMedia: boolean) => invoke<number>("create_backup", { dest, includeMedia }),
  restoreBackup: (zipPath: string) => invoke<{ safetyCopy: string; includesMedia: boolean }>("restore_backup", { zipPath }),
  changeLibrary: (path: string, copyCurrent: boolean) => invoke<LibraryInfo>("change_library", { path, copyCurrent }),
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
