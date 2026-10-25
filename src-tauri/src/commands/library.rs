use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use rusqlite::{OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use super::{delete_recording_files, run_blocking};
use crate::error::{AppError, AppResult};
use crate::state::{AppState, MEDIA_DIR};
use crate::tools;
use crate::util::{clean_opt, new_id, now};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub video_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: String,
    pub title: String,
    pub source_url: Option<String>,
    pub platform: String,
    pub channel: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_sec: Option<f64>,
    pub folder_id: Option<String>,
    pub media_path: Option<String>,
    pub media_kind: Option<String>,
    pub media_status: String,
    pub media_error: Option<String>,
    pub media_missing: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_practiced_at: Option<String>,
    pub sentence_count: i64,
    pub practiced_count: i64,
}

const VIDEO_SELECT: &str = "SELECT v.id, v.title, v.source_url, v.platform, v.channel, v.thumbnail_url, v.duration_sec,
    v.folder_id, v.media_path, v.media_kind, v.media_status, v.media_error, v.created_at, v.updated_at, v.last_practiced_at,
    (SELECT COUNT(*) FROM sentences s WHERE s.video_id = v.id),
    (SELECT COUNT(*) FROM sentences s WHERE s.video_id = v.id AND s.practice_state = 'practiced')
    FROM videos v";

fn video_from_row(row: &Row, root: &Path) -> rusqlite::Result<Video> {
    let media_rel: Option<String> = row.get(8)?;
    let media_abs = media_rel.as_ref().map(|r| root.join(r));
    let media_missing = media_abs.as_ref().is_some_and(|p| !p.is_file());
    Ok(Video {
        id: row.get(0)?,
        title: row.get(1)?,
        source_url: row.get(2)?,
        platform: row.get(3)?,
        channel: row.get(4)?,
        thumbnail_url: row.get(5)?,
        duration_sec: row.get(6)?,
        folder_id: row.get(7)?,
        media_path: media_abs.map(|p| p.display().to_string()),
        media_kind: row.get(9)?,
        media_status: row.get(10)?,
        media_error: row.get(11)?,
        media_missing,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        last_practiced_at: row.get(14)?,
        sentence_count: row.get(15)?,
        practiced_count: row.get(16)?,
    })
}

pub fn load_video(conn: &rusqlite::Connection, root: &Path, id: &str) -> AppResult<Video> {
    conn.query_row(&format!("{VIDEO_SELECT} WHERE v.id = ?1"), [id], |r| video_from_row(r, root))
        .optional()?
        .ok_or_else(|| AppError::NotFound("video".into()))
}

pub fn detect_platform(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.contains("youtube.com/") || lower.contains("youtu.be/") {
        "youtube"
    } else if lower.contains("facebook.com/") || lower.contains("fb.watch/") || lower.contains("fb.com/") {
        "facebook"
    } else {
        "other"
    }
}

// ---------- folders ----------

#[tauri::command]
pub fn list_folders(state: State<AppState>) -> AppResult<Vec<Folder>> {
    state.with(|lib| {
        let mut stmt = lib.conn.prepare(
            "SELECT f.id, f.name, f.parent_id, (SELECT COUNT(*) FROM videos v WHERE v.folder_id = f.id)
             FROM folders f ORDER BY f.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Folder { id: r.get(0)?, name: r.get(1)?, parent_id: r.get(2)?, video_count: r.get(3)? })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    })
}

#[tauri::command]
pub fn create_folder(state: State<AppState>, name: String, parent_id: Option<String>) -> AppResult<String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::invalid("Folder name cannot be empty"));
    }
    state.with(|lib| {
        let id = new_id();
        let ts = now();
        lib.conn.execute(
            "INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![id, name, parent_id, ts],
        )?;
        Ok(id)
    })
}

