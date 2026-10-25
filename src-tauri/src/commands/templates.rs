use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::util::{clean_opt, new_id, now};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub title: String,
    pub content: String,
    pub category: String,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
    pub source_label: Option<String>,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

const SELECT: &str = "SELECT t.id, t.title, t.content, t.category, t.source_type, t.source_id, t.source_label, n.body, t.created_at, t.updated_at
    FROM templates t LEFT JOIN notes n ON n.entity_type = 'template' AND n.entity_id = t.id";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Template> {
    Ok(Template {
        id: r.get(0)?,
        title: r.get(1)?,
        content: r.get(2)?,
        category: r.get(3)?,
        source_type: r.get(4)?,
        source_id: r.get(5)?,
        source_label: r.get(6)?,
        note: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

fn load(conn: &Connection, id: &str) -> AppResult<Template> {
    conn.query_row(&format!("{SELECT} WHERE t.id = ?1"), [id], row).optional()?.ok_or_else(|| AppError::NotFound("template".into()))
}

#[tauri::command]
pub fn list_templates(state: State<AppState>, search: Option<String>, category: Option<String>) -> AppResult<Vec<Template>> {
    state.with(|lib| {
        let mut stmt = lib.conn.prepare(&format!(
            "{SELECT} WHERE (?1 IS NULL OR t.title LIKE ?1 OR t.content LIKE ?1) AND (?2 IS NULL OR t.category = ?2) ORDER BY t.updated_at DESC"
        ))?;
        let s = clean_opt(search).map(|s| format!("%{s}%"));
        let rows = stmt.query_map(params![s, clean_opt(category)], row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInput {
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
    pub source_label: Option<String>,
}

#[tauri::command]
pub fn create_template(state: State<AppState>, input: TemplateInput) -> AppResult<Template> {
    let title = clean_opt(Some(input.title)).unwrap_or_else(|| "Untitled template".into());
    state.with(|lib| {
        let id = new_id();
        let ts = now();
        lib.conn.execute(
            "INSERT INTO templates (id, title, content, category, source_type, source_id, source_label, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                id, title, input.content, clean_opt(input.category).unwrap_or_else(|| "General".into()),
                clean_opt(input.source_type), clean_opt(input.source_id), clean_opt(input.source_label), ts
            ],
        )?;
        load(&lib.conn, &id)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePatch {
    pub title: Option<String>,
    pub content: Option<String>,
    pub category: Option<String>,
}

#[tauri::command]
pub fn update_template(state: State<AppState>, id: String, patch: TemplatePatch) -> AppResult<Template> {
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let ts = now();
        if let Some(t) = clean_opt(patch.title) {
            tx.execute("UPDATE templates SET title = ?1, updated_at = ?2 WHERE id = ?3", params![t, ts, id])?;
        }
        if let Some(c) = patch.content {
            tx.execute("UPDATE templates SET content = ?1, updated_at = ?2 WHERE id = ?3", params![c, ts, id])?;
        }
        if let Some(c) = clean_opt(patch.category) {
            tx.execute("UPDATE templates SET category = ?1, updated_at = ?2 WHERE id = ?3", params![c, ts, id])?;
        }
        tx.commit()?;
        load(&lib.conn, &id)
    })
}

#[tauri::command]
pub fn delete_template(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| {
        lib.conn.execute("DELETE FROM templates WHERE id = ?1", [id])?;
        Ok(())
    })
}
