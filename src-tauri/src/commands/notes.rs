use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use tauri::State;

use super::check_one_of;
use crate::error::AppResult;
use crate::state::AppState;
use crate::util::{clean_opt, new_id, now};

const ENTITY_TYPES: &[&str] = &["video", "folder", "transcript", "sentence", "saved_sentence", "practice_session", "template", "general"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub title: Option<String>,
    pub body: String,
    pub updated_at: String,
}

fn load(conn: &Connection, entity_type: &str, entity_id: &str) -> AppResult<Option<Note>> {
    Ok(conn
        .query_row(
            "SELECT id, entity_type, entity_id, title, body, updated_at FROM notes WHERE entity_type = ?1 AND entity_id = ?2",
            params![entity_type, entity_id],
            |r| Ok(Note { id: r.get(0)?, entity_type: r.get(1)?, entity_id: r.get(2)?, title: r.get(3)?, body: r.get(4)?, updated_at: r.get(5)? }),
        )
        .optional()?)
}

pub fn upsert(conn: &Connection, entity_type: &str, entity_id: &str, title: Option<String>, body: &str) -> AppResult<Option<Note>> {
    check_one_of(entity_type, ENTITY_TYPES, "note type")?;
    let title = clean_opt(title);
    // Empty entity notes are removed; general notebook pages are kept even when empty.
    if body.trim().is_empty() && entity_type != "general" {
        conn.execute("DELETE FROM notes WHERE entity_type = ?1 AND entity_id = ?2", params![entity_type, entity_id])?;
        return Ok(None);
    }
    let ts = now();
    conn.execute(
        "INSERT INTO notes (id, entity_type, entity_id, title, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET body = excluded.body, title = COALESCE(excluded.title, notes.title), updated_at = excluded.updated_at",
        params![new_id(), entity_type, entity_id, title, body, ts],
    )?;
    load(conn, entity_type, entity_id)
}

#[tauri::command]
pub fn get_note(state: State<AppState>, entity_type: String, entity_id: String) -> AppResult<Option<Note>> {
    state.with(|lib| load(&lib.conn, &entity_type, &entity_id))
}

#[tauri::command]
pub fn save_note(state: State<AppState>, entity_type: String, entity_id: String, body: String, title: Option<String>) -> AppResult<Option<Note>> {
    state.with(|lib| upsert(&lib.conn, &entity_type, &entity_id, title, &body))
}

#[tauri::command]
pub fn create_general_note(state: State<AppState>, title: String) -> AppResult<Note> {
    state.with(|lib| {
        let id = new_id();
        let title = clean_opt(Some(title)).or(Some("Untitled note".into()));
        Ok(upsert(&lib.conn, "general", &id, title, "")?.expect("general notes are always kept"))
    })
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| {
        lib.conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
        Ok(())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteListItem {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub title: Option<String>,
    pub body: String,
    pub updated_at: String,
    /// Human-readable context: the video title, sentence text, folder name, etc.
    pub context: Option<String>,
    pub video_id: Option<String>,
    pub start_sec: Option<f64>,
}

const LIST_SQL: &str = "SELECT n.id, n.entity_type, n.entity_id, n.title, n.body, n.updated_at,
    CASE n.entity_type
      WHEN 'video' THEN (SELECT title FROM videos WHERE id = n.entity_id)
      WHEN 'folder' THEN (SELECT name FROM folders WHERE id = n.entity_id)
      WHEN 'sentence' THEN (SELECT text FROM sentences WHERE id = n.entity_id)
      WHEN 'saved_sentence' THEN (SELECT text FROM saved_sentences WHERE id = n.entity_id)
      WHEN 'template' THEN (SELECT title FROM templates WHERE id = n.entity_id)
      WHEN 'transcript' THEN (SELECT v.title FROM transcripts t JOIN videos v ON v.id = t.video_id WHERE t.id = n.entity_id)
      WHEN 'practice_session' THEN (SELECT 'Practice: ' || p.mode FROM practice_sessions p WHERE p.id = n.entity_id)
    END AS context,
    CASE n.entity_type
      WHEN 'video' THEN n.entity_id
      WHEN 'sentence' THEN (SELECT video_id FROM sentences WHERE id = n.entity_id)
      WHEN 'transcript' THEN (SELECT video_id FROM transcripts WHERE id = n.entity_id)
      WHEN 'practice_session' THEN (SELECT video_id FROM practice_sessions WHERE id = n.entity_id)
    END AS video_id,
    CASE n.entity_type WHEN 'sentence' THEN (SELECT start_sec FROM sentences WHERE id = n.entity_id) END AS start_sec
    FROM notes n";

pub fn list(conn: &Connection, search: Option<String>, entity_type: Option<String>) -> AppResult<Vec<NoteListItem>> {
    let mut sql = format!("SELECT * FROM ({LIST_SQL}) WHERE 1=1");
    let mut args: Vec<String> = Vec::new();
    if let Some(t) = clean_opt(entity_type) {
        args.push(t);
        sql.push_str(&format!(" AND entity_type = ?{}", args.len()));
    }
    if let Some(s) = clean_opt(search) {
        args.push(format!("%{s}%"));
        let n = args.len();
        sql.push_str(&format!(" AND (body LIKE ?{n} OR title LIKE ?{n} OR context LIKE ?{n})"));
    }
    sql.push_str(" ORDER BY updated_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
        Ok(NoteListItem {
            id: r.get(0)?,
            entity_type: r.get(1)?,
            entity_id: r.get(2)?,
            title: r.get(3)?,
            body: r.get(4)?,
            updated_at: r.get(5)?,
            context: r.get(6)?,
            video_id: r.get(7)?,
            start_sec: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[tauri::command]
pub fn list_notes(state: State<AppState>, search: Option<String>, entity_type: Option<String>) -> AppResult<Vec<NoteListItem>> {
    state.with(|lib| list(&lib.conn, search, entity_type))
}

#[tauri::command]
pub fn export_notes(state: State<AppState>, path: String) -> AppResult<()> {
    state.with(|lib| {
        let notes = list(&lib.conn, None, None)?;
        let mut out = String::from("# FluentLoop notes\n\n");
        for n in notes {
            let heading = n.title.clone().or(n.context.clone()).unwrap_or_else(|| n.entity_type.clone());
            out.push_str(&format!("## {heading}\n\n_{} · {}_\n\n{}\n\n", n.entity_type, n.updated_at, n.body));
        }
        std::fs::write(path, out)?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;

    #[test]
    fn upsert_and_list_with_context() {
        let conn = open_memory();
        conn.execute("INSERT INTO videos (id,title,platform,created_at,updated_at) VALUES ('v','Sales call','none','x','x')", []).unwrap();
        upsert(&conn, "video", "v", None, "Great phrases").unwrap();
        upsert(&conn, "video", "v", None, "Updated").unwrap();
        let all = list(&conn, None, None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].body, "Updated");
        assert_eq!(all[0].context.as_deref(), Some("Sales call"));
        assert_eq!(list(&conn, Some("sales".into()), None).unwrap().len(), 1);
        assert_eq!(list(&conn, Some("zzz".into()), None).unwrap().len(), 0);
        assert!(upsert(&conn, "video", "v", None, "  ").unwrap().is_none());
        assert!(list(&conn, None, None).unwrap().is_empty());
    }
}
