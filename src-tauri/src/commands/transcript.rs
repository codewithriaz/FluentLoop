use std::collections::{HashMap, VecDeque};

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{PRACTICE_STATES, SPEAKERS, check_one_of, delete_recording_files};
use crate::error::{AppError, AppResult};
use crate::parse::{self, Segment};
use crate::state::AppState;
use crate::util::{clean_opt, new_id, normalize_sentence, now};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub id: String,
    pub video_id: String,
    pub source: String,
    pub language: String,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sentence {
    pub id: String,
    pub position: f64,
    pub text: String,
    pub translation: Option<String>,
    pub start_sec: Option<f64>,
    pub end_sec: Option<f64>,
    pub speaker: String,
    pub practice_state: String,
    pub practice_count: i64,
    pub last_practiced_at: Option<String>,
    pub note: Option<String>,
    pub saved_id: Option<String>,
    pub recording_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptData {
    pub transcript: Option<Transcript>,
    pub sentences: Vec<Sentence>,
}

const SENTENCE_SELECT: &str = "SELECT s.id, s.position, s.text, s.translation, s.start_sec, s.end_sec, s.speaker,
    s.practice_state, s.practice_count, s.last_practiced_at, n.body,
    (SELECT ss.saved_sentence_id FROM sentence_sources ss WHERE ss.sentence_id = s.id LIMIT 1),
    (SELECT COUNT(*) FROM recordings r WHERE r.sentence_id = s.id)
    FROM sentences s LEFT JOIN notes n ON n.entity_type = 'sentence' AND n.entity_id = s.id";

fn sentence_from_row(r: &Row) -> rusqlite::Result<Sentence> {
    Ok(Sentence {
        id: r.get(0)?,
        position: r.get(1)?,
        text: r.get(2)?,
        translation: r.get(3)?,
        start_sec: r.get(4)?,
        end_sec: r.get(5)?,
        speaker: r.get(6)?,
        practice_state: r.get(7)?,
        practice_count: r.get(8)?,
        last_practiced_at: r.get(9)?,
        note: r.get(10)?,
        saved_id: r.get(11)?,
        recording_count: r.get(12)?,
    })
}

pub fn load_transcript(conn: &Connection, video_id: &str) -> AppResult<TranscriptData> {
    let transcript = conn
        .query_row(
            "SELECT id, video_id, source, language, updated_at FROM transcripts WHERE video_id = ?1",
            [video_id],
            |r| Ok(Transcript { id: r.get(0)?, video_id: r.get(1)?, source: r.get(2)?, language: r.get(3)?, updated_at: r.get(4)? }),
        )
        .optional()?;
    let mut stmt = conn.prepare(&format!("{SENTENCE_SELECT} WHERE s.video_id = ?1 ORDER BY s.position"))?;
    let sentences = stmt.query_map([video_id], sentence_from_row)?.collect::<Result<_, _>>()?;
    Ok(TranscriptData { transcript, sentences })
}

fn load_sentence(conn: &Connection, id: &str) -> AppResult<Sentence> {
    conn.query_row(&format!("{SENTENCE_SELECT} WHERE s.id = ?1"), [id], sentence_from_row)
        .optional()?
        .ok_or_else(|| AppError::NotFound("sentence".into()))
}

fn ensure_transcript(conn: &Connection, video_id: &str, source: &str) -> AppResult<String> {
    let ts = now();
    if let Some(id) = conn.query_row("SELECT id FROM transcripts WHERE video_id = ?1", [video_id], |r| r.get::<_, String>(0)).optional()? {
        conn.execute("UPDATE transcripts SET source = ?1, updated_at = ?2 WHERE id = ?3", params![source, ts, id])?;
        return Ok(id);
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO transcripts (id, video_id, source, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, video_id, source, ts],
    )?;
    Ok(id)
}

fn recording_paths(conn: &Connection, sentence_ids: &[String]) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    let mut stmt = conn.prepare("SELECT file_path FROM recordings WHERE sentence_id = ?1")?;
    for id in sentence_ids {
        out.extend(stmt.query_map([id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?);
    }
    Ok(out)
}

/// Writes parsed segments. In `replace` mode, existing sentences whose normalized text matches a
/// new segment keep their id, so notes, saved-sentence links and recordings survive a re-import.
/// Returns recording file paths that belonged to removed sentences.
pub fn import_segments(conn: &mut Connection, video_id: &str, segments: &[Segment], source: &str, replace: bool) -> AppResult<Vec<String>> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM videos WHERE id = ?1)", [video_id], |r| r.get(0))?;
    if !exists {
        return Err(AppError::NotFound("video".into()));
    }
    let tx = conn.transaction()?;
    let transcript_id = ensure_transcript(&tx, video_id, source)?;
    let ts = now();
    let mut removed_files = Vec::new();
    let base: f64 = if replace {
        0.0
    } else {
        tx.query_row("SELECT COALESCE(MAX(position), 0) FROM sentences WHERE transcript_id = ?1", [&transcript_id], |r| r.get(0))?
    };
    let mut reusable: HashMap<String, VecDeque<String>> = HashMap::new();
    if replace {
        let mut stmt = tx.prepare("SELECT id, text FROM sentences WHERE transcript_id = ?1 ORDER BY position")?;
        for row in stmt.query_map([&transcript_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (id, text) = row?;
            reusable.entry(normalize_sentence(&text)).or_default().push_back(id);
        }
    }
    {
        let mut update = tx.prepare(
            "UPDATE sentences SET position = ?1, text = ?2, start_sec = ?3, end_sec = ?4,
             speaker = CASE WHEN ?5 = 'U' THEN speaker ELSE ?5 END, updated_at = ?6 WHERE id = ?7",
        )?;
        let mut insert = tx.prepare(
            "INSERT INTO sentences (id, transcript_id, video_id, position, text, start_sec, end_sec, speaker, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        )?;
        for (i, seg) in segments.iter().enumerate() {
            let pos = base + (i + 1) as f64;
            let speaker = seg.speaker.to_string();
            let reuse = reusable.get_mut(&normalize_sentence(&seg.text)).and_then(VecDeque::pop_front);
            match reuse {
                Some(id) => {
                    update.execute(params![pos, seg.text, seg.start, seg.end, speaker, ts, id])?;
                }
                None => {
                    insert.execute(params![new_id(), transcript_id, video_id, pos, seg.text, seg.start, seg.end, speaker, ts])?;
                }
            }
        }
    }
    let leftover: Vec<String> = reusable.into_values().flatten().collect();
    if !leftover.is_empty() {
        removed_files = recording_paths(&tx, &leftover)?;
        let mut del = tx.prepare("DELETE FROM sentences WHERE id = ?1")?;
        for id in &leftover {
            del.execute([id])?;
        }
    }
    tx.execute("UPDATE videos SET updated_at = ?1 WHERE id = ?2", params![ts, video_id])?;
    tx.commit()?;
    Ok(removed_files)
}

#[tauri::command]
pub fn get_transcript(state: State<AppState>, video_id: String) -> AppResult<TranscriptData> {
    state.with(|lib| load_transcript(&lib.conn, &video_id))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub format: String,
    pub segments: Vec<Segment>,
}

#[tauri::command]
pub fn preview_transcript(content: String, format: Option<String>) -> Preview {
    let (fmt, segments) = parse::parse(&content, format.as_deref());
    Preview { format: fmt.as_str().into(), segments }
}

/// Reads a user-selected transcript file (TXT/SRT/VTT) for preview before import.
#[tauri::command]
pub fn read_text_file(path: String) -> AppResult<String> {
    let meta = std::fs::metadata(&path)?;
    if meta.len() > 20 * 1024 * 1024 {
        return Err(AppError::invalid("The file is too large for a transcript (over 20 MB)"));
    }
    let bytes = std::fs::read(&path)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub fn import_transcript(
    state: State<AppState>,
    video_id: String,
    content: String,
    format: Option<String>,
    source: Option<String>,
    replace: bool,
) -> AppResult<TranscriptData> {
    let (fmt, segments) = parse::parse(&content, format.as_deref());
    if segments.is_empty() {
        return Err(AppError::invalid("No sentences were found in the transcript"));
    }
    let source = source.unwrap_or_else(|| fmt.as_str().to_string());
    state.with(|lib| {
        let files = import_segments(&mut lib.conn, &video_id, &segments, &source, replace)?;
        delete_recording_files(&lib.root, &files);
        load_transcript(&lib.conn, &video_id)
    })
}

/// Assigns one translation line per sentence, in order. Blank lines are skipped.
#[tauri::command]
pub fn import_translations(state: State<AppState>, video_id: String, content: String) -> AppResult<TranscriptData> {
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let ids: Vec<String> = {
            let mut stmt = tx.prepare("SELECT id FROM sentences WHERE video_id = ?1 ORDER BY position")?;
            stmt.query_map([&video_id], |r| r.get(0))?.collect::<Result<_, _>>()?
        };
        let ts = now();
        for (id, line) in ids.iter().zip(content.lines().map(str::trim).filter(|l| !l.is_empty())) {
            tx.execute("UPDATE sentences SET translation = ?1, updated_at = ?2 WHERE id = ?3", params![line, ts, id])?;
        }
        tx.commit()?;
        load_transcript(&lib.conn, &video_id)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentencePatch {
    pub text: Option<String>,
    /// Empty string clears the translation.
    pub translation: Option<String>,
    pub speaker: Option<String>,
    pub start_sec: Option<f64>,
    pub end_sec: Option<f64>,
    pub clear_times: Option<bool>,
}

#[tauri::command]
pub fn update_sentence(state: State<AppState>, id: String, patch: SentencePatch) -> AppResult<Sentence> {
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let ts = now();
        if let Some(text) = patch.text {
            let text = text.trim();
            if text.is_empty() {
                return Err(AppError::invalid("Sentence text cannot be empty"));
            }
            tx.execute("UPDATE sentences SET text = ?1, updated_at = ?2 WHERE id = ?3", params![text, ts, id])?;
        }
        if let Some(t) = patch.translation {
            tx.execute("UPDATE sentences SET translation = ?1, updated_at = ?2 WHERE id = ?3", params![clean_opt(Some(t)), ts, id])?;
        }
        if let Some(sp) = patch.speaker {
            check_one_of(&sp, SPEAKERS, "speaker")?;
            tx.execute("UPDATE sentences SET speaker = ?1, updated_at = ?2 WHERE id = ?3", params![sp, ts, id])?;
        }
        if patch.clear_times.unwrap_or(false) {
            tx.execute("UPDATE sentences SET start_sec = NULL, end_sec = NULL, updated_at = ?1 WHERE id = ?2", params![ts, id])?;
        }
        if let Some(s) = patch.start_sec {
            tx.execute("UPDATE sentences SET start_sec = ?1, updated_at = ?2 WHERE id = ?3", params![s.max(0.0), ts, id])?;
        }
        if let Some(e) = patch.end_sec {
            tx.execute("UPDATE sentences SET end_sec = ?1, updated_at = ?2 WHERE id = ?3", params![e.max(0.0), ts, id])?;
        }
        tx.commit()?;
        load_sentence(&lib.conn, &id)
    })
}

fn sentence_pos(conn: &Connection, id: &str) -> AppResult<(String, f64)> {
    conn.query_row("SELECT transcript_id, position FROM sentences WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| AppError::NotFound("sentence".into()))
}

fn neighbor(conn: &Connection, transcript_id: &str, pos: f64, after: bool) -> AppResult<Option<(String, f64)>> {
    let sql = if after {
        "SELECT id, position FROM sentences WHERE transcript_id = ?1 AND position > ?2 ORDER BY position LIMIT 1"
    } else {
        "SELECT id, position FROM sentences WHERE transcript_id = ?1 AND position < ?2 ORDER BY position DESC LIMIT 1"
    };
    Ok(conn.query_row(sql, params![transcript_id, pos], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
}

fn renumber(conn: &Connection, transcript_id: &str) -> AppResult<()> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM sentences WHERE transcript_id = ?1 ORDER BY position")?;
        stmt.query_map([transcript_id], |r| r.get(0))?.collect::<Result<_, _>>()?
    };
    for (i, id) in ids.iter().enumerate() {
        conn.execute("UPDATE sentences SET position = ?1 WHERE id = ?2", params![(i + 1) as f64, id])?;
    }
    Ok(())
}

/// Position strictly between `pos` and the next sentence (renumbering first when the gap is exhausted).
fn position_after(conn: &Connection, transcript_id: &str, after: Option<&str>) -> AppResult<f64> {
    let (pos, next) = match after {
        Some(id) => {
            let (_, p) = sentence_pos(conn, id)?;
            (p, neighbor(conn, transcript_id, p, true)?.map(|n| n.1))
        }
        None => {
            let first: Option<f64> = conn.query_row("SELECT MIN(position) FROM sentences WHERE transcript_id = ?1", [transcript_id], |r| r.get(0))?;
            return Ok(first.map(|f| f - 1.0).unwrap_or(1.0));
        }
    };
    match next {
        Some(n) if n - pos < 1e-6 => {
            renumber(conn, transcript_id)?;
            position_after(conn, transcript_id, after)
        }
        Some(n) => Ok((pos + n) / 2.0),
        None => Ok(pos + 1.0),
    }
}

#[tauri::command]
pub fn insert_sentence(state: State<AppState>, video_id: String, after_id: Option<String>, text: String) -> AppResult<Sentence> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::invalid("Sentence text cannot be empty"));
    }
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let transcript_id = ensure_transcript(&tx, &video_id, "manual")?;
        let pos = position_after(&tx, &transcript_id, after_id.as_deref())?;
        let id = new_id();
        let ts = now();
        tx.execute(
            "INSERT INTO sentences (id, transcript_id, video_id, position, text, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, transcript_id, video_id, pos, text, ts],
        )?;
        tx.commit()?;
        load_sentence(&lib.conn, &id)
    })
}

