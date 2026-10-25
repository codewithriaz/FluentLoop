# FluentLoop — project memory

Personal, local-first macOS app for learning English from YouTube/Facebook videos and local media: transcripts, per-sentence notes, Person A/B role-play, voice recording, a central Sentence Vault, optional AI templates. Single user, no account, no cloud. The owner writes in Bengali/Banglish; UI is English with Bengali (বাংলা) support for meanings.

**Session rule:** read this file first, inspect only the files relevant to the next task, update this file (status, next steps, schema) before finishing. Record real state, not intentions.

## Current status (2026-10-25, Phase 1: design system & app shell — done, awaiting approval for Phase 2)
- Roadmap: Phase 0 audit done; **Phase 1 done** (this section); Phase 2+ not started. Phase 0 open items still pending owner approval: first git commit; install the current build to /Applications (installed copy is the 01:52 schema-v2 build, the library DB is v3, so the installed app will refuse to open it).
- New shell: 12-item sidebar (Dashboard, Content Inbox, YouTube Intelligence, Video Studio, My Tasks, Ideas, Planning & Goals, Time Tracker, Second Brain, Life Lessons, Audio / TTS, Settings). Nav model in `src/lib/nav.ts` (pure data + 5 tests): every `Route["screen"]` maps to exactly one nav item. Existing screens were kept and grouped: **Video Studio** = tabs Library / Recent / Watch & Practice (folders moved from the sidebar into the Library filter row: folder select + New folder); **Second Brain** = tabs Notes / Saved Sentences / Templates; Audio / TTS = TtsScreen. Content Inbox, YouTube Intelligence, My Tasks, Ideas, Planning & Goals, Time Tracker, Life Lessons are intentional `PlaceholderScreen`s (no data, no mock content). Dashboard is minimal: "Continue where you left off" (real last video) + 4 shortcuts. App now opens on Dashboard.
- Design system: muted green accent, warm off-white bg; tokens in `src/index.css` (`--accent*`, `--primary*` soft-green fill for primary buttons, `--r-control` 8px / `--r-card` 12px → `rounded-control`/`rounded-card`, `--sh-card`/`--sh-pop` → `shadow-card`/`shadow-pop`). Shared components in `src/components/ui.tsx`: Button (primary = soft green), IconButton, TextInput, TextArea, Select, **SearchField** (⌘K/Ctrl+K focus, Esc clears), Badge, Modal (responsive width), **Menu** (role=menu, ↑/↓/Home/End, Esc returns focus), **PageTabs** (role=tablist, ←/→), **Page** container, Segmented, EmptyState. `ScreenHeader` = title + subtitle + actions + tabs + filter row (filters sit under the tabs).
- Responsive shell (`src/components/Shell.tsx`): ≥1024px full sidebar (collapsible to an icon rail, remembered in localStorage `fluentloop.sidebarCollapsed`); 768–1023px icon rail; <768px sidebar hidden, overlay drawer from a ☰ button in the header (Esc/backdrop closes). Workspace, TTS, Notes and Templates stack vertically below 768px. Window minWidth lowered 980→400.
- Verified: typecheck, lint, vitest 14/14 (4 files), cargo test 32/32 (+3 ignored), clippy 0, `pnpm tauri build` OK. Visual check via `preview.html` in headless Chrome at 1440, 1100, 900 and 500px (headless Chrome cannot go below 500px wide); an overflow probe (`preview.html?debug=overflow#<screen>`) found no horizontally overflowing elements at 500px on workspace, library, tts. **Not verified in the real Tauri window.**

## Session 3: local Text-to-Speech
- New **Text to Speech** screen (sidebar → Practice → Text to Speech), modelled on the owner's ElevenLabs-style screenshot without credits: centre text editor, "N / 10,000 characters", Clear text, Generate speech (⌘↩); right panel Settings (voice, speed 0.5–2×, language, output format) / History (play, use text, download WAV, delete); player with play/pause/seek, Download WAV, Generate again; progress bar; errors inline.
- Engine: **Kokoro-82M** (hexgrad, Apache-2.0) via the official `kokoro` 0.9.4 Python package, run fully locally. Tested and passing: worker alone offline (5 cases incl. empty text, bad voice, 12-chunk long text → 154.5 s WAV); TTS output fed back through Whisper gave the input text word for word (US af_heart + UK bm_george); Rust↔Python round trip (`cargo test -- --ignored kokoro_end_to_end`, 6.6 s); 32 Rust unit tests, 9 vitest, typecheck, lint, clippy 0, release build (DMG 5.1 MB).
- **Not verified:** clicking through the TTS screen in the real Tauri window (no screen access): audio playback of the WAV in WKWebView, the save dialog for Download WAV, the progress events in the UI. Only the mock preview was checked visually. The new build is **not installed** in /Applications yet: it migrates the library DB to schema 3, after which the older installed app refuses to open it, so install it before relaunching.

