pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Normalized form used to detect duplicate saved sentences.
pub fn normalize_sentence(text: &str) -> String {
    let lowered = text.to_lowercase().replace(['\u{2019}', '\u{2018}'], "'").replace(['\u{201c}', '\u{201d}'], "\"");
    let collapsed = lowered.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .trim_matches(|c: char| c.is_ascii_punctuation() && c != '\'' || c == '"' || c == '…' || c == '।')
        .trim()
        .to_string()
}

/// Strips a value to None when it is empty or whitespace.
pub fn clean_opt(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_ignores_case_space_and_end_punctuation() {
        assert_eq!(normalize_sentence("  How   are you?  "), "how are you");
        assert_eq!(normalize_sentence("\u{201c}I\u{2019}m fine.\u{201d}"), "i'm fine");
        assert_eq!(normalize_sentence("Hello"), normalize_sentence("hello!"));
    }
}
