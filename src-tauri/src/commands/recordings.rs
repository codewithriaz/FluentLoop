use rusqlite::params;
use serde::Serialize;
use tauri::State;
use tauri::ipc::{InvokeBody, Request};

use crate::error::{AppError, AppResult};
use crate::state::{AppState, RECORDINGS_DIR};
use crate::util::{clean_opt, new_id, now};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    pub sentence_id: Option<String>,
    pub saved_sentence_id: Option<String>,
    pub file_path: String,
    pub mime: Option<String>,
    pub duration_sec: Option<f64>,
    pub created_at: String,
    /// What Whisper heard in this recording (None until transcribed).
    pub transcript: Option<String>,
}

fn header(req: &Request, name: &str) -> Option<String> {
    clean_opt(req.headers().get(name).and_then(|v| v.to_str().ok()).map(String::from))
}

/// Receives raw audio bytes (from MediaRecorder) as the invoke body; metadata travels in headers.
#[tauri::command]
pub fn save_recording(state: State<AppState>, request: Request<'_>) -> AppResult<Recording> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::invalid("Expected raw audio data"));
    };
    if bytes.is_empty() {
        return Err(AppError::invalid("The recording is empty"));
    }
    let sentence_id = header(&request, "x-sentence-id");
    let saved_id = header(&request, "x-saved-id");
    let mime = header(&request, "x-mime").unwrap_or_else(|| "audio/mp4".into());
    let duration: Option<f64> = header(&request, "x-duration").and_then(|d| d.parse().ok());
    let ext = if mime.contains("webm") { "webm" } else if mime.contains("ogg") { "ogg" } else if mime.contains("wav") { "wav" } else { "m4a" };
    state.with(|lib| {
        let id = new_id();
        let rel = format!("{RECORDINGS_DIR}/{id}.{ext}");
        std::fs::write(lib.abs(&rel), bytes)?;
        let ts = now();
        if let Err(e) = lib.conn.execute(
            "INSERT INTO recordings (id, sentence_id, saved_sentence_id, file_path, mime, duration_sec, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, sentence_id, saved_id, rel, mime, duration, ts],
        ) {
            let _ = std::fs::remove_file(lib.abs(&rel));
            return Err(e.into());
        }
        Ok(Recording {
            id,
            sentence_id,
            saved_sentence_id: saved_id,
            file_path: lib.abs(&rel).display().to_string(),
            mime: Some(mime),
            duration_sec: duration,
            created_at: ts,
            transcript: None,
        })
    })
}

#[tauri::command]
pub fn list_recordings(state: State<AppState>, sentence_id: Option<String>, saved_id: Option<String>) -> AppResult<Vec<Recording>> {
    state.with(|lib| {
        let mut stmt = lib.conn.prepare(
            "SELECT id, sentence_id, saved_sentence_id, file_path, mime, duration_sec, created_at, transcript FROM recordings
             WHERE (?1 IS NOT NULL AND sentence_id = ?1) OR (?2 IS NOT NULL AND saved_sentence_id = ?2) ORDER BY created_at DESC",
        )?;
        let root = lib.root.clone();
        let rows = stmt.query_map(params![sentence_id, saved_id], |r| {
            Ok(Recording {
                id: r.get(0)?,
                sentence_id: r.get(1)?,
                saved_sentence_id: r.get(2)?,
                file_path: root.join(r.get::<_, String>(3)?).display().to_string(),
                mime: r.get(4)?,
                duration_sec: r.get(5)?,
                created_at: r.get(6)?,
                transcript: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    })
}

#[tauri::command]
pub fn delete_recording(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| {
        let rel: Option<String> = rusqlite::OptionalExtension::optional(lib.conn.query_row("SELECT file_path FROM recordings WHERE id = ?1", [&id], |r| r.get(0)))?;
        lib.conn.execute("DELETE FROM recordings WHERE id = ?1", [&id])?;
        if let Some(rel) = rel {
            let _ = std::fs::remove_file(lib.abs(&rel));
        }
        Ok(())
    })
}
