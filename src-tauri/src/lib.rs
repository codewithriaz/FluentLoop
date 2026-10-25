mod commands;
mod db;
mod error;
mod parse;
mod state;
mod tools;
mod util;

use commands::*;
use tauri::Manager;

/// Appends every panic (message, location, thread, backtrace) to ~/Library/Logs/FluentLoop/panic.log.
fn install_panic_log() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(home) = std::env::var_os("HOME") {
            let dir = std::path::PathBuf::from(home).join("Library/Logs/FluentLoop");
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("panic.log")) {
                use std::io::Write;
                let thread = std::thread::current();
                let _ = writeln!(
                    f,
                    "=== {} v{} thread '{}'\n{info}\n{}\n",
                    util::now(),
                    env!("CARGO_PKG_VERSION"),
                    thread.name().unwrap_or("?"),
                    std::backtrace::Backtrace::force_capture()
                );
            }
        }
        default(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_log();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .manage(commands::tts::TtsState::default())
        .setup(|app| {
            state::init(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library::list_folders,
            library::create_folder,
            library::rename_folder,
            library::delete_folder,
            library::list_videos,
            library::get_video,
            library::create_video,
            library::update_video,
            library::delete_video,
            library::import_media_file,
            library::attach_media_file,
            library::fetch_url_metadata,
            library::download_media,
            library::fetch_captions,
            transcript::get_transcript,
            transcript::preview_transcript,
            transcript::read_text_file,
            transcript::import_transcript,
            transcript::import_translations,
            transcript::update_sentence,
            transcript::insert_sentence,
            transcript::delete_sentence,
            transcript::merge_sentence_with_next,
            transcript::split_sentence,
            transcript::move_sentence,
            transcript::set_speakers,
            transcript::alternate_speakers,
            transcript::set_practice_state,
            transcript::export_transcript,
            notes::get_note,
            notes::save_note,
            notes::create_general_note,
            notes::delete_note,
            notes::list_notes,
            notes::export_notes,
            vault::save_sentence,
            vault::unsave_sentence,
            vault::list_saved,
            vault::update_saved,
            vault::delete_saved,
            vault::set_saved_tags,
            vault::list_tags,
            vault::create_tag,
            vault::delete_tag,
            vault::export_saved,
            practice::start_session,
            practice::end_session,
            practice::record_attempt,
            practice::list_sessions,
            recordings::save_recording,
            recordings::list_recordings,
            recordings::delete_recording,
            speech::transcribe_media,
            speech::transcribe_recording,
            tts::tts_status,
            tts::tts_generate,
            tts::list_tts_clips,
            tts::delete_tts_clip,
            tts::export_tts_clip,
            templates::list_templates,
            templates::create_template,
            templates::update_template,
            templates::delete_template,
            ai::get_ai_config,
            ai::set_ai_config,
            ai::set_ai_key,
            ai::clear_ai_key,
            ai::ai_complete,
            settings::get_settings,
            settings::set_setting,
            backup::library_info,
            backup::storage_info,
            backup::create_backup,
            backup::restore_backup,
            backup::change_library,
        ])
        .on_window_event(|window, event| {
            // Flush the WAL into the main database file on exit.
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<state::AppState>();
                let _ = state.with(|lib| Ok(lib.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?));
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running FluentLoop");
}
