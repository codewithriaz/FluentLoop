use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::State;

use super::check_one_of;
use super::transcript::apply_practice_state;
use super::vault::apply_status;
use crate::error::AppResult;
use crate::state::AppState;
use crate::util::{new_id, now};

const MODES: &[&str] = &["full", "practice_a", "hide_a", "practice_b", "both", "random"];
const ACTIONS: &[&str] = &["practiced", "difficult", "skipped", "revealed", "recorded"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub video_id: Option<String>,
    pub video_title: Option<String>,
    pub mode: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub practiced: i64,
    pub difficult: i64,
    pub skipped: i64,
    pub recorded: i64,
}

#[tauri::command]
pub fn start_session(state: State<AppState>, video_id: Option<String>, mode: String) -> AppResult<String> {
    check_one_of(&mode, MODES, "practice mode")?;
    state.with(|lib| {
        let id = new_id();
        lib.conn.execute(
            "INSERT INTO practice_sessions (id, video_id, mode, started_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, video_id, mode, now()],
        )?;
        Ok(id)
    })
}

/// Ends a session; sessions with no attempts are discarded to keep history meaningful.
#[tauri::command]
pub fn end_session(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| {
        lib.conn.execute("UPDATE practice_sessions SET ended_at = ?1 WHERE id = ?2", params![now(), id])?;
        lib.conn.execute(
            "DELETE FROM practice_sessions WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM practice_attempts WHERE session_id = ?1)",
            [&id],
        )?;
        Ok(())
    })
}

pub fn record(
    conn: &Connection,
    session_id: &str,
    sentence_id: Option<&str>,
    saved_id: Option<&str>,
    action: &str,
    recording_id: Option<&str>,
) -> AppResult<()> {
    check_one_of(action, ACTIONS, "practice action")?;
    conn.execute(
        "INSERT INTO practice_attempts (id, session_id, sentence_id, saved_sentence_id, action, recording_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![new_id(), session_id, sentence_id, saved_id, action, recording_id, now()],
    )?;
    if matches!(action, "practiced" | "difficult") {
        if let Some(s) = sentence_id {
            apply_practice_state(conn, s, action)?;
        }
        if let Some(s) = saved_id {
            apply_status(conn, s, action)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn record_attempt(
    state: State<AppState>,
    session_id: String,
    sentence_id: Option<String>,
    saved_id: Option<String>,
    action: String,
    recording_id: Option<String>,
) -> AppResult<()> {
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        record(&tx, &session_id, sentence_id.as_deref(), saved_id.as_deref(), &action, recording_id.as_deref())?;
        tx.commit()?;
        Ok(())
    })
}

#[tauri::command]
pub fn list_sessions(state: State<AppState>, video_id: Option<String>, limit: Option<i64>) -> AppResult<Vec<Session>> {
    state.with(|lib| {
        let mut stmt = lib.conn.prepare(
            "SELECT p.id, p.video_id, v.title, p.mode, p.started_at, p.ended_at,
               (SELECT COUNT(*) FROM practice_attempts a WHERE a.session_id = p.id AND a.action = 'practiced'),
               (SELECT COUNT(*) FROM practice_attempts a WHERE a.session_id = p.id AND a.action = 'difficult'),
               (SELECT COUNT(*) FROM practice_attempts a WHERE a.session_id = p.id AND a.action = 'skipped'),
               (SELECT COUNT(*) FROM practice_attempts a WHERE a.session_id = p.id AND a.action = 'recorded')
             FROM practice_sessions p LEFT JOIN videos v ON v.id = p.video_id
             WHERE (?1 IS NULL OR p.video_id = ?1)
               AND EXISTS (SELECT 1 FROM practice_attempts a WHERE a.session_id = p.id)
             ORDER BY p.started_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![video_id, limit.unwrap_or(50)], |r| {
            Ok(Session {
                id: r.get(0)?,
                video_id: r.get(1)?,
                video_title: r.get(2)?,
                mode: r.get(3)?,
                started_at: r.get(4)?,
                ended_at: r.get(5)?,
                practiced: r.get(6)?,
                difficult: r.get(7)?,
                skipped: r.get(8)?,
                recorded: r.get(9)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;

    #[test]
    fn attempts_update_sentence_and_video() {
        let conn = open_memory();
        conn.execute_batch(
            "INSERT INTO videos (id,title,platform,created_at,updated_at) VALUES ('v','T','none','x','x');
             INSERT INTO transcripts (id,video_id,source,created_at,updated_at) VALUES ('t','v','txt','x','x');
             INSERT INTO sentences (id,transcript_id,video_id,position,text,created_at,updated_at) VALUES ('s','t','v',1,'Hi.','x','x');
             INSERT INTO practice_sessions (id,video_id,mode,started_at) VALUES ('p','v','full','x');",
        )
        .unwrap();
        record(&conn, "p", Some("s"), None, "difficult", None).unwrap();
        record(&conn, "p", Some("s"), None, "skipped", None).unwrap();
        let (st, cnt): (String, i64) =
            conn.query_row("SELECT practice_state, practice_count FROM sentences WHERE id='s'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((st.as_str(), cnt), ("difficult", 1));
        let lp: Option<String> = conn.query_row("SELECT last_practiced_at FROM videos WHERE id='v'", [], |r| r.get(0)).unwrap();
        assert!(lp.is_some());
        assert!(record(&conn, "p", Some("s"), None, "bogus", None).is_err());
    }
}