#[tauri::command]
pub fn rename_folder(state: State<AppState>, id: String, name: String) -> AppResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::invalid("Folder name cannot be empty"));
    }
    state.with(|lib| {
        lib.conn.execute("UPDATE folders SET name = ?1, updated_at = ?2 WHERE id = ?3", params![name, now(), id])?;
        Ok(())
    })
}

/// Deletes the folder and its sub-folders. Videos inside are kept and moved to "no folder".
#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| {
        lib.conn.execute("DELETE FROM folders WHERE id = ?1", [id])?;
        Ok(())
    })
}

// ---------- videos ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoQuery {
    pub folder_id: Option<String>,
    pub search: Option<String>,
    pub recent_only: Option<bool>,
}

#[tauri::command]
pub fn list_videos(state: State<AppState>, query: VideoQuery) -> AppResult<Vec<Video>> {
    state.with(|lib| {
        let mut sql = format!("{VIDEO_SELECT} WHERE 1=1");
        let mut args: Vec<String> = Vec::new();
        if let Some(f) = query.folder_id.filter(|f| !f.is_empty()) {
            args.push(f);
            sql.push_str(&format!(" AND v.folder_id = ?{}", args.len()));
        }
        if let Some(s) = clean_opt(query.search) {
            args.push(format!("%{s}%"));
            let n = args.len();
            sql.push_str(&format!(" AND (v.title LIKE ?{n} OR v.channel LIKE ?{n} OR v.source_url LIKE ?{n})"));
        }
        if query.recent_only.unwrap_or(false) {
            sql.push_str(" AND v.last_practiced_at IS NOT NULL ORDER BY v.last_practiced_at DESC LIMIT 30");
        } else {
            sql.push_str(" ORDER BY COALESCE(v.last_practiced_at, v.created_at) DESC");
        }
        let root = lib.root.clone();
        let mut stmt = lib.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| video_from_row(r, &root))?;
        Ok(rows.collect::<Result<_, _>>()?)
    })
}

