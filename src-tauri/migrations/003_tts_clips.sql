-- Speech generated locally with Kokoro-82M. WAV files live in <library>/tts/.
CREATE TABLE tts_clips (
  id           TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  voice        TEXT NOT NULL,
  speed        REAL NOT NULL DEFAULT 1.0,
  file_path    TEXT NOT NULL,
  duration_sec REAL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_tts_clips_created ON tts_clips(created_at);
