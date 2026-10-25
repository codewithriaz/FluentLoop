-- FluentLoop schema v1. All IDs are UUID v4 strings. Timestamps are RFC 3339 UTC strings.
-- Media files live on disk under the library root; paths stored here are relative to it.

CREATE TABLE folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_folders_parent ON folders(parent_id);

CREATE TABLE videos (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  source_url        TEXT,
  platform          TEXT NOT NULL CHECK (platform IN ('youtube','facebook','local_video','local_audio','other','none')),
  channel           TEXT,
  thumbnail_url     TEXT,
  duration_sec      REAL,
  folder_id         TEXT REFERENCES folders(id) ON DELETE SET NULL,
  media_path        TEXT,
  media_kind        TEXT CHECK (media_kind IN ('video','audio')),
  media_status      TEXT NOT NULL DEFAULT 'none' CHECK (media_status IN ('none','downloading','ready','failed')),
  media_error       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_practiced_at TEXT
);
CREATE INDEX idx_videos_folder ON videos(folder_id);
CREATE INDEX idx_videos_last_practiced ON videos(last_practiced_at);

CREATE TABLE transcripts (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL UNIQUE REFERENCES videos(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  language    TEXT NOT NULL DEFAULT 'en',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Sentences double as dialogue turns (speaker A/B/U). Identity is the stable id, never position.
CREATE TABLE sentences (
  id                TEXT PRIMARY KEY,
  transcript_id     TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  video_id          TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position          REAL NOT NULL,
  text              TEXT NOT NULL,
  translation       TEXT,
  start_sec         REAL,
  end_sec           REAL,
  speaker           TEXT NOT NULL DEFAULT 'U' CHECK (speaker IN ('A','B','U')),
  practice_state    TEXT NOT NULL DEFAULT 'new' CHECK (practice_state IN ('new','practiced','difficult')),
  practice_count    INTEGER NOT NULL DEFAULT 0,
  last_practiced_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_sentences_transcript ON sentences(transcript_id, position);
CREATE INDEX idx_sentences_video ON sentences(video_id);

CREATE VIEW dialogue_turns AS
  SELECT id, video_id,
         ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY position) AS sequence,
         speaker, text AS original, start_sec AS timestamp_sec, translation, practice_state
  FROM sentences;

-- One note per entity (polymorphic). 'general' notes are free-standing notebook pages.
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('video','folder','transcript','sentence','saved_sentence','practice_session','template','general')),
  entity_id   TEXT NOT NULL,
  title       TEXT,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (entity_type, entity_id)
);
CREATE INDEX idx_notes_updated ON notes(updated_at);

CREATE TABLE saved_sentences (
  id                TEXT PRIMARY KEY,
  text              TEXT NOT NULL,
  normalized        TEXT NOT NULL UNIQUE,
  meaning           TEXT,
  example           TEXT,
  speaker           TEXT NOT NULL DEFAULT 'U' CHECK (speaker IN ('A','B','U')),
  status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','practiced','difficult')),
  practice_count    INTEGER NOT NULL DEFAULT 0,
  last_practiced_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE sentence_sources (
  id                TEXT PRIMARY KEY,
  saved_sentence_id TEXT NOT NULL REFERENCES saved_sentences(id) ON DELETE CASCADE,
  video_id          TEXT REFERENCES videos(id) ON DELETE SET NULL,
  sentence_id       TEXT REFERENCES sentences(id) ON DELETE SET NULL,
  video_title       TEXT,
  start_sec         REAL,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_sources_saved ON sentence_sources(saved_sentence_id);
CREATE UNIQUE INDEX idx_sources_unique ON sentence_sources(saved_sentence_id, sentence_id) WHERE sentence_id IS NOT NULL;

CREATE TABLE tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE sentence_tags (
  saved_sentence_id TEXT NOT NULL REFERENCES saved_sentences(id) ON DELETE CASCADE,
  tag_id            TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (saved_sentence_id, tag_id)
);
CREATE INDEX idx_sentence_tags_tag ON sentence_tags(tag_id);

CREATE TABLE recordings (
  id                TEXT PRIMARY KEY,
  sentence_id       TEXT REFERENCES sentences(id) ON DELETE CASCADE,
  saved_sentence_id TEXT REFERENCES saved_sentences(id) ON DELETE CASCADE,
  file_path         TEXT NOT NULL,
  mime              TEXT,
  duration_sec      REAL,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_recordings_sentence ON recordings(sentence_id);
CREATE INDEX idx_recordings_saved ON recordings(saved_sentence_id);

CREATE TABLE practice_sessions (
  id         TEXT PRIMARY KEY,
  video_id   TEXT REFERENCES videos(id) ON DELETE CASCADE,
  mode       TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at   TEXT
);
CREATE INDEX idx_sessions_video ON practice_sessions(video_id, started_at);

CREATE TABLE practice_attempts (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  sentence_id       TEXT REFERENCES sentences(id) ON DELETE CASCADE,
  saved_sentence_id TEXT REFERENCES saved_sentences(id) ON DELETE CASCADE,
  action            TEXT NOT NULL CHECK (action IN ('practiced','difficult','skipped','revealed','recorded')),
  recording_id      TEXT REFERENCES recordings(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_attempts_session ON practice_attempts(session_id);

CREATE TABLE templates (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'General',
  source_type  TEXT,
  source_id    TEXT,
  source_label TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Polymorphic notes have no FK, so clean them up with triggers.
CREATE TRIGGER trg_notes_video AFTER DELETE ON videos BEGIN
  DELETE FROM notes WHERE entity_type = 'video' AND entity_id = OLD.id; END;
CREATE TRIGGER trg_notes_folder AFTER DELETE ON folders BEGIN
  DELETE FROM notes WHERE entity_type = 'folder' AND entity_id = OLD.id; END;
CREATE TRIGGER trg_notes_transcript AFTER DELETE ON transcripts BEGIN
  DELETE FROM notes WHERE entity_type = 'transcript' AND entity_id = OLD.id; END;
CREATE TRIGGER trg_notes_sentence AFTER DELETE ON sentences BEGIN
  DELETE FROM notes WHERE entity_type = 'sentence' AND entity_id = OLD.id; END;
CREATE TRIGGER trg_notes_saved AFTER DELETE ON saved_sentences BEGIN
  DELETE FROM notes WHERE entity_type = 'saved_sentence' AND entity_id = OLD.id; END;
CREATE TRIGGER trg_notes_session AFTER DELETE ON practice_sessions BEGIN
  DELETE FROM notes WHERE entity_type = 'practice_session' AND entity_id = OLD.id; END;
CREATE TRIGGER trg_notes_template AFTER DELETE ON templates BEGIN
  DELETE FROM notes WHERE entity_type = 'template' AND entity_id = OLD.id; END;

INSERT INTO tags (id, name) VALUES
  ('tag-client', 'Client Communication'),
  ('tag-sales', 'Sales English'),
  ('tag-daily', 'Daily Conversation'),
  ('tag-grammar', 'Grammar'),
  ('tag-vocab', 'Vocabulary'),
  ('tag-pronunciation', 'Pronunciation'),
  ('tag-meetings', 'Meetings'),
  ('tag-negotiation', 'Negotiation');
