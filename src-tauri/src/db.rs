use std::path::Path;

use rusqlite::Connection;

use crate::error::AppResult;

/// Ordered migrations; index + 1 is the schema version stored in PRAGMA user_version.
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_initial.sql"),
    include_str!("../migrations/002_recording_transcripts.sql"),
    include_str!("../migrations/003_tts_clips.sql"),
];

pub const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn configure(conn: &Connection) -> AppResult<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

pub fn schema_version(conn: &Connection) -> AppResult<i64> {
    Ok(conn.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

pub fn migrate(conn: &Connection) -> AppResult<()> {
    let current = schema_version(conn)?;
    if current > SCHEMA_VERSION {
        return Err(crate::error::AppError::invalid(format!(
            "This library was created by a newer FluentLoop (schema {current}, app supports {SCHEMA_VERSION})."
        )));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
pub fn open_memory() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate(&conn).unwrap();
    conn
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_are_idempotent() {
        let conn = open_memory();
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
        migrate(&conn).unwrap();
        let tags: i64 = conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0)).unwrap();
        assert_eq!(tags, 8);
    }

    #[test]
    fn migrations_apply_on_disk_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        drop(open(&path).unwrap());
        let conn = open(&path).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
    }

    #[test]
    fn note_triggers_remove_orphans() {
        let conn = open_memory();
        conn.execute_batch(
            "INSERT INTO videos (id,title,platform,created_at,updated_at) VALUES ('v','t','none','x','x');
             INSERT INTO notes (id,entity_type,entity_id,body,created_at,updated_at) VALUES ('n','video','v','hi','x','x');
             DELETE FROM videos WHERE id='v';",
        )
        .unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
