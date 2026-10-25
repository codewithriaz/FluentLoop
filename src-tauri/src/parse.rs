//! Transcript parsing (TXT / SRT / VTT) and sentence segmentation.

use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct Cue {
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub text: String,
    pub speaker: Option<char>,
    /// Forces a sentence boundary before this cue (blank line, new timestamp block, speaker change).
    pub break_before: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub text: String,
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub speaker: char,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Format {
    Txt,
    Srt,
    Vtt,
}

impl Format {
    pub fn as_str(self) -> &'static str {
        match self {
            Format::Txt => "txt",
            Format::Srt => "srt",
            Format::Vtt => "vtt",
        }
    }
}

pub fn detect_format(content: &str) -> Format {
    let head = content.trim_start_matches('\u{feff}').trim_start();
    if head.starts_with("WEBVTT") {
        return Format::Vtt;
    }
    let has_arrow = content.lines().take(40).any(|l| {
        let l = l.trim();
        l.contains("-->") && l.split("-->").next().map(|t| parse_timestamp(t.trim()).is_some()).unwrap_or(false)
    });
    if has_arrow { Format::Srt } else { Format::Txt }
}

pub fn parse(content: &str, format: Option<&str>) -> (Format, Vec<Segment>) {
    let fmt = match format {
        Some("srt") => Format::Srt,
        Some("vtt") => Format::Vtt,
        Some("txt") => Format::Txt,
        _ => detect_format(content),
    };
    let cues = match fmt {
        Format::Srt => parse_timed(content, false),
        Format::Vtt => parse_timed(content, true),
        Format::Txt => parse_txt(content),
    };
    (fmt, segment(cues))
}

/// Accepts `hh:mm:ss,mmm`, `hh:mm:ss.mmm`, `mm:ss.mmm`, `m:ss`, optionally wrapped in [] or ().
pub fn parse_timestamp(s: &str) -> Option<f64> {
    let s = s.trim().trim_start_matches(['[', '(']).trim_end_matches([']', ')']);
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let mut total = 0.0;
    for (i, p) in parts.iter().enumerate() {
        let is_last = i == parts.len() - 1;
        let p = if is_last { p.replace(',', ".") } else { p.to_string() };
        if p.is_empty() || !p.chars().all(|c| c.is_ascii_digit() || (is_last && c == '.')) {
            return None;
        }
        let v: f64 = p.parse().ok()?;
        total = total * 60.0 + v;
    }
    Some(total)
}

