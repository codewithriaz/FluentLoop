use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use zip::write::SimpleFileOptions;

use super::run_blocking;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::{self, AppState, BACKUPS_DIR, DB_FILE, MEDIA_DIR, RECORDINGS_DIR, TTS_DIR};
use crate::tools;
use crate::util::{new_id, now};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub path: Option<String>,
    pub schema_version: Option<i64>,
    pub open_error: Option<String>,
    pub tools: tools::ToolsStatus,
}

#[tauri::command]
pub fn library_info(state: State<AppState>) -> LibraryInfo {
    let (path, schema_version) = state
        .with(|lib| Ok((lib.root.display().to_string(), db::schema_version(&lib.conn)?)))
        .map(|(p, v)| (Some(p), Some(v)))
        .unwrap_or((None, None));
    LibraryInfo { path, schema_version, open_error: state.open_error.lock().ok().and_then(|e| e.clone()), tools: tools::status() }
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
    entries
        .filter_map(Result::ok)
        .map(|e| {
            let p = e.path();
            if p.is_dir() { dir_size(&p) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }
        })
        .sum()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingFile {
    pub kind: String,
    pub id: String,
    pub label: String,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub path: String,
    pub database_bytes: u64,
    pub media_bytes: u64,
    pub recordings_bytes: u64,
    pub backups_bytes: u64,
    pub video_count: i64,
    pub sentence_count: i64,
    pub saved_count: i64,
    pub note_count: i64,
    pub missing: Vec<MissingFile>,
}

#[tauri::command]
pub async fn storage_info(state: State<'_, AppState>) -> AppResult<StorageInfo> {
    let (root, counts, refs) = state.with(|lib| {
        let c = |sql: &str| -> rusqlite::Result<i64> { lib.conn.query_row(sql, [], |r| r.get(0)) };
        let counts = (
            c("SELECT COUNT(*) FROM videos")?,
            c("SELECT COUNT(*) FROM sentences")?,
            c("SELECT COUNT(*) FROM saved_sentences")?,
            c("SELECT COUNT(*) FROM notes")?,
        );
        let mut refs: Vec<(String, String, String, String)> = Vec::new();
        let mut stmt = lib.conn.prepare("SELECT 'media', id, title, media_path FROM videos WHERE media_path IS NOT NULL")?;
        refs.extend(stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<Vec<_>, _>>()?);
        let mut stmt = lib.conn.prepare("SELECT 'recording', id, created_at, file_path FROM recordings")?;
        refs.extend(stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<Vec<_>, _>>()?);
        Ok((lib.root.clone(), counts, refs))
    })?;
    run_blocking(move || {
        let db_bytes = [DB_FILE.to_string(), format!("{DB_FILE}-wal"), format!("{DB_FILE}-shm")]
            .iter()
            .filter_map(|f| std::fs::metadata(root.join(f)).ok())
            .map(|m| m.len())
            .sum();
        let missing = refs
            .into_iter()
            .filter(|(_, _, _, rel)| !root.join(rel).is_file())
            .map(|(kind, id, label, rel)| MissingFile { kind, id, label, path: root.join(rel).display().to_string() })
            .collect();
        Ok(StorageInfo {
            path: root.display().to_string(),
            database_bytes: db_bytes,
            media_bytes: dir_size(&root.join(MEDIA_DIR)),
            recordings_bytes: dir_size(&root.join(RECORDINGS_DIR)) + dir_size(&root.join(TTS_DIR)),
            backups_bytes: dir_size(&root.join(BACKUPS_DIR)),
            video_count: counts.0,
            sentence_count: counts.1,
            saved_count: counts.2,
            note_count: counts.3,
            missing,
        })
    })
    .await
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    app: String,
    schema_version: i64,
    created_at: String,
    includes_media: bool,
}

/// Consistent snapshot of the live database (VACUUM INTO works while the DB is open).
fn snapshot_db(conn: &rusqlite::Connection, dest: &Path) -> AppResult<()> {
    if dest.exists() {
        std::fs::remove_file(dest)?;
    }
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy()])?;
    Ok(())
}

fn add_dir(zip: &mut zip::ZipWriter<File>, root: &Path, rel_dir: &str, opts: SimpleFileOptions) -> AppResult<()> {
    let dir = root.join(rel_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(()) };
    for e in entries.filter_map(Result::ok) {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let rel = format!("{rel_dir}/{name}");
        if e.path().is_dir() {
            add_dir(zip, root, &rel, opts)?;
        } else {
            zip.start_file(&rel, opts)?;
            std::io::copy(&mut File::open(e.path())?, zip)?;
        }
    }
    Ok(())
}

