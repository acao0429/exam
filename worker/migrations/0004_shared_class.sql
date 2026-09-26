-- ============================================================
-- 0004_shared_class.sql  多位老師共用同一班級 + 學生記錄所屬老師
--
-- 變更：
--  1. teachers.class_name 移除 UNIQUE
--     原本 0003 限定「一個班級名稱只能有一位老師」，導致兩位老師
--     無法共用同一班、共用同一份學生名單與排名。SQLite 無法直接
--     移除 UNIQUE 約束，須照標準流程重建表格（下方）。
--
--  2. students 新增 teacher_id
--     記錄這位學生是由哪位老師建檔／管理。這是「名單上的標記欄位」，
--     僅供參考與批次指定；學生名單與排名的篩選仍以 class_name 為準，
--     因此班級名稱相同的老師會看到同一份名單。
--
-- 本檔只改結構，不動資料；班級資料回填另外以 wrangler d1 execute 執行。
-- ============================================================

-- ---------- 1. teachers：去掉 class_name 的 UNIQUE ----------
CREATE TABLE teachers_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  class_name    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO teachers_new (id, username, name, password_salt, password_hash, class_name, created_at)
SELECT id, username, name, password_salt, password_hash, class_name, created_at FROM teachers;

DROP TABLE teachers;
ALTER TABLE teachers_new RENAME TO teachers;

CREATE INDEX IF NOT EXISTS idx_teachers_username ON teachers(username);
CREATE INDEX IF NOT EXISTS idx_teachers_class ON teachers(class_name);

-- ---------- 2. students：新增 teacher_id ----------
ALTER TABLE students ADD COLUMN teacher_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_students_teacher ON students(teacher_id);