#[tauri::command]
pub fn get_video(state: State<AppState>, id: String) -> AppResult<Video> {
    state.with(|lib| load_video(&lib.conn, &lib.root, &id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewVideo {
    pub title: String,
    pub source_url: Option<String>,
    pub channel: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_sec: Option<f64>,
    pub folder_id: Option<String>,
}

#[tauri::command]
pub fn create_video(state: State<AppState>, input: NewVideo) -> AppResult<Video> {
    let url = clean_opt(input.source_url);
    let platform = url.as_deref().map(detect_platform).unwrap_or("none");
    let title = clean_opt(Some(input.title)).or_else(|| url.clone()).unwrap_or_else(|| "Untitled".into());
    state.with(|lib| {
        let id = new_id();
        let ts = now();
        lib.conn.execute(
            "INSERT INTO videos (id, title, source_url, platform, channel, thumbnail_url, duration_sec, folder_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, title, url, platform, clean_opt(input.channel), clean_opt(input.thumbnail_url), input.duration_sec, clean_opt(input.folder_id), ts],
        )?;
        load_video(&lib.conn, &lib.root, &id)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPatch {
    pub title: Option<String>,
    pub channel: Option<String>,
    /// Some("") moves the video out of any folder.
    pub folder_id: Option<String>,
}

#[tauri::command]
pub fn update_video(state: State<AppState>, id: String, patch: VideoPatch) -> AppResult<Video> {
    state.with(|lib| {
        let tx = lib.conn.transaction()?;
        let ts = now();
        if let Some(t) = clean_opt(patch.title) {
            tx.execute("UPDATE videos SET title = ?1, updated_at = ?2 WHERE id = ?3", params![t, ts, id])?;
        }
        if let Some(c) = patch.channel {
            tx.execute("UPDATE videos SET channel = ?1, updated_at = ?2 WHERE id = ?3", params![clean_opt(Some(c)), ts, id])?;
        }
        if let Some(f) = patch.folder_id {
            tx.execute("UPDATE videos SET folder_id = ?1, updated_at = ?2 WHERE id = ?3", params![clean_opt(Some(f)), ts, id])?;
        }
        tx.commit()?;
        load_video(&lib.conn, &lib.root, &id)
    })
}

#[tauri::command]
pub fn delete_video(state: State<AppState>, id: String) -> AppResult<()> {
    state.with(|lib| {
        let rec_paths: Vec<String> = {
            let mut stmt = lib.conn.prepare(
                "SELECT r.file_path FROM recordings r JOIN sentences s ON s.id = r.sentence_id WHERE s.video_id = ?1",
            )?;
            stmt.query_map([&id], |r| r.get(0))?.collect::<Result<_, _>>()?
        };
        lib.conn.execute("DELETE FROM videos WHERE id = ?1", [&id])?;
        delete_recording_files(&lib.root, &rec_paths);
        let dir = lib.root.join(MEDIA_DIR).join(&id);
        if dir.is_dir() {
            std::fs::remove_dir_all(dir)?;
        }
        Ok(())
    })
}

// ---------- local files ----------

const AUDIO_EXT: &[&str] = &["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "aiff", "aif"];
const VIDEO_EXT: &[&str] = &["mp4", "m4v", "mov", "webm", "mkv", "avi"];

fn media_kind_for(path: &Path) -> AppResult<&'static str> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if AUDIO_EXT.contains(&ext.as_str()) {
        Ok("audio")
    } else if VIDEO_EXT.contains(&ext.as_str()) {
        Ok(if tools::has_video_stream(path) == Some(false) { "audio" } else { "video" })
    } else {
        Err(AppError::invalid(format!("Unsupported file type: .{ext}")))
    }
}

fn safe_file_name(path: &Path) -> String {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("media");
    name.chars().map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' }).collect()
}

/// Copies a file into `media/<video_id>/` and returns (relative path, kind, duration).
fn copy_into_library(root: &Path, video_id: &str, src: &Path) -> AppResult<(String, String, Option<f64>)> {
    if !src.is_file() {
        return Err(AppError::invalid("The selected file does not exist"));
    }
    let kind = media_kind_for(src)?;
    let dir = root.join(MEDIA_DIR).join(video_id);
    std::fs::create_dir_all(&dir)?;
    let name = safe_file_name(src);
    let dest = dir.join(&name);
    std::fs::copy(src, &dest)?;
    let src_len = std::fs::metadata(src)?.len();
    if std::fs::metadata(&dest)?.len() != src_len {
        let _ = std::fs::remove_file(&dest);
        return Err(AppError::invalid("Copy verification failed (size mismatch)"));
    }
    let rel = format!("{MEDIA_DIR}/{video_id}/{name}");
    Ok((rel, kind.to_string(), tools::probe_duration(&dest)))
}

#[tauri::command]
pub async fn import_media_file(state: State<'_, AppState>, path: String, folder_id: Option<String>) -> AppResult<Video> {
    let root = state.root()?;
    let id = new_id();
    let src = PathBuf::from(&path);
    let (id2, root2) = (id.clone(), root.clone());
    let (rel, kind, duration) = run_blocking(move || copy_into_library(&root2, &id2, &src)).await?;
    let title = Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("Imported media").to_string();
    let platform = if kind == "audio" { "local_audio" } else { "local_video" };
    state.with(|lib| {
        let ts = now();
        lib.conn.execute(
            "INSERT INTO videos (id, title, platform, duration_sec, folder_id, media_path, media_kind, media_status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ready', ?8, ?8)",
            params![id, title, platform, duration, clean_opt(folder_id), rel, kind, ts],
        )?;
        load_video(&lib.conn, &lib.root, &id)
    })
}

/// Attaches a user-owned local file to an existing (e.g. link-only) entry.
#[tauri::command]
pub async fn attach_media_file(state: State<'_, AppState>, video_id: String, path: String) -> AppResult<Video> {
    let root = state.root()?;
    let (id2, root2, src) = (video_id.clone(), root.clone(), PathBuf::from(path));
    let (rel, kind, duration) = run_blocking(move || copy_into_library(&root2, &id2, &src)).await?;
    state.with(|lib| {
        lib.conn.execute(
            "UPDATE videos SET media_path = ?1, media_kind = ?2, duration_sec = COALESCE(?3, duration_sec),
             media_status = 'ready', media_error = NULL, updated_at = ?4 WHERE id = ?5",
            params![rel, kind, duration, now(), video_id],
        )?;
        load_video(&lib.conn, &lib.root, &video_id)
    })
}

// ---------- online metadata / download ----------

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UrlMetadata {
    pub platform: String,
    pub url: String,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub thumbnail_url: Option<String>,
    pub duration_sec: Option<f64>,
    pub has_english_captions: bool,
    pub downloadable: bool,
    pub error: Option<String>,
}

fn metadata_via_ytdlp(url: &str) -> AppResult<UrlMetadata> {
    let out = tools::yt_dlp()?.args(["-J", "--skip-download", "--socket-timeout", "20"]).arg(url).output()?;
    if !out.status.success() {
        return Err(AppError::invalid(tools::error_summary(&out.stderr)));
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout)?;
    let has_en = |key: &str| v.get(key).and_then(|s| s.as_object()).is_some_and(|m| m.keys().any(|k| k == "en" || k.starts_with("en-")));
    let s = |key: &str| v.get(key).and_then(|x| x.as_str()).map(String::from);
    Ok(UrlMetadata {
        platform: detect_platform(url).into(),
        url: url.into(),
        title: s("title").or_else(|| s("fulltitle")),
        channel: s("channel").or_else(|| s("uploader")),
        thumbnail_url: s("thumbnail"),
        duration_sec: v.get("duration").and_then(|d| d.as_f64()),
        has_english_captions: has_en("subtitles") || has_en("automatic_captions"),
        downloadable: v.get("formats").and_then(|f| f.as_array()).is_some_and(|f| !f.is_empty()) || v.get("url").is_some(),
        error: None,
    })
}

async fn metadata_via_oembed(url: &str) -> AppResult<UrlMetadata> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;
    let v: serde_json::Value = client
        .get("https://www.youtube.com/oembed")
        .query(&[("url", url), ("format", "json")])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let s = |key: &str| v.get(key).and_then(|x| x.as_str()).map(String::from);
    Ok(UrlMetadata {
        platform: "youtube".into(),
        url: url.into(),
        title: s("title"),
        channel: s("author_name"),
        thumbnail_url: s("thumbnail_url"),
        ..Default::default()
    })
}

#[tauri::command]
pub async fn fetch_url_metadata(url: String) -> AppResult<UrlMetadata> {
    let url = url.trim().to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::invalid("Please paste a full link starting with https://"));
    }
    let platform = detect_platform(&url);
    if tools::find("yt-dlp").is_some() {
        let u = url.clone();
        match run_blocking(move || metadata_via_ytdlp(&u)).await {
            Ok(m) => return Ok(m),
            Err(e) if platform == "youtube" => {
                if let Ok(mut m) = metadata_via_oembed(&url).await {
                    m.error = Some(e.to_string());
                    return Ok(m);
                }
                return Ok(UrlMetadata { platform: platform.into(), url, error: Some(e.to_string()), ..Default::default() });
            }
            Err(e) => return Ok(UrlMetadata { platform: platform.into(), url, error: Some(e.to_string()), ..Default::default() }),
        }
    }
    if platform == "youtube" {
        return metadata_via_oembed(&url).await;
    }
    Ok(UrlMetadata {
        platform: platform.into(),
        url,
        error: Some("yt-dlp is not installed, so details could not be fetched. You can still save the link.".into()),
        ..Default::default()
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    video_id: String,
    percent: Option<f64>,
    message: String,
}

fn run_download(app: &AppHandle, root: &Path, video_id: &str, url: &str) -> AppResult<(String, String, Option<f64>)> {
    let dir = root.join(MEDIA_DIR).join(video_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;
    let mut child = tools::yt_dlp()?
        .args(["--newline", "--no-part", "--socket-timeout", "30", "--retries", "3"])
        .args(["-f", "bv*+ba/b", "-S", "vcodec:h264,res:720,acodec:aac", "--merge-output-format", "mp4"])
        .args(["--progress-template", "download:FLPROGRESS %(progress._percent_str)s"])
        .arg("-o")
        .arg(dir.join("video.%(ext)s"))
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stderr = child.stderr.take();
    let err_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut s) = stderr {
            let _ = std::io::Read::read_to_end(&mut s, &mut buf);
        }
        buf
    });
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let (percent, message) = match line.strip_prefix("FLPROGRESS ") {
                Some(p) => (p.trim().trim_end_matches('%').trim().parse().ok(), "Downloading".to_string()),
                None if line.contains("[Merger]") => (Some(100.0), "Merging audio and video".to_string()),
                None => continue,
            };
            let _ = app.emit("download-progress", DownloadProgress { video_id: video_id.into(), percent, message });
        }
    }
    let status = child.wait()?;
    let stderr = err_handle.join().unwrap_or_default();
    if !status.success() {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(AppError::invalid(tools::error_summary(&stderr)));
    }
    // Pick the largest finished file in the directory and verify it.
    let file = std::fs::read_dir(&dir)?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e != "part" && e != "ytdl"))
        .max_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        .ok_or_else(|| AppError::invalid("Download finished but no media file was found"))?;
    if std::fs::metadata(&file)?.len() == 0 {
        return Err(AppError::invalid("Downloaded file is empty"));
    }
    let duration = tools::probe_duration(&file);
    if tools::find("ffprobe").is_some() && duration.is_none() {
        return Err(AppError::invalid("Downloaded file could not be verified as playable media"));
    }
    let kind = media_kind_for(&file).unwrap_or("video").to_string();
    let rel = format!("{MEDIA_DIR}/{video_id}/{}", file.file_name().unwrap().to_string_lossy());
    Ok((rel, kind, duration))
}