## Session 2
- Session 2 added **offline speech-to-text** (local whisper.cpp): transcribe a video's downloaded/attached audio into a timestamped transcript (Import transcript → "Transcribe audio"), and auto-transcribe each voice recording with a word-by-word comparison against the original sentence. Also: **Copy transcript with timestamps** — `(0:00) text (0:05) text` (toolbar copy button + ⋯ menu; paragraph or one-per-line).
- Verified in session 2: typecheck, lint, 7 vitest, 28 Rust tests + 1 ignored end-to-end Whisper test (`cargo test -- --ignored whisper_end_to_end`, passes: macOS `say` → ffmpeg → whisper-cli), clippy 0, release build OK. Whisper UI checked only via mock preview, not in the real window.

- Later in session 2: transcript toolbar has a visible **Download** button (SRT / VTT / TXT / Markdown) next to Copy; SRT/VTT export fills a missing end time from the next sentence (max 8 s, else +3 s); caption sound markers like `[Music]` / `[Applause]` are stripped on import. 30 Rust tests pass.
- Crash found: `~/Library/Logs/DiagnosticReports/fluentloop-2026-10-25-012253.ips` (SIGABRT = Rust panic on a `tokio-rt-worker` thread, i.e. an async command; symbols were stripped, so the cause is unknown). A live test (`cargo test live_metadata_and_captions -- --ignored`, `FL_URLS=<file of links>`) on the owner's 3 links passed, so it was not those flows. Fixes: release `panic = "unwind"` (a panicking command fails instead of killing the app), `strip = "debuginfo"`, and a panic hook in `lib.rs` that appends message + backtrace to `~/Library/Logs/FluentLoop/panic.log`. **Check that file first if anything crashes.**
- Install: the app is installed at `/Applications/FluentLoop.app` (old copies moved to the Trash). The build copy `target/release/bundle/macos/FluentLoop.app` is deleted after install, and `target/.metadata_never_index` keeps Spotlight/Launchpad from listing a second app.
- **Open request (undecided):** owner wants to save links from their *private* Facebook group and download them. That needs a login, so yt-dlp currently fails with "login required". Proposed: opt-in setting to use the owner's own browser login (`--cookies-from-browser chrome|safari|firefox`, never stored by the app). The owner interrupted the question, so it is **not implemented**; ask again before building it (it reverses the original "no Facebook access" rule).

### Session 1
- Phases 1–12 implemented in a first full pass. Release build succeeds: `.app` (8 MB) + `.dmg` (4 MB), the release binary launches and creates its library.
- Verified: `pnpm typecheck`, `pnpm lint` (0 problems), `pnpm test` (3 vitest), `cargo test` (27 tests), `cargo clippy --all-targets` (0 warnings), `pnpm tauri build`.
- yt-dlp download (YouTube public video → h264 mp4, ffprobe-verified) and caption fetch were tested **from the CLI with the same flags the app uses**, not by clicking through the app.
- UI was visually checked via `preview.html` (mock backend) in headless Chrome: library, workspace, practice, vault, settings, add-video dialog. The real Tauri window could not be screenshotted (no screen-recording permission), so **no click-through test in the real app has been done yet**.

## Next steps (priority order)
0. **Install the new build** (quit app → replace /Applications/FluentLoop.app; data upgrades to schema 3) and click-test Text to Speech: generate, play, seek, Download WAV, Generate again, History, voice change, long text.
1. **Manual smoke test in the real app** (owner or next session): add a YouTube link (fetch details → captions import → download), add a public Facebook link + download, import a local mp4/mp3, play + click sentences, loop, notes autosave, save to vault, practice modes, record voice (mic permission prompt), backup → restore. Fix whatever breaks.
2. Verify the YouTube **embed** in the production build: the `tauri://localhost` origin may make YouTube refuse embedding (errors 152/153). Fallback already shown ("Download for offline"). If it fails, consider `tauri-plugin-localhost` or keep download-first.
3. Verify microphone recording in the bundled app (WKWebView `getUserMedia` + `NSMicrophoneUsageDescription` in `src-tauri/Info.plist`). Unsigned/ad-hoc apps may need the permission granted in System Settings.
4. Try Whisper in the real app on a long Facebook video (speed, progress bar); consider a cancel button and a model picker (base.en for speed / medium.en for accuracy).
5. Code signing/notarization (not done; app is unsigned → right-click → Open the first time).

