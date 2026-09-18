-- 0001_init.sql
-- 國語月考複習樂園：D1 schema（正規化）
-- words(國字注音) / passages(文意課文) / questions(文意題目) / idioms(成語)

CREATE TABLE IF NOT EXISTS words (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson     TEXT    NOT NULL DEFAULT '',
  word       TEXT    NOT NULL DEFAULT '',
  zhuyin     TEXT    NOT NULL DEFAULT '',
  def        TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_words_lesson ON words (lesson, sort_order);

CREATE TABLE IF NOT EXISTS passages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson     TEXT    NOT NULL DEFAULT '',
  title      TEXT    NOT NULL DEFAULT '',
  passage    TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_passages_lesson ON passages (lesson, sort_order);

CREATE TABLE IF NOT EXISTS questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  passage_id INTEGER NOT NULL,
  type       TEXT    NOT NULL DEFAULT '',
  q          TEXT    NOT NULL DEFAULT '',
  options    TEXT    NOT NULL DEFAULT '[]',
  answer     INTEGER NOT NULL DEFAULT 0,
  explain    TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (passage_id) REFERENCES passages (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_questions_passage ON questions (passage_id, sort_order);

CREATE TABLE IF NOT EXISTS idioms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson     TEXT    NOT NULL DEFAULT '',
  idiom      TEXT    NOT NULL DEFAULT '',
  bo         TEXT    NOT NULL DEFAULT '',
  meaning    TEXT    NOT NULL DEFAULT '',
  synonym    TEXT    NOT NULL DEFAULT '',
  antonym    TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_idioms_lesson ON idioms (lesson, sort_order);
