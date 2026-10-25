//! Optional AI assistant. Nothing is sent anywhere unless the user configures a provider,
//! stores a key (kept in the macOS Keychain, never in SQLite or source) and explicitly runs a request.

use serde::Serialize;
use serde_json::{Value, json};
use tauri::State;

use super::settings;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::util::clean_opt;

const KEYCHAIN_SERVICE: &str = "com.fluentloop.app";
const KEYCHAIN_ACCOUNT: &str = "ai-api-key";
const DEFAULT_OPENAI_ENDPOINT: &str = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_MODEL: &str = "claude-opus-5-5";

fn entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| AppError::invalid(format!("Keychain error: {e}")))
}

fn read_key() -> AppResult<Option<String>> {
    match entry()?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::invalid(format!("Keychain error: {e}"))),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    /// "openai" (any OpenAI-compatible endpoint) or "anthropic".
    pub provider: String,
    pub endpoint: String,
    pub model: String,
    pub has_key: bool,
}

fn load_config(conn: &rusqlite::Connection) -> AppResult<AiConfig> {
    let provider = settings::get(conn, "ai_provider")?.unwrap_or_else(|| "openai".into());
    let default_endpoint = if provider == "anthropic" { "https://api.anthropic.com/v1" } else { DEFAULT_OPENAI_ENDPOINT };
    let default_model = if provider == "anthropic" { DEFAULT_ANTHROPIC_MODEL } else { "" };
    Ok(AiConfig {
        endpoint: settings::get(conn, "ai_endpoint")?.filter(|s| !s.is_empty()).unwrap_or_else(|| default_endpoint.into()),
        model: settings::get(conn, "ai_model")?.filter(|s| !s.is_empty()).unwrap_or_else(|| default_model.into()),
        provider,
        has_key: false,
    })
}

#[tauri::command]
pub fn get_ai_config(state: State<AppState>) -> AppResult<AiConfig> {
    let mut cfg = state.with(|lib| load_config(&lib.conn))?;
    cfg.has_key = read_key().ok().flatten().is_some();
    Ok(cfg)
}

#[tauri::command]
pub fn set_ai_config(state: State<AppState>, provider: String, endpoint: String, model: String) -> AppResult<()> {
    if provider != "openai" && provider != "anthropic" {
        return Err(AppError::invalid("Unknown AI provider"));
    }
    let endpoint = endpoint.trim().trim_end_matches('/').to_string();
    if !endpoint.is_empty() && !endpoint.starts_with("https://") && !endpoint.starts_with("http://localhost") && !endpoint.starts_with("http://127.0.0.1") {
        return Err(AppError::invalid("The endpoint must use https:// (or http://localhost for local models)"));
    }
    state.with(|lib| {
        settings::set(&lib.conn, "ai_provider", &provider)?;
        settings::set(&lib.conn, "ai_endpoint", &endpoint)?;
        settings::set(&lib.conn, "ai_model", model.trim())
    })
}

#[tauri::command]
pub fn set_ai_key(key: String) -> AppResult<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::invalid("The API key is empty"));
    }
    entry()?.set_password(key).map_err(|e| AppError::invalid(format!("Keychain error: {e}")))
}

#[tauri::command]
pub fn clear_ai_key() -> AppResult<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::invalid(format!("Keychain error: {e}"))),
    }
}

fn text_from_anthropic(v: &Value) -> AppResult<String> {
    if v.get("stop_reason").and_then(Value::as_str) == Some("refusal") {
        return Err(AppError::invalid("The AI provider declined this request."));
    }
    let text: Vec<&str> = v
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("text")).filter_map(|b| b.get("text").and_then(Value::as_str)).collect())
        .unwrap_or_default();
    if text.is_empty() {
        return Err(AppError::invalid("The AI response contained no text"));
    }
    Ok(text.join("\n"))
}

fn text_from_openai(v: &Value) -> AppResult<String> {
    v.pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| AppError::invalid("The AI response contained no text"))
}

fn api_error(status: reqwest::StatusCode, body: &Value) -> AppError {
    let msg = body.pointer("/error/message").and_then(Value::as_str).unwrap_or("request failed");
    AppError::invalid(format!("AI provider error ({status}): {msg}"))
}

/// Sends the given text to the configured provider and returns its reply.
#[tauri::command]
pub async fn ai_complete(state: State<'_, AppState>, system: String, prompt: String) -> AppResult<String> {
    let cfg = state.with(|lib| load_config(&lib.conn))?;
    let key = read_key()?.ok_or_else(|| AppError::invalid("Add an API key in Settings → AI first"))?;
    let model = clean_opt(Some(cfg.model)).ok_or_else(|| AppError::invalid("Choose a model in Settings → AI first"))?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(180)).build()?;
    let (resp, anthropic) = if cfg.provider == "anthropic" {
        let body = json!({
            "model": model,
            "max_tokens": 16000,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
            "fallbacks": "default",
        });
        let r = client
            .post(format!("{}/messages", cfg.endpoint))
            .header("x-api-key", key)
            .header("anthropic-version", "2026-10-21")
            .header("anthropic-beta", "server-side-fallback-2026-07-01")
            .json(&body)
            .send()
            .await?;
        (r, true)
    } else {
        let body = json!({
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        });
        let r = client.post(format!("{}/chat/completions", cfg.endpoint)).bearer_auth(key).json(&body).send().await?;
        (r, false)
    };
    let status = resp.status();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(api_error(status, &v));
    }
    if anthropic { text_from_anthropic(&v) } else { text_from_openai(&v) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_provider_responses() {
        let a = json!({"stop_reason": "end_turn", "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": "Hello"}]});
        assert_eq!(text_from_anthropic(&a).unwrap(), "Hello");
        assert!(text_from_anthropic(&json!({"stop_reason": "refusal", "content": []})).is_err());
        let o = json!({"choices": [{"message": {"content": "Hi"}}]});
        assert_eq!(text_from_openai(&o).unwrap(), "Hi");
    }
}