fn write_backup(root: &Path, snapshot: &Path, dest: &Path, include_media: bool, schema_version: i64) -> AppResult<u64> {
    let tmp_dest = dest.with_extension("partial");
    let mut zip = zip::ZipWriter::new(File::create(&tmp_dest)?);
    let deflate = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).large_file(true);
    let manifest = Manifest { app: "FluentLoop".into(), schema_version, created_at: now(), includes_media: include_media };
    zip.start_file("manifest.json", deflate)?;
    zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;
    zip.start_file(DB_FILE, deflate)?;
    std::io::copy(&mut File::open(snapshot)?, &mut zip)?;
    add_dir(&mut zip, root, RECORDINGS_DIR, stored)?;
    add_dir(&mut zip, root, TTS_DIR, stored)?;
    if include_media {
        add_dir(&mut zip, root, MEDIA_DIR, stored)?;
    }
    zip.finish()?;
    std::fs::rename(&tmp_dest, dest)?;
    Ok(std::fs::metadata(dest)?.len())
}

/// Writes a .zip with the database, recordings and (optionally) imported/downloaded media.
#[tauri::command]
pub async fn create_backup(state: State<'_, AppState>, dest: String, include_media: bool) -> AppResult<u64> {
    let (root, snapshot, version) = state.with(|lib| {
        let snap = lib.root.join(BACKUPS_DIR).join(format!(".snapshot-{}.db", new_id()));
        snapshot_db(&lib.conn, &snap)?;
        Ok((lib.root.clone(), snap, db::schema_version(&lib.conn)?))
    })?;
    let snap2 = snapshot.clone();
    let result = run_blocking(move || write_backup(&root, &snap2, Path::new(&dest), include_media, version)).await;
    let _ = std::fs::remove_file(&snapshot);
    result
}

/// Rejects absolute paths and `..` components inside archives.
fn safe_entry_path(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    if p.is_absolute() || p.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return None;
    }
    Some(p.to_path_buf())
}

fn validate_backup(zip_path: &Path, work: &Path) -> AppResult<(Manifest, PathBuf)> {
    let mut archive = zip::ZipArchive::new(File::open(zip_path)?)?;
    let manifest: Manifest = {
        let mut f = archive.by_name("manifest.json").map_err(|_| AppError::invalid("This is not a FluentLoop backup (manifest missing)"))?;
        let mut s = String::new();
        f.read_to_string(&mut s)?;
        serde_json::from_str(&s)?
    };
    if manifest.app != "FluentLoop" {
        return Err(AppError::invalid("This is not a FluentLoop backup"));
    }
    if manifest.schema_version > db::SCHEMA_VERSION {
        return Err(AppError::invalid("This backup was made by a newer version of FluentLoop"));
    }
    let db_path = work.join(DB_FILE);
    {
        let mut f = archive.by_name(DB_FILE).map_err(|_| AppError::invalid("The backup has no database"))?;
        std::io::copy(&mut f, &mut File::create(&db_path)?)?;
    }
    let conn = rusqlite::Connection::open(&db_path)?;
    let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(AppError::invalid(format!("The backup database is damaged: {check}")));
    }
    conn.query_row("SELECT COUNT(*) FROM videos", [], |r| r.get::<_, i64>(0))?;
    Ok((manifest, db_path))
}

fn extract_files(zip_path: &Path, root: &Path) -> AppResult<()> {
    let mut archive = zip::ZipArchive::new(File::open(zip_path)?)?;
    for i in 0..archive.len() {
        let mut f = archive.by_index(i)?;
        let name = f.name().to_string();
        let allowed = [MEDIA_DIR, RECORDINGS_DIR, TTS_DIR].iter().any(|d| name.starts_with(&format!("{d}/")));
        if !allowed || f.is_dir() {
            continue;
        }
        let Some(rel) = safe_entry_path(&name) else { continue };
        let out = root.join(rel);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::io::copy(&mut f, &mut File::create(out)?)?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub safety_copy: String,
    pub includes_media: bool,
}

/// Replaces the current library database with the backup's. A safety copy of the current
/// database is written to `backups/` first. Media/recording files are added, never deleted.
#[tauri::command]
pub async fn restore_backup(app: AppHandle, state: State<'_, AppState>, zip_path: String) -> AppResult<RestoreResult> {
    let root = state.root()?;
    let work = root.join(BACKUPS_DIR).join(format!(".restore-{}", new_id()));
    std::fs::create_dir_all(&work)?;
    let (zp, w) = (PathBuf::from(&zip_path), work.clone());
    let validated = run_blocking(move || validate_backup(&zp, &w)).await;
    let (manifest, new_db) = match validated {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&work);
            return Err(e);
        }
    };
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let safety = root.join(BACKUPS_DIR).join(format!("pre-restore-{stamp}.db"));
    state.with(|lib| snapshot_db(&lib.conn, &safety))?;
    // Close the live connection before swapping files.
    *state.lib.lock().map_err(|_| AppError::invalid("Library lock poisoned"))? = None;
    let swap = (|| -> AppResult<()> {
        for suffix in ["", "-wal", "-shm"] {
            let p = root.join(format!("{DB_FILE}{suffix}"));
            if p.exists() {
                std::fs::remove_file(p)?;
            }
        }
        std::fs::copy(&new_db, root.join(DB_FILE))?;
        Ok(())
    })();
    if let Err(e) = swap {
        let _ = std::fs::copy(&safety, root.join(DB_FILE));
        state::activate_library(&app, &state, &root)?;
        let _ = std::fs::remove_dir_all(&work);
        return Err(e);
    }
    let (zp, r) = (PathBuf::from(&zip_path), root.clone());
    let extracted = run_blocking(move || extract_files(&zp, &r)).await;
    let _ = std::fs::remove_dir_all(&work);
    state::activate_library(&app, &state, &root)?;
    extracted?;
    Ok(RestoreResult { safety_copy: safety.display().to_string(), includes_media: manifest.includes_media })
}

