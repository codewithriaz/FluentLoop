pub mod ai;
pub mod backup;
pub mod library;
pub mod notes;
pub mod practice;
pub mod recordings;
pub mod settings;
pub mod speech;
pub mod templates;
pub mod transcript;
pub mod tts;
pub mod vault;

use std::path::Path;

use crate::error::{AppError, AppResult};

/// Runs blocking work (file copies, subprocesses) off the async runtime.
pub async fn run_blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| AppError::invalid(e.to_string()))?
}

/// Best-effort removal of recording files whose rows are being deleted.
pub fn delete_recording_files(root: &Path, rel_paths: &[String]) {
    for rel in rel_paths {
        let _ = std::fs::remove_file(root.join(rel));
    }
}

pub const SPEAKERS: &[&str] = &["A", "B", "U"];
pub const PRACTICE_STATES: &[&str] = &["new", "practiced", "difficult"];

pub fn check_one_of(value: &str, allowed: &[&str], what: &str) -> AppResult<()> {
    if allowed.contains(&value) { Ok(()) } else { Err(AppError::invalid(format!("Invalid {what}: {value}"))) }
}
