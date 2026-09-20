-- ============================================================
-- 0003_roles.sql  老師帳號（取代單一 admin token）
--
-- 每位老師有獨立帳號/密碼，綁定一個班級。
-- students.class_name 新增，連結到老師的班級。
-- ============================================================

-- 老師帳號表
CREATE TABLE IF NOT EXISTS teachers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  class_name    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_teachers_username ON teachers(username);

-- 老師登入 session
CREATE TABLE IF NOT EXISTS teacher_sessions (
  token      TEXT PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+30 days'))
);
CREATE INDEX IF NOT EXISTS idx_teacher_sessions_teacher ON teacher_sessions(teacher_id);

-- students 新增班級欄位（舊資料預設為空字串）
ALTER TABLE students ADD COLUMN class_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_name);
