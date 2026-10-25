use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::db;
use crate::error::{AppError, AppResult};

pub const DB_FILE: &str = "fluentloop.db";
pub const MEDIA_DIR: &str = "media";
pub const RECORDINGS_DIR: &str = "recordings";
pub const TTS_DIR: &str = "tts";
pub const BACKUPS_DIR: &str = "backups";

/// An open library: a folder holding the SQLite database plus media and recordings.
pub struct Library {
    pub root: PathBuf,
    pub conn: Connection,
}

impl Library {
    pub fn open(root: &Path) -> AppResult<Self> {
        for dir in [MEDIA_DIR, RECORDINGS_DIR, TTS_DIR, BACKUPS_DIR] {
            std::fs::create_dir_all(root.join(dir))?;
        }
        let conn = db::open(&root.join(DB_FILE))?;
        Ok(Library { root: root.to_path_buf(), conn })
    }

    pub fn abs(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }
}

#[derive(Default)]
pub struct AppState {
    pub lib: Mutex<Option<Library>>,
    pub open_error: Mutex<Option<String>>,
}

impl AppState {
    pub fn with<T>(&self, f: impl FnOnce(&mut Library) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.lib.lock().map_err(|_| AppError::invalid("Library lock poisoned"))?;
        let lib = guard.as_mut().ok_or(AppError::NoLibrary)?;
        f(lib)
    }

    pub fn root(&self) -> AppResult<PathBuf> {
        self.with(|lib| Ok(lib.root.clone()))
    }
}

/// Stored outside the library so the app can find a library that lives anywhere.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub library_path: Option<PathBuf>,
}

fn config_file(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| AppError::invalid(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("config.json"))
}

pub fn load_config(app: &AppHandle) -> AppResult<AppConfig> {
    let path = config_file(app)?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    Ok(serde_json::from_str(&std::fs::read_to_string(path)?).unwrap_or_default())
}

pub fn save_config(app: &AppHandle, cfg: &AppConfig) -> AppResult<()> {
    std::fs::write(config_file(app)?, serde_json::to_string_pretty(cfg)?)?;
    Ok(())
}

pub fn default_library_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::invalid(e.to_string()))?;
    Ok(dir.join("Library"))
}

/// Opens a library, allows the asset protocol to serve its files, and installs it in state.
pub fn activate_library(app: &AppHandle, state: &AppState, root: &Path) -> AppResult<()> {
    let lib = Library::open(root)?;
    app.asset_protocol_scope()
        .allow_directory(root, true)
        .map_err(|e| AppError::invalid(e.to_string()))?;
    *state.lib.lock().map_err(|_| AppError::invalid("Library lock poisoned"))? = Some(lib);
    Ok(())
}

pub fn init(app: &AppHandle) {
    let state = app.state::<AppState>();
    let result = (|| -> AppResult<()> {
        let cfg = load_config(app)?;
        let root = match cfg.library_path {
            Some(p) => p,
            None => default_library_path(app)?,
        };
        activate_library(app, &state, &root)
    })();
    if let Err(e) = result {
        *state.open_error.lock().unwrap() = Some(e.to_string());
    }
}