#[tauri::command]
pub fn delete_sentence(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| {
        let files = recording_paths(&lib.conn, std::slice::from_ref(&id))?;
        lib.conn.execute("DELETE FROM sentences WHERE id = ?1", [&id])?;
        delete_recording_files(&lib.root, &files);
        Ok(())
    })
}

/// Merges a sentence with the following one, keeping the first id and moving notes,
/// recordings, practice attempts and saved-sentence links over.
pub fn merge_next(conn: &mut Connection, id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let (tid, pos) = sentence_pos(&tx, id)?;
    let (next_id, _) = neighbor(&tx, &tid, pos, true)?.ok_or_else(|| AppError::invalid("There is no following sentence"))?;
    type Parts = (String, Option<String>, Option<f64>, Option<f64>);
    let get = |sid: &str| -> rusqlite::Result<Parts> {
        tx.query_row("SELECT text, translation, start_sec, end_sec FROM sentences WHERE id = ?1", [sid], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
    };
    let (t1, tr1, s1, e1) = get(id)?;
    let (t2, tr2, s2, e2) = get(&next_id)?;
    let translation = match (tr1, tr2) {
        (Some(a), Some(b)) => Some(format!("{a} {b}")),
        (a, b) => a.or(b),
    };
    tx.execute(
        "UPDATE sentences SET text = ?1, translation = ?2, start_sec = ?3, end_sec = ?4, updated_at = ?5 WHERE id = ?6",
        params![format!("{t1} {t2}"), translation, s1.or(s2), e2.or(e1), now(), id],
    )?;
    let note = |sid: &str| -> rusqlite::Result<Option<String>> {
        tx.query_row("SELECT body FROM notes WHERE entity_type = 'sentence' AND entity_id = ?1", [sid], |r| r.get(0)).optional()
    };
    if let Some(next_note) = note(&next_id)? {
        match note(id)? {
            Some(mine) => {
                tx.execute(
                    "UPDATE notes SET body = ?1, updated_at = ?2 WHERE entity_type = 'sentence' AND entity_id = ?3",
                    params![format!("{mine}\n\n{next_note}"), now(), id],
                )?;
                tx.execute("DELETE FROM notes WHERE entity_type = 'sentence' AND entity_id = ?1", [&next_id])?;
            }
            None => {
                tx.execute("UPDATE notes SET entity_id = ?1 WHERE entity_type = 'sentence' AND entity_id = ?2", params![id, next_id])?;
            }
        }
    }
    tx.execute("UPDATE recordings SET sentence_id = ?1 WHERE sentence_id = ?2", params![id, next_id])?;
    tx.execute("UPDATE practice_attempts SET sentence_id = ?1 WHERE sentence_id = ?2", params![id, next_id])?;
    tx.execute("UPDATE OR IGNORE sentence_sources SET sentence_id = ?1 WHERE sentence_id = ?2", params![id, next_id])?;
    tx.execute("DELETE FROM sentence_sources WHERE sentence_id = ?1", [&next_id])?;
    tx.execute("DELETE FROM sentences WHERE id = ?1", [&next_id])?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn merge_sentence_with_next(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| merge_next(&mut lib.conn, &id))
}

/// Splits a sentence at a character index; the first part keeps the id (and its note).
#[tauri::command]
pub fn split_sentence(state: State<AppState>, id: String, at: usize) -> AppResult<()> {
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let (tid, _) = sentence_pos(&tx, &id)?;
        let (text, start, end, speaker, video_id): (String, Option<f64>, Option<f64>, String, String) = tx.query_row(
            "SELECT text, start_sec, end_sec, speaker, video_id FROM sentences WHERE id = ?1",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;
        let chars: Vec<char> = text.chars().collect();
        let first: String = chars[..at.min(chars.len())].iter().collect::<String>().trim().to_string();
        let second: String = chars[at.min(chars.len())..].iter().collect::<String>().trim().to_string();
        if first.is_empty() || second.is_empty() {
            return Err(AppError::invalid("Place the cursor inside the sentence to split it"));
        }
        let mid = match (start, end) {
            (Some(s), Some(e)) => Some(s + (e - s) * (at as f64 / chars.len().max(1) as f64)),
            _ => None,
        };
        let ts = now();
        tx.execute(
            "UPDATE sentences SET text = ?1, end_sec = COALESCE(?2, end_sec), updated_at = ?3 WHERE id = ?4",
            params![first, mid, ts, id],
        )?;
        let pos = position_after(&tx, &tid, Some(&id))?;
        tx.execute(
            "INSERT INTO sentences (id, transcript_id, video_id, position, text, start_sec, end_sec, speaker, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![new_id(), tid, video_id, pos, second, mid.or(start), end, speaker, ts],
        )?;
        tx.commit()?;
        Ok(())
    })
}