## Tech stack (installed versions)
- macOS 27 arm64, Node 22.23 + pnpm 10.12, Rust 1.99.1 (rustup, `~/.cargo`; run `source ~/.cargo/env` in new shells).
- Tauri 2.12 (crate 2.12.5, CLI 2.12.4), plugins: dialog 2.8, opener 2.7. Feature `protocol-asset` (serves local media).
- React 19.1, TypeScript 6.0 (strict), Vite 8.3, Tailwind CSS 4.3 (`@tailwindcss/vite`), lucide-react 1.61, vitest 5, ESLint 10 + typescript-eslint 8 + react-hooks 7 (React Compiler rules on).
- Rust crates: rusqlite 0.41 (bundled SQLite), uuid, chrono, thiserror, keyring 3 (macOS Keychain), reqwest 0.12 (rustls), zip 2.
- External CLI tools (not bundled): `~/.local/bin/yt-dlp` (2026.10.21), `~/.local/bin/ffmpeg` + `ffprobe` (9.0.2 arm64, martin-riedl.de build), `~/.local/bin/whisper-cli` (whisper.cpp @231638a, built from `~/.local/src/whisper.cpp` with cmake from `pip3 install cmake`; static, Metal). Found via `tools.rs` search paths (~/.local/bin, ~/bin, /opt/homebrew/bin, /usr/local/bin, PATH).
- Whisper model: `~/.local/share/whisper/ggml-small.en.bin` (466 MB). `tools::find_whisper_model` prefers small.en > base.en > medium.en > any `ggml-*.bin` in ~/.local/share/whisper, ~/Library/Application Support/whisper, /opt/homebrew/share/whisper-cpp.

## Commands
```
pnpm install                 # deps
pnpm tauri dev               # run app (Vite on :1420)
pnpm check                   # typecheck + lint + vitest + cargo test
pnpm tauri build             # → src-tauri/target/release/bundle/{macos/FluentLoop.app, dmg/FluentLoop_0.1.0_aarch64.dmg}
cd src-tauri && cargo clippy --all-targets
pnpm dev → http://localhost:1420/preview.html#workspace   # UI with mock data (screens: dashboard, library, workspace, practice, vault, notes, templates, settings, add, tasks, tts, tts-history, drawer); add ?debug=overflow to list elements wider than the viewport
```

## Architecture
- **Frontend (src/)** calls Rust only through `src/lib/api.ts` (typed `invoke` wrappers; errors are plain strings). Types mirror Rust structs in `src/lib/types.ts` (camelCase) — keep in sync.
- **Backend (src-tauri/src/)**: `lib.rs` registers commands; `state.rs` holds `AppState { lib: Mutex<Option<Library{root, conn}>> }`; every command uses `state.with(|lib| …)`. Long work (copies, yt-dlp, zip) runs in `commands::run_blocking` without holding the mutex.
- Routing is a simple `Route` union in `src/AppContext.tsx` (no router). AppContext also holds: settings (theme, fontScale, transcriptDisplay), background downloads + `download-progress` events, `dataVersion`/`bump()` to refetch lists.
- Player abstraction `src/lib/player.ts` (`PlayerApi`) over `<video>/<audio>` and the YouTube IFrame API. Workspace polls time every 100 ms for active sentence, sentence loop, A-B loop and "play one sentence then stop" (`playSegment`).