fn decode_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0;
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    strip_sound_markers(&decode_entities(&out)).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Removes caption sound markers such as "[Music]", "[Applause]", "[BLANK_AUDIO]" (short bracketed text).
fn strip_sound_markers(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(open) = rest.find('[') {
        match rest[open..].find(']') {
            Some(close) if close <= 32 => {
                out.push_str(&rest[..open]);
                rest = &rest[open + close + 1..];
            }
            _ => {
                out.push_str(&rest[..=open]);
                rest = &rest[open + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// SRT and VTT share a block structure: optional id line, a `start --> end` line, then text.
/// For VTT, rolling YouTube auto-captions repeat the previous line, so repeated lines are dropped.
fn parse_timed(content: &str, vtt: bool) -> Vec<Cue> {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let mut cues = Vec::new();
    let mut recent: Vec<String> = Vec::new();
    for block in normalized.split("\n\n") {
        let lines: Vec<&str> = block.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
        let Some(arrow_idx) = lines.iter().position(|l| l.contains("-->")) else { continue };
        if vtt && lines.first().is_some_and(|l| l.starts_with("NOTE") || l.starts_with("STYLE") || l.starts_with("REGION")) {
            continue;
        }
        let mut parts = lines[arrow_idx].split("-->");
        let start = parts.next().and_then(|t| parse_timestamp(t.trim()));
        let end = parts.next().and_then(|t| t.split_whitespace().next()).and_then(parse_timestamp);
        if start.is_none() {
            continue;
        }
        if let (Some(s), Some(e)) = (start, end)
            && vtt && e - s < 0.05 {
                continue; // 10ms transition cues in YouTube auto-captions
            }
        let mut new_lines = Vec::new();
        for raw in &lines[arrow_idx + 1..] {
            let line = strip_tags(raw);
            if line.is_empty() || (vtt && recent.contains(&line)) {
                continue;
            }
            if vtt {
                recent.push(line.clone());
                if recent.len() > 3 {
                    recent.remove(0);
                }
            }
            new_lines.push(line);
        }
        if new_lines.is_empty() {
            continue;
        }
        cues.push(Cue { start, end, text: new_lines.join(" "), speaker: None, break_before: false });
    }
    cues
}

/// Splits `0:26 Hello` / `[00:01:02] Hello` into a timestamp and remaining text.
fn leading_timestamp(line: &str) -> Option<(f64, &str)> {
    let first = line.split_whitespace().next()?;
    let ts = parse_timestamp(first)?;
    Some((ts, line[first.len()..].trim()))
}

struct SpeakerMap {
    names: HashMap<String, char>,
}

impl SpeakerMap {
    /// Recognises `A:`, `Person B:`, `Speaker 1:` and up to three capitalised name words, e.g. `John Smith:`.
    fn detect<'a>(&mut self, line: &'a str) -> Option<(char, &'a str)> {
        let colon = line.find(':')?;
        let label = line[..colon].trim();
        let rest = line[colon + 1..].trim();
        if label.is_empty() || label.len() > 25 || rest.is_empty() {
            return None;
        }
        let lower = label.to_lowercase();
        let fixed = match lower.as_str() {
            "a" | "person a" | "speaker a" | "speaker 1" | "person 1" => Some('A'),
            "b" | "person b" | "speaker b" | "speaker 2" | "person 2" => Some('B'),
            _ => None,
        };
        if let Some(c) = fixed {
            return Some((c, rest));
        }
        let words: Vec<&str> = label.split_whitespace().collect();
        let is_name = words.len() <= 3
            && words.iter().all(|w| w.chars().next().is_some_and(char::is_uppercase) && w.chars().all(|c| c.is_alphabetic() || c == '.' || c == '\''));
        if !is_name {
            return None;
        }
        let next = match self.names.len() {
            0 => 'A',
            1 => 'B',
            _ => 'U',
        };
        let c = *self.names.entry(lower).or_insert(next);
        Some((c, rest))
    }
}

fn parse_txt(content: &str) -> Vec<Cue> {
    let mut cues = Vec::new();
    let mut pending_ts: Option<f64> = None;
    let mut brk = true;
    let mut speakers = SpeakerMap { names: HashMap::new() };
    let mut current_speaker: Option<char> = None;
    for raw in content.replace("\r\n", "\n").lines() {
        let line = raw.trim().trim_start_matches('\u{feff}');
        if line.is_empty() {
            brk = true;
            continue;
        }
        if let Some(ts) = parse_timestamp(line) {
            pending_ts = Some(ts);
            brk = true;
            continue;
        }
        let (mut start, mut text) = (pending_ts.take(), line);
        if let Some((ts, rest)) = leading_timestamp(line)
            && !rest.is_empty() {
                start = Some(ts);
                text = rest;
                brk = true;
            }
        if let Some((sp, rest)) = speakers.detect(text) {
            if current_speaker != Some(sp) {
                brk = true;
            }
            current_speaker = Some(sp);
            text = rest;
        }
        let text = decode_entities(text);
        if start.is_some() {
            brk = true;
        }
        cues.push(Cue { start, end: None, text, speaker: current_speaker, break_before: brk });
        brk = false;
    }
    // Fill missing end times from the next timed cue.
    let mut next_start: Option<f64> = None;
    for cue in cues.iter_mut().rev() {
        if cue.start.is_some() {
            cue.end = cue.end.or(next_start);
            next_start = cue.start;
        }
    }
    cues
}

const ABBREVIATIONS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "u.s", "u.k", "a.m", "p.m", "no", "approx", "inc", "ltd", "co",
];

fn is_terminator(c: char) -> bool {
    matches!(c, '.' | '?' | '!' | '…' | '।')
}

/// Splits text into (piece, char_offset, ends_sentence). The final piece may be unterminated.
pub fn split_sentences(text: &str) -> Vec<(String, usize, bool)> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < chars.len() {
        if is_terminator(chars[i]) {
            let mut j = i;
            while j + 1 < chars.len() && (is_terminator(chars[j + 1]) || matches!(chars[j + 1], '"' | '\'' | '”' | '’' | ')' | ']')) {
                j += 1;
            }
            let at_boundary = j + 1 >= chars.len() || chars[j + 1].is_whitespace();
            let abbreviation = chars[i] == '.' && j == i && {
                let word: String = chars[start..i].iter().collect::<String>();
                let last = word.split_whitespace().last().unwrap_or("").to_lowercase();
                let last = last.trim_start_matches(['(', '"', '\'']);
                ABBREVIATIONS.contains(&last) || (last.chars().count() == 1 && last.chars().all(char::is_alphabetic))
            };
            if at_boundary && !abbreviation {
                let piece: String = chars[start..=j].iter().collect();
                if !piece.trim().is_empty() {
                    let lead = piece.chars().count() - piece.trim_start().chars().count();
                    out.push((piece.trim().to_string(), start + lead, true));
                }
                start = j + 1;
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    if start < chars.len() {
        let piece: String = chars[start..].iter().collect();
        if !piece.trim().is_empty() {
            let lead = piece.chars().count() - piece.trim_start().chars().count();
            out.push((piece.trim().to_string(), start + lead, false));
        }
    }
    out
}

const MAX_WORDS: usize = 40;

pub fn segment(cues: Vec<Cue>) -> Vec<Segment> {
    let words: usize = cues.iter().map(|c| c.text.split_whitespace().count()).sum();
    let terminators: usize = cues.iter().map(|c| c.text.chars().filter(|c| is_terminator(*c)).count()).sum();
    let timed = cues.iter().filter(|c| c.start.is_some()).count();
    // Auto-captions without punctuation: keep each timed cue as its own line.
    if timed > 0 && timed * 2 >= cues.len() && terminators * 30 < words {
        return cues
            .into_iter()
            .map(|c| Segment { text: c.text, start: c.start, end: c.end, speaker: c.speaker.unwrap_or('U') })
            .collect();
    }

    let mut out = Vec::new();
    let mut acc: Option<Segment> = None;
    let flush = |acc: &mut Option<Segment>, out: &mut Vec<Segment>| {
        if let Some(s) = acc.take()
            && !s.text.trim().is_empty() {
                out.push(s);
            }
    };
    for cue in cues {
        if cue.break_before {
            flush(&mut acc, &mut out);
        }
        let speaker = cue.speaker.unwrap_or('U');
        if acc.as_ref().is_some_and(|a| a.speaker != speaker) {
            flush(&mut acc, &mut out);
        }
        let total = cue.text.chars().count().max(1) as f64;
        let pieces = split_sentences(&cue.text);
        let n = pieces.len();
        for (idx, (piece, offset, ended)) in pieces.into_iter().enumerate() {
            let piece_end_offset = offset + piece.chars().count();
            let interp = |off: usize| match (cue.start, cue.end) {
                (Some(s), Some(e)) => Some(s + (e - s) * (off as f64 / total)),
                (Some(s), None) => Some(s),
                _ => None,
            };
            let p_start = if idx == 0 { cue.start } else { interp(offset) };
            let p_end = if idx == n - 1 { cue.end.or(p_start) } else { interp(piece_end_offset) };
            match acc.as_mut() {
                Some(a) => {
                    a.text.push(' ');
                    a.text.push_str(&piece);
                    if p_end.is_some() {
                        a.end = p_end;
                    }
                    if a.start.is_none() {
                        a.start = p_start;
                    }
                }
                None => acc = Some(Segment { text: piece, start: p_start, end: p_end, speaker }),
            }
            let too_long = acc.as_ref().is_some_and(|a| a.text.split_whitespace().count() >= MAX_WORDS);
            if ended || too_long {
                flush(&mut acc, &mut out);
            }
        }
    }
    flush(&mut acc, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps() {
        assert_eq!(parse_timestamp("00:01:02,500"), Some(62.5));
        assert_eq!(parse_timestamp("01:02.250"), Some(62.25));
        assert_eq!(parse_timestamp("0:26"), Some(26.0));
        assert_eq!(parse_timestamp("[1:00:00]"), Some(3600.0));
        assert_eq!(parse_timestamp("hello"), None);
        assert_eq!(parse_timestamp("Note: x"), None);
    }

    #[test]
    fn detects_formats() {
        assert_eq!(detect_format("WEBVTT\n\n00:00.000 --> 00:01.000\nhi"), Format::Vtt);
        assert_eq!(detect_format("1\n00:00:01,000 --> 00:00:02,000\nHi"), Format::Srt);
        assert_eq!(detect_format("Just text --> arrow"), Format::Txt);
    }

    #[test]
    fn srt_merges_cues_into_sentences() {
        let srt = "1\n00:00:01,000 --> 00:00:03,000\nHello everyone, today we\n\n2\n00:00:03,000 --> 00:00:05,000\ntalk about <i>sales</i>. Are you ready?\n";
        let (_, segs) = parse(srt, None);
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].text, "Hello everyone, today we talk about sales.");
        assert_eq!(segs[0].start, Some(1.0));
        assert!(segs[0].end.unwrap() > 3.0 && segs[0].end.unwrap() < 5.0);
        assert_eq!(segs[1].text, "Are you ready?");
        assert_eq!(segs[1].end, Some(5.0));
    }

    #[test]
    fn vtt_rolling_captions_are_deduplicated() {
        let vtt = "WEBVTT\nKind: captions\n\n00:00:00.000 --> 00:00:02.000 align:start\nso today we<00:00:01.000><c> talk</c>\n\n00:00:02.000 --> 00:00:02.010\nso today we talk\n\n00:00:02.010 --> 00:00:04.000\nso today we talk\nabout client calls\n\n00:00:04.000 --> 00:00:06.000\nabout client calls\nand pricing\n";
        let (_, segs) = parse(vtt, None);
        let texts: Vec<&str> = segs.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, vec!["so today we talk", "about client calls", "and pricing"]);
        assert_eq!(segs[1].start, Some(2.01));
    }

    #[test]
    fn youtube_copy_format() {
        let txt = "0:00\nHi, I'm Sara.\n0:03\nWelcome to the show.\n";
        let (_, segs) = parse(txt, None);
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[1].start, Some(3.0));
        assert_eq!(segs[0].end, Some(3.0));
    }

    #[test]
    fn plain_text_with_speakers_and_abbreviations() {
        let txt = "Person A: Hi Mr. Khan. How are you?\nPerson B: I'm fine, thanks.\nAnd you?\n\nJohn: Great.";
        let (_, segs) = parse(txt, None);
        let pairs: Vec<(&str, char)> = segs.iter().map(|s| (s.text.as_str(), s.speaker)).collect();
        assert_eq!(
            pairs,
            vec![("Hi Mr. Khan.", 'A'), ("How are you?", 'A'), ("I'm fine, thanks.", 'B'), ("And you?", 'B'), ("Great.", 'A')]
        );
    }

    #[test]
    fn wrapped_lines_join_until_sentence_end() {
        let (_, segs) = parse("This sentence wraps\nacross two lines. Next one!", Some("txt"));
        assert_eq!(segs[0].text, "This sentence wraps across two lines.");
        assert_eq!(segs[1].text, "Next one!");
    }

    #[test]
    fn decimals_and_quotes() {
        let parts = split_sentences("It costs 3.5 dollars. She said \"no.\" Then left");
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[1].0, "She said \"no.\"");
        assert!(!parts[2].2);
    }

    #[test]
    fn caption_sound_markers_are_removed() {
        let srt = "1\n00:00:04,000 --> 00:00:06,000\n[Music] Hello English learners.\n\n2\n00:00:06,000 --> 00:00:08,000\n[Applause]\n";
        let (_, segs) = parse(srt, None);
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].text, "Hello English learners.");
    }

    #[test]
    fn bengali_danda_splits() {
        let parts = split_sentences("আমি ভালো আছি। তুমি কেমন আছো?");
        assert_eq!(parts.len(), 2);
    }
}