/// Downloads a public video with yt-dlp (no login, no cookies). The link entry stays usable on failure.
#[tauri::command]
pub async fn download_media(app: AppHandle, state: State<'_, AppState>, video_id: String) -> AppResult<Video> {
    let (root, url) = state.with(|lib| {
        let url: Option<String> = lib.conn.query_row("SELECT source_url FROM videos WHERE id = ?1", [&video_id], |r| r.get(0))?;
        lib.conn.execute(
            "UPDATE videos SET media_status = 'downloading', media_error = NULL, updated_at = ?1 WHERE id = ?2",
            params![now(), video_id],
        )?;
        Ok((lib.root.clone(), url))
    })?;
    let url = url.ok_or_else(|| AppError::invalid("This item has no link to download"))?;
    let (app2, root2, id2) = (app.clone(), root.clone(), video_id.clone());
    let result = run_blocking(move || run_download(&app2, &root2, &id2, &url)).await;
    state.with(|lib| {
        match &result {
            Ok((rel, kind, duration)) => lib.conn.execute(
                "UPDATE videos SET media_path = ?1, media_kind = ?2, duration_sec = COALESCE(?3, duration_sec),
                 media_status = 'ready', media_error = NULL, updated_at = ?4 WHERE id = ?5",
                params![rel, kind, duration, now(), video_id],
            )?,
            Err(e) => lib.conn.execute(
                "UPDATE videos SET media_status = 'failed', media_error = ?1, updated_at = ?2 WHERE id = ?3",
                params![e.to_string(), now(), video_id],
            )?,
        };
        Ok(())
    })?;
    result?;
    state.with(|lib| load_video(&lib.conn, &lib.root, &video_id))
}