## Folder structure (key files)
```
src/App.tsx, AppContext.tsx          shell + global state/routing (Route union; default screen dashboard)
src/lib/nav.ts(+test)                nav items, section tabs, screen→nav mapping
src/components/Shell.tsx, Sidebar.tsx, ScreenHeader.tsx, SectionTabs.tsx   app shell
src/screens/DashboardScreen.tsx, PlaceholderScreen.tsx
src/hooks/useMediaQuery.ts
src/components/                      ui.tsx (Button, Modal, Menu…), feedback.tsx (confirm/toast), NoteEditor (autosave),
                                     RecordingBar, AiAssistDialog, SessionHistory, Sidebar, ScreenHeader, SaveIndicator
src/hooks/useAutosave.ts, useRecorder.ts
src/lib/api.ts, types.ts, format.ts(+test), player.ts, aiPrompts.ts, clipboard.ts
src/screens/LibraryScreen, AddVideoDialog, PracticeHome, VaultScreen, TemplatesScreen, NotesScreen, SettingsScreen
src/screens/workspace/WorkspaceScreen (orchestrator), MediaPlayer, PlayerControls, TranscriptPanel (+SentenceRow),
                     PracticePanel (A/B modes), ImportTranscriptDialog (+ImportTranslationsDialog)
src/dev/preview.tsx + preview.html   dev-only mock-backend preview (not in build)
src-tauri/migrations/001_initial.sql schema v1; 002_recording_transcripts.sql (v2)
src-tauri/src/commands/tts.rs        Kokoro TTS: worker process, tts_generate/status/list/delete/export
src-tauri/tts/kokoro_worker.py       Python worker (embedded into the binary)
scripts/setup-tts.sh                 one-time TTS install (venv + model download)
src/screens/TtsScreen.tsx, src/lib/voices.ts(+test)
src-tauri/src/commands/speech.rs     Whisper: transcribe_media (→ VTT), transcribe_recording (→ recordings.transcript)
src/lib/wordDiff.ts(+test)           LCS word alignment original vs heard (RecordingBar "What I said")
src-tauri/src/db.rs                  open/configure/migrate (PRAGMA user_version), tests
src-tauri/src/parse.rs               TXT/SRT/VTT parsing + sentence segmentation (tests)
src-tauri/src/tools.rs               yt-dlp/ffmpeg/ffprobe discovery + credential-free yt-dlp base command
src-tauri/src/commands/{library,transcript,notes,vault,practice,recordings,templates,ai,settings,backup}.rs
src-tauri/Info.plist                 NSMicrophoneUsageDescription (merged into bundle)
src-tauri/tauri.conf.json            window, CSP, asset protocol, bundle targets app+dmg
```

## Database (SQLite, `<library>/fluentloop.db`, WAL, foreign_keys ON)
Migrations: ordered SQL files in `MIGRATIONS` (db.rs); version = `PRAGMA user_version` (currently **3**). Add `002_*.sql`, append to `MIGRATIONS`, update this section. Opening a DB newer than the app is refused.
- `folders`(id, name, parent_id→folders CASCADE)
- `videos`(id, title, source_url, platform[youtube|facebook|local_video|local_audio|other|none], channel, thumbnail_url, duration_sec, folder_id→folders SET NULL, media_path (relative to library), media_kind[video|audio], media_status[none|downloading|ready|failed], media_error, last_practiced_at)
- `transcripts`(id, video_id UNIQUE→videos CASCADE, source e.g. `srt`/`captions:en`, language)
- `sentences`(id, transcript_id, video_id, position REAL, text, translation (Bengali), start_sec, end_sec, speaker[A|B|U], practice_state[new|practiced|difficult], practice_count, last_practiced_at) — **sentences are the dialogue turns**; `dialogue_turns` is a VIEW over them (decision: one table avoids duplicated text/IDs).
- `notes`(id, entity_type[video|folder|transcript|sentence|saved_sentence|practice_session|template|general], entity_id, title, body, UNIQUE(entity_type, entity_id)) — one note per entity; polymorphic, so AFTER DELETE triggers on each entity table remove orphans. `general` = free notebook pages.
- `saved_sentences`(id, text, normalized UNIQUE (dedupe key), meaning, example, speaker, status, practice_count, last_practiced_at)
- `sentence_sources`(saved_sentence_id CASCADE, video_id SET NULL, sentence_id SET NULL, video_title snapshot, start_sec; UNIQUE(saved, sentence))
- `tags`(name UNIQUE NOCASE; 8 seeded), `sentence_tags`(saved_sentence_id, tag_id)
- `recordings`(id, sentence_id CASCADE | saved_sentence_id CASCADE, file_path relative, mime, duration_sec, transcript [v2: Whisper text, NULL until transcribed])
- `practice_sessions`(id, video_id CASCADE nullable, mode[full|practice_a|hide_a|practice_b|both|random], started_at, ended_at) — empty sessions are deleted on end.
- `practice_attempts`(session_id CASCADE, sentence_id | saved_sentence_id, action[practiced|difficult|skipped|revealed|recorded], recording_id)
- `templates`(id, title, content, category, source_type/id/label), `settings`(key, value)
- `tts_clips`(id, text, voice, speed, file_path relative `tts/<id>.wav`, duration_sec, created_at) — v3
- Recording **files** are deleted by command code (not FK) before deleting videos/sentences/saved sentences.