fn copy_dir(src: &Path, dest: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dest)?;
    let Ok(entries) = std::fs::read_dir(src) else { return Ok(()) };
    for e in entries.filter_map(Result::ok) {
        let target = dest.join(e.file_name());
        if e.path().is_dir() {
            copy_dir(&e.path(), &target)?;
        } else {
            std::fs::copy(e.path(), target)?;
        }
    }
    Ok(())
}

/// Switches to another library folder. With `copy_current`, the current library is copied there
/// first (refused if the target already holds a library). Otherwise the target is opened or created.
#[tauri::command]
pub async fn change_library(app: AppHandle, state: State<'_, AppState>, path: String, copy_current: bool) -> AppResult<LibraryInfo> {
    let target = PathBuf::from(&path);
    if copy_current {
        if target.join(DB_FILE).exists() {
            return Err(AppError::invalid("That folder already contains a FluentLoop library. Choose an empty folder, or open it instead."));
        }
        std::fs::create_dir_all(&target)?;
        let root = state.with(|lib| {
            snapshot_db(&lib.conn, &target.join(DB_FILE))?;
            Ok(lib.root.clone())
        })?;
        let t = target.clone();
        run_blocking(move || {
            copy_dir(&root.join(MEDIA_DIR), &t.join(MEDIA_DIR))?;
            copy_dir(&root.join(RECORDINGS_DIR), &t.join(RECORDINGS_DIR))?;
            copy_dir(&root.join(TTS_DIR), &t.join(TTS_DIR))
        })
        .await?;
    }
    *state.lib.lock().map_err(|_| AppError::invalid("Library lock poisoned"))? = None;
    state::activate_library(&app, &state, &target)?;
    *state.open_error.lock().map_err(|_| AppError::invalid("lock poisoned"))? = None;
    state::save_config(&app, &state::AppConfig { library_path: Some(target) })?;
    Ok(library_info(state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_archive_paths() {
        assert!(safe_entry_path("media/x/a.mp4").is_some());
        assert!(safe_entry_path("../etc/passwd").is_none());
        assert!(safe_entry_path("/etc/passwd").is_none());
        assert!(safe_entry_path("media/../../x").is_none());
    }

    #[test]
    fn backup_roundtrip_validates() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        std::fs::create_dir_all(root.join(RECORDINGS_DIR)).unwrap();
        std::fs::write(root.join(RECORDINGS_DIR).join("r.m4a"), b"audio").unwrap();
        let conn = db::open(&root.join(DB_FILE)).unwrap();
        conn.execute("INSERT INTO videos (id,title,platform,created_at,updated_at) VALUES ('v','T','none','x','x')", []).unwrap();
        let snap = dir.path().join("snap.db");
        snapshot_db(&conn, &snap).unwrap();
        let zip_path = dir.path().join("b.zip");
        write_backup(&root, &snap, &zip_path, false, db::SCHEMA_VERSION).unwrap();
        let work = dir.path().join("work");
        std::fs::create_dir_all(&work).unwrap();
        let (m, db_path) = validate_backup(&zip_path, &work).unwrap();
        assert_eq!(m.schema_version, db::SCHEMA_VERSION);
        let restored = rusqlite::Connection::open(db_path).unwrap();
        let n: i64 = restored.query_row("SELECT COUNT(*) FROM videos", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let out = dir.path().join("out");
        extract_files(&zip_path, &out).unwrap();
        assert_eq!(std::fs::read(out.join(RECORDINGS_DIR).join("r.m4a")).unwrap(), b"audio");
    }
}
