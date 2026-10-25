use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{PRACTICE_STATES, SPEAKERS, check_one_of, delete_recording_files};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::util::{clean_opt, new_id, normalize_sentence, now};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub video_id: Option<String>,
    pub sentence_id: Option<String>,
    pub video_title: Option<String>,
    pub start_sec: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSentence {
    pub id: String,
    pub text: String,
    pub meaning: Option<String>,
    pub example: Option<String>,
    pub speaker: String,
    pub status: String,
    pub practice_count: i64,
    pub last_practiced_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub note: Option<String>,
    pub recording_count: i64,
    pub tags: Vec<Tag>,
    pub sources: Vec<Source>,
}

const SAVED_SELECT: &str = "SELECT s.id, s.text, s.meaning, s.example, s.speaker, s.status, s.practice_count, s.last_practiced_at,
    s.created_at, s.updated_at, n.body, (SELECT COUNT(*) FROM recordings r WHERE r.saved_sentence_id = s.id)
    FROM saved_sentences s LEFT JOIN notes n ON n.entity_type = 'saved_sentence' AND n.entity_id = s.id";

fn hydrate(conn: &Connection, mut item: SavedSentence) -> AppResult<SavedSentence> {
    let mut tags = conn.prepare(
        "SELECT t.id, t.name FROM tags t JOIN sentence_tags st ON st.tag_id = t.id WHERE st.saved_sentence_id = ?1 ORDER BY t.name",
    )?;
    item.tags = tags.query_map([&item.id], |r| Ok(Tag { id: r.get(0)?, name: r.get(1)?, count: 0 }))?.collect::<Result<_, _>>()?;
    let mut src = conn.prepare(
        "SELECT ss.id, ss.video_id, ss.sentence_id, COALESCE(v.title, ss.video_title), COALESCE(se.start_sec, ss.start_sec)
         FROM sentence_sources ss LEFT JOIN videos v ON v.id = ss.video_id LEFT JOIN sentences se ON se.id = ss.sentence_id
         WHERE ss.saved_sentence_id = ?1 ORDER BY ss.created_at",
    )?;
    item.sources = src
        .query_map([&item.id], |r| {
            Ok(Source { id: r.get(0)?, video_id: r.get(1)?, sentence_id: r.get(2)?, video_title: r.get(3)?, start_sec: r.get(4)? })
        })?
        .collect::<Result<_, _>>()?;
    Ok(item)
}

fn row_to_saved(r: &rusqlite::Row) -> rusqlite::Result<SavedSentence> {
    Ok(SavedSentence {
        id: r.get(0)?,
        text: r.get(1)?,
        meaning: r.get(2)?,
        example: r.get(3)?,
        speaker: r.get(4)?,
        status: r.get(5)?,
        practice_count: r.get(6)?,
        last_practiced_at: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
        note: r.get(10)?,
        recording_count: r.get(11)?,
        tags: vec![],
        sources: vec![],
    })
}

pub fn load_saved(conn: &Connection, id: &str) -> AppResult<SavedSentence> {
    let item = conn
        .query_row(&format!("{SAVED_SELECT} WHERE s.id = ?1"), [id], row_to_saved)
        .optional()?
        .ok_or_else(|| AppError::NotFound("saved sentence".into()))?;
    hydrate(conn, item)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInput {
    pub text: String,
    pub meaning: Option<String>,
    pub speaker: Option<String>,
    pub video_id: Option<String>,
    pub sentence_id: Option<String>,
    pub start_sec: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub saved: SavedSentence,
    pub created: bool,
}

/// Saves a sentence to the vault. An existing entry with the same normalized text is reused and
/// the new location is added as another source, so phrases are not duplicated.
pub fn save(conn: &mut Connection, input: SaveInput) -> AppResult<SaveResult> {
    let text = input.text.trim().to_string();
    let normalized = normalize_sentence(&text);
    if normalized.is_empty() {
        return Err(AppError::invalid("Sentence text cannot be empty"));
    }
    let speaker = input.speaker.unwrap_or_else(|| "U".into());
    check_one_of(&speaker, SPEAKERS, "speaker")?;
    let tx = conn.transaction()?;
    let ts = now();
    let existing: Option<String> = tx.query_row("SELECT id FROM saved_sentences WHERE normalized = ?1", [&normalized], |r| r.get(0)).optional()?;
    let created = existing.is_none();
    let id = match existing {
        Some(id) => {
            if let Some(m) = clean_opt(input.meaning.clone()) {
                tx.execute("UPDATE saved_sentences SET meaning = COALESCE(meaning, ?1), updated_at = ?2 WHERE id = ?3", params![m, ts, id])?;
            }
            id
        }
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO saved_sentences (id, text, normalized, meaning, speaker, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![id, text, normalized, clean_opt(input.meaning), speaker, ts],
            )?;
            id
        }
    };
    if input.video_id.is_some() || input.sentence_id.is_some() {
        let title: Option<String> = match &input.video_id {
            Some(v) => tx.query_row("SELECT title FROM videos WHERE id = ?1", [v], |r| r.get(0)).optional()?,
            None => None,
        };
        tx.execute(
            "INSERT OR IGNORE INTO sentence_sources (id, saved_sentence_id, video_id, sentence_id, video_title, start_sec, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![new_id(), id, input.video_id, input.sentence_id, title, input.start_sec, ts],
        )?;
    }
    tx.commit()?;
    Ok(SaveResult { saved: load_saved(conn, &id)?, created })
}