## Storage & media
- Default library: `~/Library/Application Support/com.fluentloop.app/Library/` with `fluentloop.db`, `media/<videoId>/…`, `recordings/<id>.m4a|webm`, `backups/` (pre-restore safety copies). Location stored in app config dir `config.json` (`libraryPath`). Settings → Change: copy current library to an empty folder, or open/create a library there.
- Asset protocol scope is granted at runtime for the library root (`activate_library`), so `convertFileSrc` can play local media.
- Missing files are detected (`Video.mediaMissing`, Settings → storage).

## Video import & playback limits
- URL import: `fetch_url_metadata` uses `yt-dlp -J` (YouTube oEmbed fallback). Saving always keeps the link.
- Download: `download_media` runs yt-dlp **without cookies/login** (`--no-cookies --no-cookies-from-browser --ignore-config`), `-f bv*+ba/b -S vcodec:h264,res:720,acodec:aac --merge-output-format mp4`, progress via `download-progress` event; the file is verified (non-empty + ffprobe duration) before status `ready`. Private/login/DRM videos fail with a clear message; the link entry stays usable. Facebook is practiced offline only (no embed).
- Captions: `fetch_captions` gets `en,en-US,en-GB,en-orig` VTT (manual preferred). (`en.*` was removed: it matched auto-translated tracks that hit HTTP 429.)
- Playback priority: verified local file → YouTube IFrame embed → placeholder with Download / Attach file / Open in browser.

## Transcript workflow
- Import: paste / TXT / SRT / VTT / online captions, with preview (`preview_transcript`) and Replace or Append. Parser handles YouTube "Show transcript" copies (timestamp lines), `Person A:`/`B:`/`Speaker 1:`/`Name:` prefixes (first two names → A/B), rolling auto-caption de-duplication, abbreviations, Bengali `।`. Unpunctuated auto-captions keep one line per cue.
- **Re-import (Replace) keeps sentence IDs for sentences with identical normalized text**, so notes/saved links/recordings survive corrections. Editing, split (first part keeps id), merge (moves notes, recordings, attempts, sources), move, insert, delete all keep IDs stable.
- Translations: per-sentence edit, bulk paste "one line per sentence", or AI → "Use as Bengali meaning". Display EN / বাংলা / both.

## Speech-to-text (local Whisper)
- Pipeline (`speech.rs`): ffmpeg → 16 kHz mono WAV in a temp `backups/.whisper-<id>/` dir → `whisper-cli -m <model> -l en -t <cores≤8> -pp -np -ovtt|-otxt -of …` → temp dir removed. Progress lines (`progress = N%`) → `transcribe-progress` event `{videoId, percent}`.
- Video: needs local media (`media_status = ready`); returns VTT that the Import dialog previews and imports via the normal path (source `whisper`), so Replace keeps notes of identical sentences. Import dialog defaults to "Transcribe audio" for non-YouTube items with local media.
- Recordings: `RecordingBar` auto-transcribes after saving when whisper + model exist; shows "What I said" with `diffWords` (green match / red not heard / amber extra, "Words matched x/y"), explicitly labelled as a transcript comparison, not a pronunciation score. Hidden in practice/recall until the answer is revealed. `clean_text` strips `[BLANK_AUDIO]`, `(music)` markers.
- Audio never leaves the Mac.

