//! Locating and running external command-line tools (yt-dlp, ffmpeg, ffprobe).
//! GUI apps on macOS do not inherit the shell PATH, so common install locations are probed.
//! yt-dlp is always run WITHOUT cookies or credentials: only publicly accessible media is fetched.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};

fn candidates(name: &str) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        v.push(home.join(".local/bin").join(name));
        v.push(home.join("bin").join(name));
    }
    v.push(PathBuf::from("/opt/homebrew/bin").join(name));
    v.push(PathBuf::from("/usr/local/bin").join(name));
    if let Some(path) = std::env::var_os("PATH") {
        v.extend(std::env::split_paths(&path).map(|p| p.join(name)));
    }
    v
}

pub fn find(name: &str) -> Option<PathBuf> {
    candidates(name).into_iter().find(|p| p.is_file())
}

pub fn require(name: &str) -> AppResult<PathBuf> {
    find(name).ok_or_else(|| {
        AppError::invalid(format!("{name} was not found. Install it to ~/.local/bin or /opt/homebrew/bin and try again."))
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub yt_dlp: Option<String>,
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub whisper: Option<String>,
    pub whisper_model: Option<String>,
}

pub fn status() -> ToolsStatus {
    let s = |n: &str| find(n).map(|p| p.display().to_string());
    ToolsStatus {
        yt_dlp: s("yt-dlp"),
        ffmpeg: s("ffmpeg"),
        ffprobe: s("ffprobe"),
        whisper: find_whisper().map(|p| p.display().to_string()),
        whisper_model: find_whisper_model().map(|p| p.display().to_string()),
    }
}

/// whisper.cpp command-line binary (`whisper-cli`; older builds call it `whisper-cpp`).
pub fn find_whisper() -> Option<PathBuf> {
    find("whisper-cli").or_else(|| find("whisper-cpp"))
}

const MODEL_PREFERENCE: &[&str] = &["ggml-small.en.bin", "ggml-base.en.bin", "ggml-medium.en.bin", "ggml-small.bin", "ggml-base.bin", "ggml-tiny.en.bin"];

/// Whisper model file, searched in ~/.local/share/whisper and ~/Library/Application Support/whisper.
pub fn find_whisper_model() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    let dirs = [home.join(".local/share/whisper"), home.join("Library/Application Support/whisper"), PathBuf::from("/opt/homebrew/share/whisper-cpp")];
    for name in MODEL_PREFERENCE {
        if let Some(p) = dirs.iter().map(|d| d.join(name)).find(|p| p.is_file()) {
            return Some(p);
        }
    }
    dirs.iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|e| e == "bin") && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("ggml-")))
}

/// Media duration in seconds via ffprobe. Returns None when ffprobe is missing or the file is unreadable.
pub fn probe_duration(file: &Path) -> Option<f64> {
    let ffprobe = find("ffprobe")?;
    let out = Command::new(ffprobe)
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1"])
        .arg(file)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

/// Whether ffprobe finds at least one video stream (to tell audio-only files apart).
pub fn has_video_stream(file: &Path) -> Option<bool> {
    let ffprobe = find("ffprobe")?;
    let out = Command::new(ffprobe)
        .args(["-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_type", "-of", "csv=p=0"])
        .arg(file)
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).contains("video"))
}

/// Base yt-dlp command with flags that keep it non-interactive and credential-free.
pub fn yt_dlp() -> AppResult<Command> {
    let mut cmd = Command::new(require("yt-dlp")?);
    cmd.args(["--no-playlist", "--no-warnings", "--ignore-config", "--no-cookies", "--no-cookies-from-browser"]);
    if let Some(ffmpeg) = find("ffmpeg") {
        cmd.arg("--ffmpeg-location").arg(ffmpeg);
    }
    Ok(cmd)
}

pub fn error_summary(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let line = text.lines().rev().find(|l| l.contains("ERROR")).or_else(|| text.lines().last()).unwrap_or("Unknown error");
    let msg = line.trim().trim_start_matches("ERROR:").trim().to_string();
    let lower = msg.to_lowercase();
    if lower.contains("login") || lower.contains("cookies") || lower.contains("private") || lower.contains("sign in") {
        format!("{msg}\n\nThis video needs a login or is private. FluentLoop only downloads public videos and does not use your account.")
    } else {
        msg
    }
}
