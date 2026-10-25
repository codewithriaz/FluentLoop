//! Local text-to-speech with Kokoro-82M (Apache-2.0). Text never leaves the Mac.
//!
//! The official Kokoro implementation is Python, so the backend starts `tts/kokoro_worker.py`
//! (embedded below) as a child process inside an isolated venv and talks to it over stdin/stdout
//! JSON lines. There is no network listener. The worker stays alive between generations so the
//! model is loaded only once; it exits when FluentLoop closes its stdin.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::{OptionalExtension, Row, params};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

use super::run_blocking;
use crate::error::{AppError, AppResult};
use crate::state::{AppState, TTS_DIR};
use crate::util::{new_id, now};

const WORKER_SCRIPT: &str = include_str!("../../tts/kokoro_worker.py");
const MODEL_DIR: &str = "models--hexgrad--Kokoro-82M";
pub const MAX_CHARS: usize = 10_000;

/// The 28 English voices shipped with Kokoro v1.0 (a* = American, b* = British; *f = female, *m = male).
pub const VOICES: &[&str] = &[
    "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
    "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
    "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
];

struct Worker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct TtsState {
    worker: Mutex<Option<Worker>>,
    busy: AtomicBool,
}

/// Clears the busy flag even if generation fails or panics.
struct BusyGuard<'a>(&'a AtomicBool);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub fn venv_python() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var_os("HOME")?).join(".local/share/fluentloop/tts-venv/bin/python");
    p.is_file().then_some(p)
}

fn hf_home(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::invalid(e.to_string()))?;
    Ok(dir.join("models").join("huggingface"))
}

fn model_cached(hf: &std::path::Path) -> bool {
    let snaps = hf.join("hub").join(MODEL_DIR).join("snapshots");
    std::fs::read_dir(snaps)
        .map(|entries| entries.filter_map(Result::ok).any(|e| e.path().join("kokoro-v1_0.pth").is_file()))
        .unwrap_or(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsStatus {
    pub python: Option<String>,
    pub model_cache: String,
    pub model_ready: bool,
    pub max_chars: usize,
    pub busy: bool,
}

#[tauri::command]
pub fn tts_status(app: AppHandle, tts: State<TtsState>) -> AppResult<TtsStatus> {
    let hf = hf_home(&app)?;
    Ok(TtsStatus {
        python: venv_python().map(|p| p.display().to_string()),
        model_ready: model_cached(&hf),
        model_cache: hf.display().to_string(),
        max_chars: MAX_CHARS,
        busy: tts.busy.load(Ordering::SeqCst),
    })
}

fn read_json(stdout: &mut BufReader<ChildStdout>) -> AppResult<Option<Value>> {
    let mut line = String::new();
    loop {
        line.clear();
        if stdout.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
            return Ok(Some(v));
        }
    }
}

fn log_tail(app: &AppHandle) -> String {
    let path = app.path().app_data_dir().map(|d| d.join("tts").join("worker.log")).ok();
    let text = path.and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(4)..].join("\n")
}

fn spawn_worker(app: &AppHandle) -> AppResult<Worker> {
    let python = venv_python().ok_or_else(|| AppError::invalid("The text-to-speech engine is not installed. Run scripts/setup-tts.sh (see Settings → Media tools)."))?;
    let hf = hf_home(app)?;
    if !model_cached(&hf) {
        return Err(AppError::invalid("The Kokoro model is not downloaded yet. Run scripts/setup-tts.sh once."));
    }
    let dir = app.path().app_data_dir().map_err(|e| AppError::invalid(e.to_string()))?.join("tts");
    std::fs::create_dir_all(&dir)?;
    let script = dir.join("kokoro_worker.py");
    if std::fs::read_to_string(&script).ok().as_deref() != Some(WORKER_SCRIPT) {
        std::fs::write(&script, WORKER_SCRIPT)?;
    }
    start_worker(&python, &script, &hf, &dir.join("worker.log")).map_err(|e| match e {
        AppError::Invalid(m) if m.ends_with("while loading.") => AppError::invalid(format!("{m}\n{}", log_tail(app))),
        other => other,
    })
}