## Text-to-speech (local Kokoro-82M)
- Architecture: no Python backend existed, so Rust (`src-tauri/src/commands/tts.rs`) starts `src-tauri/tts/kokoro_worker.py` (embedded with `include_str!`, written to `<app data>/tts/kokoro_worker.py`) with the venv Python. Protocol: JSON lines over **stdin/stdout pipes, no network port**. The worker loads the model once and stays alive; it exits when stdin closes (app quits) and is killed on drop. stderr → `<app data>/tts/worker.log`.
- Env for the worker: `HF_HOME=<app data>/models/huggingface`, `HF_HUB_OFFLINE=1` (never contacts the network at runtime).
- Install (one time): `./scripts/setup-tts.sh` → uv (`~/.local/bin/uv` 0.13.5) creates `~/.local/share/fluentloop/tts-venv` (Python 3.12; kokoro 0.9.4, misaki 0.9.4, torch 2.14.1, soundfile, spaCy `en_core_web_sm` 3.8.0 wheel), then `kokoro_worker.py --prepare` downloads `kokoro-v1_0.pth` + 28 English voices once into `~/Library/Application Support/com.fluentloop.app/models/huggingface` (327 MB). venv 910 MB. Nothing is in git.
- Chunking: paragraphs → sentences → ≤400-char chunks; pauses 0.15 s between chunks, 0.45 s between paragraphs; joined in order; 24 kHz mono 16-bit PCM WAV written via a `.part` file then renamed. Progress `{done,total}` per chunk → `tts-progress` event (`total = 0` = loading the model).
- Guards: empty text, >10,000 chars, voice not in the 28-voice allow-list, speed outside 0.5–2 are rejected in Rust (`tts::validate`) and again in Python; an `AtomicBool` busy flag rejects a second job while one runs (the button is also disabled). A crashed worker is restarted on the next request.
- Storage: WAVs in `<library>/tts/<id>.wav`, rows in `tts_clips` (schema v3); included in backup/restore and library copy. Voices: `src/lib/voices.ts` must match `tts::VOICES`.
- Licenses: Kokoro model + `kokoro`/`misaki` code Apache-2.0; torch BSD-style/Apache; soundfile BSD; spaCy MIT; **phonemizer-fork / espeak-ng are GPLv3+** (fine for personal local use; matters only if FluentLoop is ever redistributed with them).
- Limits: English only (US/UK voices); no Bengali, no voice cloning (out of scope, not claimed); CPU inference (~2–5× faster than real time on this Mac); no cancel button.

## Practice (Person A/B)
`PracticePanel.tsx` builds items per mode from sentences; prompt = previous sentence. Position is stored per mode by sentence id in localStorage (`fluentloop.practice.<videoId>`), so switching modes keeps progress. Attempts start a DB session lazily. Keys in practice tab: Enter reveal/practiced, ←/→, R replay, D difficult. Vault has its own "Random recall" over saved sentences (mode `random`, video_id NULL).

## AI (optional)
- Providers: OpenAI-compatible (`{endpoint}/chat/completions`, Bearer) or Anthropic (`{endpoint}/messages`, `anthropic-version: 2026-10-21`, default model `claude-opus-5-5`, `fallbacks: "default"` + beta `server-side-fallback-2026-07-01`, handles `stop_reason: refusal`, filters to text blocks; no temperature sent).
- Key stored in macOS Keychain (service `com.fluentloop.app`, account `ai-api-key`) — never in DB/backups. Provider/endpoint/model in `settings`.
- `AiAssistDialog` shows exactly which text goes to which endpoint and sends only on click. Task presets in `src/lib/aiPrompts.ts`. Results → templates / sentence meaning.

## Backup / export
- Backup zip: `manifest.json` (app, schemaVersion, includesMedia) + DB snapshot (`VACUUM INTO`) + `recordings/` + optional `media/`.
- Restore: validates manifest + `PRAGMA integrity_check`, writes `backups/pre-restore-<ts>.db`, closes connection, swaps DB, extracts media/recordings (zip-slip protected, never deletes), reopens + migrates.
- Exports: transcript TXT/SRT/VTT/Markdown-with-notes, vault CSV/TXT (respects filters), all notes Markdown.

## Security & data rules
- No telemetry, no hidden network calls. Network only for: YouTube embed/oEmbed, yt-dlp requests the user starts, AI requests the user sends.
- Never hardcode keys; never use browser cookies/credentials for downloads; never bypass DRM/private access.
- CSP in tauri.conf.json limits scripts/frames to self + YouTube. Capabilities: core, dialog, opener (reveal + open URL).
- Destructive actions use confirm dialogs; restore keeps a safety copy; changing library location never overwrites an existing library.

## Known issues / limitations
- Not yet click-tested in the real window (see Next steps 1).
- YouTube embed may be blocked in production builds (origin `tauri://localhost`); download is the reliable path.
- Pronunciation scoring is not implemented (Whisper comparison only shows which words were recognised). Whisper is English-only (`.en` model, `-l en`); no cancel button for long transcriptions yet.
- Design reference image: `docs/design-reference.png` (Japanese immersion app the UI was inspired by).
- Large transcripts (thousands of lines) render without virtualization — fine for normal videos.
- Sentence "end" time falls back to the next sentence start or start+5 s when missing.
- App is unsigned.