#[tauri::command]
pub fn save_sentence(state: State<AppState>, input: SaveInput) -> AppResult<SaveResult> {
    state.with(|lib| save(&mut lib.conn, input))
}

/// Removes the link between a transcript sentence and the vault. The vault entry itself is
/// deleted only when nothing else references it and it carries no personal data.
#[tauri::command]
pub fn unsave_sentence(state: State<AppState>, sentence_id: String) -> AppResult<()> {
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let saved_ids: Vec<String> = {
            let mut stmt = tx.prepare("SELECT saved_sentence_id FROM sentence_sources WHERE sentence_id = ?1")?;
            stmt.query_map([&sentence_id], |r| r.get(0))?.collect::<Result<_, _>>()?
        };
        tx.execute("DELETE FROM sentence_sources WHERE sentence_id = ?1", [&sentence_id])?;
        for id in saved_ids {
            tx.execute(
                "DELETE FROM saved_sentences WHERE id = ?1
                 AND NOT EXISTS (SELECT 1 FROM sentence_sources WHERE saved_sentence_id = ?1)
                 AND NOT EXISTS (SELECT 1 FROM sentence_tags WHERE saved_sentence_id = ?1)
                 AND NOT EXISTS (SELECT 1 FROM notes WHERE entity_type = 'saved_sentence' AND entity_id = ?1)
                 AND NOT EXISTS (SELECT 1 FROM recordings WHERE saved_sentence_id = ?1)
                 AND meaning IS NULL AND example IS NULL",
                [&id],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultFilter {
    pub search: Option<String>,
    pub tag_id: Option<String>,
    pub speaker: Option<String>,
    pub status: Option<String>,
    /// "unpracticed" (never practiced) is accepted alongside the stored statuses.
    pub sort: Option<String>,
}

pub fn list(conn: &Connection, f: VaultFilter) -> AppResult<Vec<SavedSentence>> {
    let mut sql = format!("{SAVED_SELECT} WHERE 1=1");
    let mut args: Vec<String> = Vec::new();
    if let Some(s) = clean_opt(f.search) {
        args.push(format!("%{s}%"));
        let n = args.len();
        sql.push_str(&format!(" AND (s.text LIKE ?{n} OR s.meaning LIKE ?{n} OR s.example LIKE ?{n} OR n.body LIKE ?{n})"));
    }
    if let Some(t) = clean_opt(f.tag_id) {
        args.push(t);
        sql.push_str(&format!(" AND EXISTS (SELECT 1 FROM sentence_tags st WHERE st.saved_sentence_id = s.id AND st.tag_id = ?{})", args.len()));
    }
    if let Some(sp) = clean_opt(f.speaker) {
        args.push(sp);
        sql.push_str(&format!(" AND s.speaker = ?{}", args.len()));
    }
    match clean_opt(f.status).as_deref() {
        Some("unpracticed") => sql.push_str(" AND s.practice_count = 0"),
        Some(st) => {
            args.push(st.to_string());
            sql.push_str(&format!(" AND s.status = ?{}", args.len()));
        }
        None => {}
    }
    sql.push_str(match f.sort.as_deref() {
        Some("alpha") => " ORDER BY s.text COLLATE NOCASE",
        Some("practiced") => " ORDER BY s.last_practiced_at IS NULL, s.last_practiced_at",
        _ => " ORDER BY s.created_at DESC",
    });
    let items: Vec<SavedSentence> = {
        let mut stmt = conn.prepare(&sql)?;
        stmt.query_map(rusqlite::params_from_iter(args.iter()), row_to_saved)?.collect::<Result<_, _>>()?
    };
    items.into_iter().map(|i| hydrate(conn, i)).collect()
}

#[tauri::command]
pub fn list_saved(state: State<AppState>, filter: VaultFilter) -> AppResult<Vec<SavedSentence>> {
    state.with(|lib| list(&lib.conn, filter))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPatch {
    pub text: Option<String>,
    pub meaning: Option<String>,
    pub example: Option<String>,
    pub speaker: Option<String>,
    pub status: Option<String>,
}

#[tauri::command]
pub fn update_saved(state: State<AppState>, id: String, patch: SavedPatch) -> AppResult<SavedSentence> {
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let ts = now();
        if let Some(text) = patch.text {
            let normalized = normalize_sentence(&text);
            if normalized.is_empty() {
                return Err(AppError::invalid("Sentence text cannot be empty"));
            }
            let clash: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM saved_sentences WHERE normalized = ?1 AND id != ?2)",
                params![normalized, id],
                |r| r.get(0),
            )?;
            if clash {
                return Err(AppError::invalid("This sentence already exists in the vault"));
            }
            tx.execute(
                "UPDATE saved_sentences SET text = ?1, normalized = ?2, updated_at = ?3 WHERE id = ?4",
                params![text.trim(), normalized, ts, id],
            )?;
        }
        if let Some(m) = patch.meaning {
            tx.execute("UPDATE saved_sentences SET meaning = ?1, updated_at = ?2 WHERE id = ?3", params![clean_opt(Some(m)), ts, id])?;
        }
        if let Some(e) = patch.example {
            tx.execute("UPDATE saved_sentences SET example = ?1, updated_at = ?2 WHERE id = ?3", params![clean_opt(Some(e)), ts, id])?;
        }
        if let Some(sp) = patch.speaker {
            check_one_of(&sp, SPEAKERS, "speaker")?;
            tx.execute("UPDATE saved_sentences SET speaker = ?1, updated_at = ?2 WHERE id = ?3", params![sp, ts, id])?;
        }
        if let Some(st) = patch.status {
            apply_status(&tx, &id, &st)?;
        }
        tx.commit()?;
        load_saved(&lib.conn, &id)
    })
}