/// Starts the worker and waits for its "ready" line (model loaded).
fn start_worker(python: &std::path::Path, script: &std::path::Path, hf: &std::path::Path, log_path: &std::path::Path) -> AppResult<Worker> {
    let log = std::fs::OpenOptions::new().create(true).write(true).truncate(true).open(log_path)?;
    let mut child = Command::new(python)
        .arg(script)
        .env("HF_HOME", hf)
        .env("HF_HUB_OFFLINE", "1") // model + voices are cached; never contact the network
        .env("PYTHONUNBUFFERED", "1")
        .env("TOKENIZERS_PARALLELISM", "false")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log))
        .spawn()?;
    let stdin = child.stdin.take().ok_or_else(|| AppError::invalid("worker stdin unavailable"))?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or_else(|| AppError::invalid("worker stdout unavailable"))?);
    match read_json(&mut stdout)? {
        Some(v) if v["type"] == "ready" => Ok(Worker { child, stdin, stdout }),
        Some(v) => Err(AppError::invalid(format!("The speech engine failed to start: {}", v["message"].as_str().unwrap_or("unknown error")))),
        None => Err(AppError::invalid("The speech engine stopped while loading.")),
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TtsProgress {
    done: u64,
    total: u64,
}

/// Sends one request to the (possibly newly started) worker and waits for the result.
fn generate_blocking(app: &AppHandle, slot: &Mutex<Option<Worker>>, req: Value) -> AppResult<f64> {
    let mut guard = slot.lock().map_err(|_| AppError::invalid("speech engine lock poisoned"))?;
    let alive = guard.as_mut().is_some_and(|w| matches!(w.child.try_wait(), Ok(None)));
    if !alive {
        *guard = None;
        let _ = app.emit("tts-progress", TtsProgress { done: 0, total: 0 });
        *guard = Some(spawn_worker(app)?);
    }
    let worker = guard.as_mut().expect("worker started above");
    let result = run_request(worker, &req, |done, total| {
        let _ = app.emit("tts-progress", TtsProgress { done, total });
    });
    match result {
        Ok(Some(duration)) => Ok(duration),
        Ok(None) => {
            *guard = None; // crashed; restart on the next request
            Err(AppError::invalid(format!("The speech engine stopped unexpectedly.\n{}", log_tail(app))))
        }
        Err(e) => Err(e),
    }
}

/// Sends one request and waits for its result. `Ok(None)` means the worker exited.
fn run_request(worker: &mut Worker, req: &Value, on_progress: impl Fn(u64, u64)) -> AppResult<Option<f64>> {
    writeln!(worker.stdin, "{req}")?;
    worker.stdin.flush()?;
    loop {
        match read_json(&mut worker.stdout)? {
            None => return Ok(None),
            Some(v) if v["id"] != req["id"] => continue,
            Some(v) => match v["type"].as_str() {
                Some("progress") => on_progress(v["done"].as_u64().unwrap_or(0), v["total"].as_u64().unwrap_or(0)),
                Some("done") => return Ok(Some(v["duration"].as_f64().unwrap_or(0.0))),
                _ => return Err(AppError::invalid(v["message"].as_str().unwrap_or("Speech generation failed").to_string())),
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsClip {
    pub id: String,
    pub text: String,
    pub voice: String,
    pub speed: f64,
    pub file_path: String,
    pub duration_sec: Option<f64>,
    pub created_at: String,
    pub file_missing: bool,
}

fn clip_from_row(r: &Row, root: &std::path::Path) -> rusqlite::Result<TtsClip> {
    let path = root.join(r.get::<_, String>(4)?);
    Ok(TtsClip {
        id: r.get(0)?,
        text: r.get(1)?,
        voice: r.get(2)?,
        speed: r.get(3)?,
        file_missing: !path.is_file(),
        file_path: path.display().to_string(),
        duration_sec: r.get(5)?,
        created_at: r.get(6)?,
    })
}

const CLIP_SELECT: &str = "SELECT id, text, voice, speed, file_path, duration_sec, created_at FROM tts_clips";

pub fn validate(text: &str, voice: &str, speed: f64) -> AppResult<()> {
    if text.trim().is_empty() {
        return Err(AppError::invalid("Type or paste some text first"));
    }
    if text.chars().count() > MAX_CHARS {
        return Err(AppError::invalid(format!("The text is too long ({} characters). The limit is {MAX_CHARS}.", text.chars().count())));
    }
    if !VOICES.contains(&voice) {
        return Err(AppError::invalid(format!("Unknown voice: {voice}")));
    }
    if !(0.5..=2.0).contains(&speed) {
        return Err(AppError::invalid("Speed must be between 0.5× and 2×"));
    }
    Ok(())
}

#[tauri::command]
pub async fn tts_generate(app: AppHandle, state: State<'_, AppState>, tts: State<'_, TtsState>, text: String, voice: String, speed: f64) -> AppResult<TtsClip> {
    validate(&text, &voice, speed)?;
    if tts.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err(AppError::invalid("Speech is already being generated. Please wait for it to finish."));
    }
    let _busy = BusyGuard(&tts.busy);
    let root = state.root()?;
    let id = new_id();
    let rel = format!("{TTS_DIR}/{id}.wav");
    let out = root.join(&rel);
    let req = json!({ "id": id, "text": text, "voice": voice, "speed": speed, "out": out.display().to_string() });
    // The worker lives in managed state; the blocking task reaches it through its own AppHandle.
    let app2 = app.clone();
    let duration = run_blocking(move || generate_blocking(&app2, &app2.state::<TtsState>().worker, req)).await?;
    if !out.is_file() {
        return Err(AppError::invalid("The audio file was not written"));
    }
    state.with(|lib| {
        lib.conn.execute(
            "INSERT INTO tts_clips (id, text, voice, speed, file_path, duration_sec, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, text, voice, speed, rel, duration, now()],
        )?;
        Ok(lib.conn.query_row(&format!("{CLIP_SELECT} WHERE id = ?1"), [&id], |r| clip_from_row(r, &lib.root))?)
    })
}

#[tauri::command]
pub fn list_tts_clips(state: State<AppState>) -> AppResult<Vec<TtsClip>> {
    state.with(|lib| {
        let mut stmt = lib.conn.prepare(&format!("{CLIP_SELECT} ORDER BY created_at DESC LIMIT 200"))?;
        let root = lib.root.clone();
        let rows = stmt.query_map([], |r| clip_from_row(r, &root))?;
        Ok(rows.collect::<Result<_, _>>()?)
    })
}

#[tauri::command]
pub fn delete_tts_clip(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| {
        let rel: Option<String> = lib.conn.query_row("SELECT file_path FROM tts_clips WHERE id = ?1", [&id], |r| r.get(0)).optional()?;
        lib.conn.execute("DELETE FROM tts_clips WHERE id = ?1", [&id])?;
        if let Some(rel) = rel {
            let _ = std::fs::remove_file(lib.root.join(rel));
        }
        Ok(())
    })
}

/// Copies a generated WAV to a user-chosen location (the "Download WAV" button).
#[tauri::command]
pub fn export_tts_clip(state: State<AppState>, id: String, dest: String) -> AppResult<()> {
    state.with(|lib| {
        let rel: String = lib
            .conn
            .query_row("SELECT file_path FROM tts_clips WHERE id = ?1", [&id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| AppError::NotFound("audio".into()))?;
        std::fs::copy(lib.root.join(rel), &dest)?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_input() {
        assert!(validate("Hello", "af_heart", 1.0).is_ok());
        assert!(validate("   ", "af_heart", 1.0).unwrap_err().to_string().contains("Type or paste"));
        assert!(validate(&"a".repeat(MAX_CHARS + 1), "af_heart", 1.0).unwrap_err().to_string().contains("too long"));
        assert!(validate("Hi", "../../x", 1.0).is_err());
        assert!(validate("Hi", "af_heart", 3.0).is_err());
        assert_eq!(VOICES.len(), 28);
    }

    /// Real Rust <-> Python round trip with the installed venv and cached model.
    /// Run with `cargo test -- --ignored kokoro_end_to_end`.
    #[test]
    #[ignore]
    fn kokoro_end_to_end() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("w.py");
        std::fs::write(&script, WORKER_SCRIPT).unwrap();
        let hf = PathBuf::from(std::env::var("HOME").unwrap()).join("Library/Application Support/com.fluentloop.app/models/huggingface");
        let mut w = start_worker(&venv_python().expect("venv"), &script, &hf, &dir.path().join("log")).unwrap();
        for (i, voice) in ["af_heart", "bm_george"].iter().enumerate() {
            let out = dir.path().join(format!("{i}.wav"));
            let progress = std::cell::Cell::new(0);
            let req = json!({"id": i.to_string(), "text": "Hello! This is a local test.\n\nSecond paragraph.", "voice": voice, "speed": 1.0, "out": out.display().to_string()});
            let dur = run_request(&mut w, &req, |d, _| progress.set(d)).unwrap().unwrap();
            assert!(dur > 1.0, "{voice}: {dur}");
            assert_eq!(progress.get(), 2);
            let bytes = std::fs::read(&out).unwrap();
            assert_eq!(&bytes[0..4], b"RIFF");
            assert_eq!(&bytes[8..12], b"WAVE");
        }
        let bad = json!({"id": "x", "text": " ", "voice": "af_heart", "out": dir.path().join("x.wav").display().to_string()});
        assert!(run_request(&mut w, &bad, |_, _| {}).unwrap_err().to_string().contains("empty"));
    }

    #[test]
    fn migration_creates_tts_table() {
        let conn = crate::db::open_memory();
        conn.execute("INSERT INTO tts_clips (id,text,voice,file_path,created_at) VALUES ('c','Hi','af_heart','tts/c.wav','x')", []).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM tts_clips", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }
}