#[tauri::command]
pub fn move_sentence(state: State<AppState>, id: String, direction: i32) -> AppResult<()> {
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let (tid, pos) = sentence_pos(&tx, &id)?;
        if let Some((other, other_pos)) = neighbor(&tx, &tid, pos, direction > 0)? {
            tx.execute("UPDATE sentences SET position = ?1 WHERE id = ?2", params![other_pos, id])?;
            tx.execute("UPDATE sentences SET position = ?1 WHERE id = ?2", params![pos, other])?;
        }
        tx.commit()?;
        Ok(())
    })
}

#[tauri::command]
pub fn set_speakers(state: State<AppState>, ids: Vec<String>, speaker: String) -> AppResult<()> {
    check_one_of(&speaker, SPEAKERS, "speaker")?;
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let ts = now();
        for id in &ids {
            tx.execute("UPDATE sentences SET speaker = ?1, updated_at = ?2 WHERE id = ?3", params![speaker, ts, id])?;
        }
        tx.commit()?;
        Ok(())
    })
}

/// Labels sentences alternately A, B, A, B… starting at `from_id` (or the first sentence).
#[tauri::command]
pub fn alternate_speakers(state: State<AppState>, video_id: String, from_id: Option<String>, first: String) -> AppResult<TranscriptData> {
    check_one_of(&first, &["A", "B"], "speaker")?;
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let ids: Vec<String> = {
            let mut stmt = tx.prepare("SELECT id FROM sentences WHERE video_id = ?1 ORDER BY position")?;
            stmt.query_map([&video_id], |r| r.get(0))?.collect::<Result<_, _>>()?
        };
        let start = from_id.and_then(|f| ids.iter().position(|i| *i == f)).unwrap_or(0);
        let ts = now();
        for (n, id) in ids[start..].iter().enumerate() {
            let sp = if (n % 2 == 0) == (first == "A") { "A" } else { "B" };
            tx.execute("UPDATE sentences SET speaker = ?1, updated_at = ?2 WHERE id = ?3", params![sp, ts, id])?;
        }
        tx.commit()?;
        load_transcript(&lib.conn, &video_id)
    })
}