/// Retrieves English captions (manual preferred, otherwise auto-generated) as WebVTT text.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Captions {
    pub content: String,
    pub language: String,
    pub file_name: String,
}

fn fetch_captions_blocking(url: &str, tmp: &Path) -> AppResult<Captions> {
    let out = tools::yt_dlp()?
        .args(["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en,en-US,en-GB,en-orig", "--sub-format", "vtt/best"])
        .args(["--socket-timeout", "20", "-o"])
        .arg(tmp.join("subs.%(ext)s"))
        .arg(url)
        .output()?;
    let mut files: Vec<PathBuf> = std::fs::read_dir(tmp)?.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_file()).collect();
    // One failing language (e.g. rate-limited) should not discard captions that did download.
    if files.is_empty() && !out.status.success() {
        return Err(AppError::invalid(tools::error_summary(&out.stderr)));
    }
    files.sort_by_key(|p| {
        let n = p.file_name().unwrap().to_string_lossy().to_string();
        (if n.ends_with(".en.vtt") { 0 } else if n.ends_with(".vtt") { 1 } else { 2 }, n)
    });
    let file = files.first().ok_or_else(|| AppError::invalid("No English captions are available for this video"))?;
    let name = file.file_name().unwrap().to_string_lossy().to_string();
    let language = name.trim_start_matches("subs.").rsplit_once('.').map(|(l, _)| l.to_string()).unwrap_or_else(|| "en".into());
    Ok(Captions { content: std::fs::read_to_string(file)?, language, file_name: name })
}

