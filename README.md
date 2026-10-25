# FluentLoop

A local-first macOS app for learning English from YouTube/Facebook videos and your own media files.

- **Library**: save YouTube/Facebook links, download public videos for offline practice, and import local video or audio files. Organise them in folders.
- **Transcript workspace**: paste text or import TXT/SRT/VTT/captions. Click a sentence to jump to that moment in the video, edit, split, merge or reorder sentences, and show English, Bengali or both.
- **Notes everywhere**: notes under any sentence, video, folder, practice session or template, plus free notebook pages. Every note autosaves.
- **Watch & Practice**: loop one sentence, loop an A-B range, change speed, step to the previous or next sentence, show subtitles.
- **Person A / Person B role-play**: full conversation, practice A, hide A, practice B, both roles, and random recall.
- **Voice recording**: record yourself, play it back, and compare it with the original. Recordings stay on your Mac.
- **Offline speech-to-text (Whisper)**: turn a downloaded or attached video's audio into a timestamped transcript, and see your own recordings as text, compared word by word with the original sentence.
- **Text to Speech (offline)**: turn any English text into natural speech with Kokoro-82M (28 US/UK voices, speed control), play it, and download it as WAV. One-time setup: `./scripts/setup-tts.sh`.
- **Copy the transcript with timestamps**: `(0:00) Every business is different. (0:05) A plumber needs…`
- **Sentence Vault**: saved sentences with tags, meanings, examples, notes, source links, practice status, and CSV/TXT export.
- **Optional AI**: Bengali explanations, vocabulary, grammar, more natural English and client/sales templates. Works with any OpenAI-compatible API or with Anthropic. Off until you add a key.
- **Backup & restore**: zip backups, with or without media files, plus a storage overview.

All data lives on your Mac in SQLite plus plain files. There is no account, no cloud and no telemetry.

## Install (from the built DMG)

1. Open `src-tauri/target/release/bundle/dmg/FluentLoop_0.1.0_aarch64.dmg` and drag **FluentLoop** to Applications.
2. The app is not code-signed. The first time, right-click FluentLoop → **Open** → **Open**.
3. For downloads and captions, install `yt-dlp` and `ffmpeg`/`ffprobe` into `~/.local/bin` or `/opt/homebrew/bin`. Settings → Media tools shows whether they were found.
4. For speech-to-text, build [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (`cmake -B build -DBUILD_SHARED_LIBS=OFF && cmake --build build --target whisper-cli`), copy `build/bin/whisper-cli` to `~/.local/bin`, and put a model such as `ggml-small.en.bin` into `~/.local/share/whisper/`.

## Develop

Requirements: Node 22+, pnpm, Rust (via rustup), Xcode Command Line Tools.

```bash
pnpm install
pnpm tauri dev        # run the app
pnpm check            # TypeScript + ESLint + vitest + Rust tests
pnpm tauri build      # builds FluentLoop.app and the .dmg
```

Build output:
- `src-tauri/target/release/bundle/macos/FluentLoop.app`
- `src-tauri/target/release/bundle/dmg/FluentLoop_0.1.0_aarch64.dmg`

UI preview without the Rust backend: run `pnpm dev` and open `http://localhost:1420/preview.html#workspace`. It uses mock data.

Project details, architecture and current status are in [CLAUDE.md](CLAUDE.md).

## Notes on downloads

FluentLoop downloads only **publicly accessible** videos and never uses your browser cookies or accounts. Private, login-only and DRM-protected videos cannot be downloaded. The link is always kept, and you can attach your own copy of the file instead.