pub fn apply_practice_state(conn: &Connection, sentence_id: &str, state: &str) -> AppResult<()> {
    check_one_of(state, PRACTICE_STATES, "practice state")?;
    let ts = now();
    if state == "new" {
        conn.execute("UPDATE sentences SET practice_state = 'new', updated_at = ?1 WHERE id = ?2", params![ts, sentence_id])?;
    } else {
        conn.execute(
            "UPDATE sentences SET practice_state = ?1, practice_count = practice_count + 1, last_practiced_at = ?2, updated_at = ?2 WHERE id = ?3",
            params![state, ts, sentence_id],
        )?;
        conn.execute(
            "UPDATE videos SET last_practiced_at = ?1 WHERE id = (SELECT video_id FROM sentences WHERE id = ?2)",
            params![ts, sentence_id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_practice_state(state: State<AppState>, sentence_id: String, practice_state: String) -> AppResult<Sentence> {
    state.with(|lib| {
        apply_practice_state(&lib.conn, &sentence_id, &practice_state)?;
        load_sentence(&lib.conn, &sentence_id)
    })
}

fn srt_time(t: f64, sep: char) -> String {
    let ms = (t.max(0.0) * 1000.0).round() as u64;
    format!("{:02}:{:02}:{:02}{}{:03}", ms / 3_600_000, (ms / 60_000) % 60, (ms / 1000) % 60, sep, ms % 1000)
}

pub fn render_transcript(title: &str, sentences: &[Sentence], format: &str) -> String {
    let speaker = |s: &Sentence| match s.speaker.as_str() {
        "A" => "Person A: ",
        "B" => "Person B: ",
        _ => "",
    };
    let mut out = String::new();
    match format {
        "srt" | "vtt" => {
            if format == "vtt" {
                out.push_str("WEBVTT\n\n");
            }
            let sep = if format == "srt" { ',' } else { '.' };
            for (i, s) in sentences.iter().enumerate() {
                let start = s.start_sec.unwrap_or(0.0);
                // Missing end: run until the next timed sentence (max 8 s), else 3 s.
                let next = sentences[i + 1..].iter().find_map(|n| n.start_sec).filter(|n| *n > start);
                let end = s.end_sec.filter(|e| *e > start).unwrap_or_else(|| next.map(|n| n.min(start + 8.0)).unwrap_or(start + 3.0));
                if format == "srt" {
                    out.push_str(&format!("{}\n", i + 1));
                }
                out.push_str(&format!("{} --> {}\n{}\n\n", srt_time(start, sep), srt_time(end, sep), s.text));
            }
        }
        "md" => {
            out.push_str(&format!("# {title}\n\n"));
            for s in sentences {
                out.push_str(&format!("- **{}{}**\n", speaker(s), s.text));
                if let Some(t) = &s.translation {
                    out.push_str(&format!("  - {t}\n"));
                }
                if let Some(n) = &s.note {
                    for line in n.lines() {
                        out.push_str(&format!("  > {line}\n"));
                    }
                }
            }
        }
        _ => {
            for s in sentences {
                out.push_str(&format!("{}{}\n", speaker(s), s.text));
            }
        }
    }
    out
}

#[tauri::command]
pub fn export_transcript(state: State<AppState>, video_id: String, path: String, format: String) -> AppResult<()> {
    state.with(|lib| {
        let title: String = lib.conn.query_row("SELECT title FROM videos WHERE id = ?1", [&video_id], |r| r.get(0))?;
        let data = load_transcript(&lib.conn, &video_id)?;
        std::fs::write(&path, render_transcript(&title, &data.sentences, &format))?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;

    fn seg(text: &str) -> Segment {
        Segment { text: text.into(), start: Some(1.0), end: Some(2.0), speaker: 'U' }
    }

    fn setup() -> Connection {
        let conn = open_memory();
        conn.execute("INSERT INTO videos (id,title,platform,created_at,updated_at) VALUES ('v','T','none','x','x')", []).unwrap();
        conn
    }

    #[test]
    fn reimport_preserves_ids_and_notes() {
        let mut conn = setup();
        import_segments(&mut conn, "v", &[seg("Hello there."), seg("How are you?")], "txt", true).unwrap();
        let before = load_transcript(&conn, "v").unwrap();
        let keep_id = before.sentences[1].id.clone();
        conn.execute(
            "INSERT INTO notes (id,entity_type,entity_id,body,created_at,updated_at) VALUES ('n','sentence',?1,'my note','x','x')",
            [&keep_id],
        )
        .unwrap();
        import_segments(&mut conn, "v", &[seg("Hi!"), seg("how are you")], "srt", true).unwrap();
        let after = load_transcript(&conn, "v").unwrap();
        assert_eq!(after.sentences.len(), 2);
        assert_eq!(after.sentences[1].id, keep_id);
        assert_eq!(after.sentences[1].note.as_deref(), Some("my note"));
        assert_eq!(after.transcript.unwrap().source, "srt");
    }

    #[test]
    fn append_adds_to_end() {
        let mut conn = setup();
        import_segments(&mut conn, "v", &[seg("One.")], "txt", true).unwrap();
        import_segments(&mut conn, "v", &[seg("Two.")], "txt", false).unwrap();
        let t: Vec<String> = load_transcript(&conn, "v").unwrap().sentences.into_iter().map(|s| s.text).collect();
        assert_eq!(t, vec!["One.", "Two."]);
    }

    #[test]
    fn merge_moves_note() {
        let mut conn = setup();
        import_segments(&mut conn, "v", &[seg("One."), seg("Two.")], "txt", true).unwrap();
        let s = load_transcript(&conn, "v").unwrap().sentences;
        conn.execute(
            "INSERT INTO notes (id,entity_type,entity_id,body,created_at,updated_at) VALUES ('n','sentence',?1,'second','x','x')",
            [&s[1].id],
        )
        .unwrap();
        merge_next(&mut conn, &s[0].id).unwrap();
        let after = load_transcript(&conn, "v").unwrap().sentences;
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].text, "One. Two.");
        assert_eq!(after[0].note.as_deref(), Some("second"));
    }

    #[test]
    fn position_after_inserts_between() {
        let mut conn = setup();
        import_segments(&mut conn, "v", &[seg("A."), seg("B.")], "txt", true).unwrap();
        let s = load_transcript(&conn, "v").unwrap();
        let tid = s.transcript.unwrap().id;
        let p = position_after(&conn, &tid, Some(&s.sentences[0].id)).unwrap();
        assert!(p > 1.0 && p < 2.0);
        assert_eq!(position_after(&conn, &tid, None).unwrap(), 0.0);
    }

    #[test]
    fn render_srt() {
        let s = Sentence {
            id: "i".into(), position: 1.0, text: "Hi.".into(), translation: None, start_sec: Some(61.5), end_sec: Some(62.0),
            speaker: "A".into(), practice_state: "new".into(), practice_count: 0, last_practiced_at: None, note: None, saved_id: None, recording_count: 0,
        };
        assert_eq!(render_transcript("t", &[s], "srt"), "1\n00:01:01,500 --> 00:01:02,000\nHi.\n\n");
    }

    #[test]
    fn render_vtt_fills_missing_end_from_next_sentence() {
        let mk = |text: &str, start: f64| Sentence {
            id: text.into(), position: 0.0, text: text.into(), translation: None, start_sec: Some(start), end_sec: None,
            speaker: "U".into(), practice_state: "new".into(), practice_count: 0, last_practiced_at: None, note: None, saved_id: None, recording_count: 0,
        };
        let out = render_transcript("t", &[mk("One.", 0.0), mk("Two.", 5.0)], "vtt");
        assert!(out.starts_with("WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nOne.\n\n00:00:05.000 --> 00:00:08.000\nTwo."), "{out}");
    }
}