pub fn apply_status(conn: &Connection, id: &str, status: &str) -> AppResult<()> {
    check_one_of(status, PRACTICE_STATES, "status")?;
    let ts = now();
    if status == "new" {
        conn.execute("UPDATE saved_sentences SET status = 'new', updated_at = ?1 WHERE id = ?2", params![ts, id])?;
    } else {
        conn.execute(
            "UPDATE saved_sentences SET status = ?1, practice_count = practice_count + 1, last_practiced_at = ?2, updated_at = ?2 WHERE id = ?3",
            params![status, ts, id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_saved(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| {
        let files: Vec<String> = {
            let mut stmt = lib.conn.prepare("SELECT file_path FROM recordings WHERE saved_sentence_id = ?1")?;
            stmt.query_map([&id], |r| r.get(0))?.collect::<Result<_, _>>()?
        };
        lib.conn.execute("DELETE FROM saved_sentences WHERE id = ?1", [&id])?;
        delete_recording_files(&lib.root, &files);
        Ok(())
    })
}

#[tauri::command]
pub fn set_saved_tags(state: State<AppState>, id: String, tag_ids: Vec<String>) -> AppResult<SavedSentence> {
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        tx.execute("DELETE FROM sentence_tags WHERE saved_sentence_id = ?1", [&id])?;
        for t in &tag_ids {
            tx.execute("INSERT OR IGNORE INTO sentence_tags (saved_sentence_id, tag_id) VALUES (?1, ?2)", params![id, t])?;
        }
        tx.execute("UPDATE saved_sentences SET updated_at = ?1 WHERE id = ?2", params![now(), id])?;
        tx.commit()?;
        load_saved(&lib.conn, &id)
    })
}

#[tauri::command]
pub fn list_tags(state: State<AppState>) -> AppResult<Vec<Tag>> {
    state.with(|lib| {
        let mut stmt = lib.conn.prepare(
            "SELECT t.id, t.name, (SELECT COUNT(*) FROM sentence_tags st WHERE st.tag_id = t.id) FROM tags t ORDER BY t.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| Ok(Tag { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))?;
        Ok(rows.collect::<Result<_, _>>()?)
    })
}

#[tauri::command]
pub fn create_tag(state: State<AppState>, name: String) -> AppResult<Tag> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::invalid("Tag name cannot be empty"));
    }
    state.with(|lib| {
        if let Some(t) = lib
            .conn
            .query_row("SELECT id, name FROM tags WHERE name = ?1", [&name], |r| Ok(Tag { id: r.get(0)?, name: r.get(1)?, count: 0 }))
            .optional()?
        {
            return Ok(t);
        }
        let id = new_id();
        lib.conn.execute("INSERT INTO tags (id, name) VALUES (?1, ?2)", params![id, name])?;
        Ok(Tag { id, name, count: 0 })
    })
}

