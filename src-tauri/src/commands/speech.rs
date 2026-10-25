//! Offline speech-to-text with whisper.cpp. Audio never leaves the Mac.
//! Media → 16 kHz mono WAV (ffmpeg) → `whisper-cli` → WebVTT (videos) or plain text (recordings).

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use rusqlite::{OptionalExtension, params};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::library::Captions;
use super::recordings::Recording;
use super::run_blocking;
use crate::error::{AppError, AppResult};
use crate::state::{AppState, BACKUPS_DIR};
use crate::tools;
use crate::util::new_id;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TranscribeProgress {
    video_id: String,
    percent: f64,
}

fn require_whisper() -> AppResult<(PathBuf, PathBuf)> {
    let bin = tools::find_whisper().ok_or_else(|| AppError::invalid("Whisper (whisper-cli) is not installed. See Settings → Media tools."))?;
    let model = tools::find_whisper_model().ok_or_else(|| AppError::invalid("No Whisper model found. Put a ggml model (e.g. ggml-small.en.bin) in ~/.local/share/whisper."))?;
    Ok((bin, model))
}

fn to_wav(src: &Path, dst: &Path) -> AppResult<()> {
    let out = Command::new(tools::require("ffmpeg")?)
        .args(["-v", "error", "-y", "-i"])
        .arg(src)
        .args(["-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(dst)
        .output()?;
    if !out.status.success() {
        return Err(AppError::invalid(format!("Could not read the audio: {}", String::from_utf8_lossy(&out.stderr).trim())));
    }
    Ok(())
}

fn threads() -> String {
    std::thread::available_parallelism().map(|n| n.get().min(8)).unwrap_or(4).to_string()
}

/// Runs whisper-cli and returns the requested output file's content. `on_progress` gets 0–100.
fn run_whisper(wav: &Path, out_prefix: &Path, output_flag: &str, ext: &str, on_progress: impl Fn(f64)) -> AppResult<String> {
    let (bin, model) = require_whisper()?;
    let mut child = Command::new(bin)
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(wav)
        .args(["-l", "en", "-t", &threads(), "-pp", "-np", output_flag, "-of"])
        .arg(out_prefix)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut tail: Vec<String> = Vec::new();
    if let Some(err) = child.stderr.take() {
        for line in BufReader::new(err).lines().map_while(Result::ok) {
            if let Some(p) = line.split("progress =").nth(1)
                && let Ok(v) = p.trim().trim_end_matches('%').trim().parse::<f64>() {
                    on_progress(v);
                }
            tail.push(line);
            if tail.len() > 20 {
                tail.remove(0);
            }
        }
    }
    let status = child.wait()?;
    let out_file = out_prefix.with_extension(ext);
    if !status.success() || !out_file.is_file() {
        let detail = tail.iter().rev().find(|l| l.contains("error")).cloned().unwrap_or_else(|| tail.join("\n"));
        return Err(AppError::invalid(format!("Whisper failed: {detail}")));
    }
    Ok(std::fs::read_to_string(out_file)?)
}

/// Temporary working folder inside the library (removed afterwards).
fn work_dir(root: &Path) -> AppResult<PathBuf> {
    let dir = root.join(BACKUPS_DIR).join(format!(".whisper-{}", new_id()));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Transcribes a video's local media file into WebVTT with timestamps. The frontend previews it
/// and imports it through the normal transcript import (so Replace keeps existing sentence notes).
#[tauri::command]
pub async fn transcribe_media(app: AppHandle, state: State<'_, AppState>, video_id: String) -> AppResult<Captions> {
    let (root, rel) = state.with(|lib| {
        let rel: Option<String> = lib
            .conn
            .query_row("SELECT media_path FROM videos WHERE id = ?1 AND media_status = 'ready'", [&video_id], |r| r.get(0))
            .optional()?
            .flatten();
        Ok((lib.root.clone(), rel))
    })?;
    let rel = rel.ok_or_else(|| AppError::invalid("Download the video or attach a media file first — Whisper needs the audio on this Mac."))?;
    let src = root.join(rel);
    if !src.is_file() {
        return Err(AppError::invalid("The media file is missing"));
    }
    require_whisper()?;
    let work = work_dir(&root)?;
    let w = work.clone();
    let id = video_id.clone();
    let result = run_blocking(move || {
        let wav = w.join("audio.wav");
        to_wav(&src, &wav)?;
        let emit = |percent: f64| {
            let _ = app.emit("transcribe-progress", TranscribeProgress { video_id: id.clone(), percent });
        };
        emit(0.0);
        let content = run_whisper(&wav, &w.join("transcript"), "-ovtt", "vtt", emit)?;
        Ok(Captions { content, language: "en".into(), file_name: "whisper.vtt".into() })
    })
    .await;
    let _ = std::fs::remove_dir_all(&work);
    result
}

/// Transcribes one voice recording and stores the text on the recording.
#[tauri::command]
pub async fn transcribe_recording(state: State<'_, AppState>, recording_id: String) -> AppResult<Recording> {
    let (root, rel) = state.with(|lib| {
        let rel: String = lib
            .conn
            .query_row("SELECT file_path FROM recordings WHERE id = ?1", [&recording_id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| AppError::NotFound("recording".into()))?;
        Ok((lib.root.clone(), rel))
    })?;
    let src = root.join(rel);
    require_whisper()?;
    let work = work_dir(&root)?;
    let w = work.clone();
    let text = run_blocking(move || {
        let wav = w.join("audio.wav");
        to_wav(&src, &wav)?;
        run_whisper(&wav, &w.join("speech"), "-otxt", "txt", |_| {})
    })
    .await;
    let _ = std::fs::remove_dir_all(&work);
    let text = clean_text(&text?);
    state.with(|lib| {
        lib.conn.execute("UPDATE recordings SET transcript = ?1 WHERE id = ?2", params![text, recording_id])?;
        lib.conn.query_row(
            "SELECT id, sentence_id, saved_sentence_id, file_path, mime, duration_sec, created_at, transcript FROM recordings WHERE id = ?1",
            [&recording_id],
            |r| {
                Ok(Recording {
                    id: r.get(0)?,
                    sentence_id: r.get(1)?,
                    saved_sentence_id: r.get(2)?,
                    file_path: lib.root.join(r.get::<_, String>(3)?).display().to_string(),
                    mime: r.get(4)?,
                    duration_sec: r.get(5)?,
                    created_at: r.get(6)?,
                    transcript: r.get(7)?,
                })
            },
        )
        .map_err(Into::into)
    })
}

/// Joins Whisper's lines and drops non-speech markers like "[BLANK_AUDIO]" or "(music)".
pub fn clean_text(raw: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in raw.chars() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_whisper_markers() {
        assert_eq!(clean_text(" [BLANK_AUDIO]\n Hello there,\n how are you? (coughs)\n"), "Hello there, how are you?");
        assert_eq!(clean_text("[MUSIC]"), "");
    }

    /// End-to-end: macOS `say` → ffmpeg → whisper-cli. Needs the local tools, so run with
    /// `cargo test -- --ignored whisper_end_to_end`.
    #[test]
    #[ignore]
    fn whisper_end_to_end() {
        let dir = tempfile::tempdir().unwrap();
        let aiff = dir.path().join("speech.aiff");
        let ok = Command::new("say").arg("-o").arg(&aiff).arg("Could you send me the invoice by Friday?").status().unwrap();
        assert!(ok.success());
        let wav = dir.path().join("a.wav");
        to_wav(&aiff, &wav).unwrap();
        let vtt = run_whisper(&wav, &dir.path().join("t"), "-ovtt", "vtt", |_| {}).unwrap();
        let (_, segs) = crate::parse::parse(&vtt, Some("vtt"));
        let text = segs.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ").to_lowercase();
        assert!(text.contains("invoice"), "{text}");
        assert_eq!(segs[0].start, Some(0.0));
    }
}