#[tauri::command]
pub async fn fetch_captions(state: State<'_, AppState>, video_id: String) -> AppResult<Captions> {
    let (url, tmp) = state.with(|lib| {
        let url: Option<String> = lib.conn.query_row("SELECT source_url FROM videos WHERE id = ?1", [&video_id], |r| r.get(0))?;
        Ok((url, lib.root.join(MEDIA_DIR).join(format!(".captions-{}", new_id()))))
    })?;
    let url = url.ok_or_else(|| AppError::invalid("This item has no link"))?;
    std::fs::create_dir_all(&tmp)?;
    let tmp2 = tmp.clone();
    let result = run_blocking(move || fetch_captions_blocking(&url, &tmp2)).await;
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_detection() {
        assert_eq!(detect_platform("https://www.youtube.com/watch?v=abc"), "youtube");
        assert_eq!(detect_platform("https://youtu.be/abc"), "youtube");
        assert_eq!(detect_platform("https://www.facebook.com/watch/?v=1"), "facebook");
        assert_eq!(detect_platform("https://fb.watch/xyz/"), "facebook");
        assert_eq!(detect_platform("https://vimeo.com/1"), "other");
    }

    #[test]
    fn file_names_are_sanitized() {
        assert_eq!(safe_file_name(Path::new("/x/My clip (1).mp4")), "My_clip__1_.mp4");
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Network test against real links listed in $FL_URLS (one per line).
    #[test]
    #[ignore]
    fn live_metadata_and_captions() {
        let urls = std::fs::read_to_string(std::env::var("FL_URLS").unwrap()).unwrap();
        for url in urls.lines().filter(|l| !l.is_empty()) {
            let m = metadata_via_ytdlp(url);
            println!("META {url}: {:?}", m.as_ref().map(|m| (&m.title, m.duration_sec, m.has_english_captions)).map_err(|e| e.to_string()));
            let dir = tempfile::tempdir().unwrap();
            let c = fetch_captions_blocking(url, dir.path());
            println!("CAPS {url}: {:?}", c.as_ref().map(|c| (c.file_name.clone(), c.content.len())).map_err(|e| e.to_string()));
            if let Ok(c) = c {
                let (_, segs) = crate::parse::parse(&c.content, Some("vtt"));
                println!("  segments: {}", segs.len());
            }
        }
    }
}