#[tauri::command]
pub fn delete_tag(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| {
        lib.conn.execute("DELETE FROM tags WHERE id = ?1", [id])?;
        Ok(())
    })
}

fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) { format!("\"{}\"", s.replace('"', "\"\"")) } else { s.to_string() }
}

pub fn render_export(items: &[SavedSentence], format: &str) -> String {
    let mut out = String::new();
    if format == "csv" {
        out.push_str("sentence,meaning,example,speaker,status,tags,sources,note,practice_count,last_practiced\n");
        for i in items {
            let tags = i.tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join("; ");
            let sources = i.sources.iter().filter_map(|s| s.video_title.as_deref()).collect::<Vec<_>>().join("; ");
            let fields = [
                i.text.as_str(),
                i.meaning.as_deref().unwrap_or(""),
                i.example.as_deref().unwrap_or(""),
                i.speaker.as_str(),
                i.status.as_str(),
                &tags,
                &sources,
                i.note.as_deref().unwrap_or(""),
                &i.practice_count.to_string(),
                i.last_practiced_at.as_deref().unwrap_or(""),
            ];
            out.push_str(&fields.iter().map(|f| csv_field(f)).collect::<Vec<_>>().join(","));
            out.push('\n');
        }
    } else {
        for i in items {
            out.push_str(&i.text);
            out.push('\n');
            if let Some(m) = &i.meaning {
                out.push_str(&format!("  Meaning: {m}\n"));
            }
            if let Some(e) = &i.example {
                out.push_str(&format!("  Example: {e}\n"));
            }
            if let Some(n) = &i.note {
                out.push_str(&format!("  Note: {}\n", n.replace('\n', "\n        ")));
            }
            out.push('\n');
        }
    }
    out
}

#[tauri::command]
pub fn export_saved(state: State<AppState>, path: String, format: String, filter: Option<VaultFilter>) -> AppResult<usize> {
    state.with(|lib| {
        let items = list(&lib.conn, filter.unwrap_or_default())?;
        std::fs::write(&path, render_export(&items, &format))?;
        Ok(items.len())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;

    fn input(text: &str, sentence: Option<&str>) -> SaveInput {
        SaveInput { text: text.into(), meaning: None, speaker: None, video_id: None, sentence_id: sentence.map(String::from), start_sec: None }
    }

    #[test]
    fn duplicates_merge_into_one_entry_with_many_sources() {
        let mut conn = open_memory();
        conn.execute_batch(
            "INSERT INTO videos (id,title,platform,created_at,updated_at) VALUES ('v','T','none','x','x');
             INSERT INTO transcripts (id,video_id,source,created_at,updated_at) VALUES ('t','v','txt','x','x');
             INSERT INTO sentences (id,transcript_id,video_id,position,text,created_at,updated_at) VALUES ('s1','t','v',1,'Let me check.','x','x'),('s2','t','v',2,'let me check','x','x');",
        )
        .unwrap();
        let a = save(&mut conn, input("Let me check.", Some("s1"))).unwrap();
        let b = save(&mut conn, input("let me check", Some("s2"))).unwrap();
        let c = save(&mut conn, input("Let me check.", Some("s1"))).unwrap();
        assert!(a.created && !b.created && !c.created);
        assert_eq!(a.saved.id, b.saved.id);
        assert_eq!(c.saved.sources.len(), 2);
        assert_eq!(list(&conn, VaultFilter::default()).unwrap().len(), 1);
    }

    #[test]
    fn filters_and_csv() {
        let mut conn = open_memory();
        let s = save(&mut conn, input("Could you send the invoice?", None)).unwrap().saved;
        conn.execute("INSERT INTO sentence_tags VALUES (?1, 'tag-client')", [&s.id]).unwrap();
        let f = |tag: &str| VaultFilter { tag_id: Some(tag.into()), ..Default::default() };
        assert_eq!(list(&conn, f("tag-client")).unwrap().len(), 1);
        assert_eq!(list(&conn, f("tag-sales")).unwrap().len(), 0);
        let unpracticed = VaultFilter { status: Some("unpracticed".into()), ..Default::default() };
        assert_eq!(list(&conn, unpracticed).unwrap().len(), 1);
        let csv = render_export(&list(&conn, VaultFilter::default()).unwrap(), "csv");
        assert!(csv.contains("Could you send the invoice?,,,U,new,Client Communication"));
    }
}
