-- ============================================================
-- 0002_students_attempts.sql  學生帳號＋作答紀錄＋登入 session
--
-- 學生端：
--   students  座號/姓名/密碼（加鹽 SHA-256）
--   sessions  登入 token（跨裝置保持登入，主要給學生端用）
--   attempts  每次作答紀錄（雲端錯題本、成績統計）
-- 老師端（admin token）：
--   students 批次建檔 / 重設密碼 / 刪除
-- ============================================================

CREATE TABLE IF NOT EXISTS students (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  seat          TEXT NOT NULL UNIQUE,            -- 座號，當作帳號
  name          TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_seat ON students(seat);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,                   -- 隨機 token
  student_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student_id);

CREATE TABLE IF NOT EXISTS attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL,
  bank        TEXT NOT NULL DEFAULT '',          -- zhuyin / content / idiom
  lesson      TEXT NOT NULL DEFAULT '',
  mode        TEXT NOT NULL DEFAULT '',          -- 作答模式（例如 字↔注音 / 文意 / 選釋義…）
  item_key    TEXT NOT NULL DEFAULT '',          -- 題目識別鍵（錯題去重用）
  prompt      TEXT NOT NULL DEFAULT '',          -- 題目文字（錯題本顯示用）
  chosen      TEXT NOT NULL DEFAULT '',
  correct     INTEGER NOT NULL DEFAULT 0,        -- 1 對 / 0 錯
  answered_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id, bank, lesson);
CREATE INDEX IF NOT EXISTS idx_attempts_wrong ON attempts(student_id, bank, correct) WHERE correct = 0;
