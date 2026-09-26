-- 0005_roles_classes.sql
--
-- 兩件事：
--   1. 班級正式成為資料表（classes），老師與學生改以 class_id 關聯
--   2. 權限分級：admin（最高權限，可建老師帳號／跨班管理／備份還原）與 teacher
--
-- 相容性設計：teachers.class_name 與 students.class_name 兩欄保留，
-- 由 trigger 自動與 class_id 雙向同步，讓既有以 class_name 查詢的程式碼不必全改，
-- 同時保證 classes 表永遠是班級名稱的唯一真實來源。

/* ---------- 1. 班級資料表 ---------- */

CREATE TABLE IF NOT EXISTS classes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 由既有的 teachers / students 的 class_name 回填班級
INSERT OR IGNORE INTO classes (name)
  SELECT DISTINCT TRIM(class_name) FROM teachers WHERE TRIM(class_name) <> '';
INSERT OR IGNORE INTO classes (name)
  SELECT DISTINCT TRIM(class_name) FROM students WHERE TRIM(class_name) <> '';

/* ---------- 2. 老師：角色 + 班級關聯 + 停用 ---------- */

ALTER TABLE teachers ADD COLUMN role TEXT NOT NULL DEFAULT 'teacher';
ALTER TABLE teachers ADD COLUMN class_id INTEGER REFERENCES classes(id);
ALTER TABLE teachers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

UPDATE teachers
   SET class_id = (SELECT id FROM classes WHERE classes.name = TRIM(teachers.class_name))
 WHERE class_id IS NULL AND TRIM(class_name) <> '';

/* ---------- 3. 學生：班級關聯 ---------- */

ALTER TABLE students ADD COLUMN class_id INTEGER REFERENCES classes(id);

UPDATE students
   SET class_id = (SELECT id FROM classes WHERE classes.name = TRIM(students.class_name))
 WHERE class_id IS NULL AND TRIM(class_name) <> '';

/* ---------- 4. 指定管理者 ---------- */

-- acao 與 admin 兩帳號為最高權限
UPDATE teachers SET role = 'admin' WHERE username IN ('acao', 'admin');

/* ---------- 5. AI 設定改為全站共用 ---------- */

CREATE TABLE ai_settings_shared (
  provider   TEXT NOT NULL PRIMARY KEY,
  api_key    TEXT NOT NULL DEFAULT '',
  model      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 只搬有金鑰的資料，避免產生空殼設定列
INSERT OR IGNORE INTO ai_settings_shared (provider, api_key, model, updated_at)
  SELECT provider, api_key, model, updated_at FROM ai_settings WHERE TRIM(api_key) <> '';

DROP TABLE ai_settings;
ALTER TABLE ai_settings_shared RENAME TO ai_settings;

/* ---------- 6. 備份紀錄 ---------- */

CREATE TABLE IF NOT EXISTS backup_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  actor_id   INTEGER,
  actor_name TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* ---------- 7. 索引 ---------- */

CREATE INDEX IF NOT EXISTS idx_teachers_role     ON teachers(role);
CREATE INDEX IF NOT EXISTS idx_teachers_class_id ON teachers(class_id);
CREATE INDEX IF NOT EXISTS idx_students_class_id ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_seat_class ON students(seat, class_id);

/* ---------- 8. class_id ↔ class_name 雙向同步 trigger ---------- */

/* class_id → class_name（4 支：insert / update 各一，teachers 與 students） */

CREATE TRIGGER IF NOT EXISTS trg_teachers_ins_cid AFTER INSERT ON teachers
WHEN new.class_id IS NOT NULL
BEGIN
  UPDATE teachers
     SET class_name = COALESCE((SELECT name FROM classes WHERE id = new.class_id), '')
   WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_teachers_upd_cid AFTER UPDATE OF class_id ON teachers
WHEN new.class_id IS NOT OLD.class_id
BEGIN
  UPDATE teachers
     SET class_name = COALESCE((SELECT name FROM classes WHERE id = new.class_id), '')
   WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_students_ins_cid AFTER INSERT ON students
WHEN new.class_id IS NOT NULL
BEGIN
  UPDATE students
     SET class_name = COALESCE((SELECT name FROM classes WHERE id = new.class_id), '')
   WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_students_upd_cid AFTER UPDATE OF class_id ON students
WHEN new.class_id IS NOT OLD.class_id
BEGIN
  UPDATE students
     SET class_name = COALESCE((SELECT name FROM classes WHERE id = new.class_id), '')
   WHERE id = new.id;
END;

/* class_name → class_id：若班級名稱尚未登錄，自動建立，
   這樣任何一邊的寫入都不會產生「不在 classes 裡」的班級名稱 */

CREATE TRIGGER IF NOT EXISTS trg_teachers_ins_cname AFTER INSERT ON teachers
WHEN TRIM(new.class_name) <> ''
BEGIN
  INSERT OR IGNORE INTO classes (name) VALUES (TRIM(new.class_name));
  UPDATE teachers
     SET class_id = (SELECT id FROM classes WHERE name = TRIM(new.class_name))
   WHERE id = new.id
     AND IFNULL(class_id, -1) <> (SELECT id FROM classes WHERE name = TRIM(new.class_name));
END;

CREATE TRIGGER IF NOT EXISTS trg_teachers_upd_cname AFTER UPDATE OF class_name ON teachers
WHEN TRIM(new.class_name) <> '' AND new.class_name IS NOT old.class_name
BEGIN
  INSERT OR IGNORE INTO classes (name) VALUES (TRIM(new.class_name));
  UPDATE teachers
     SET class_id = (SELECT id FROM classes WHERE name = TRIM(new.class_name))
   WHERE id = new.id
     AND IFNULL(class_id, -1) <> (SELECT id FROM classes WHERE name = TRIM(new.class_name));
END;

CREATE TRIGGER IF NOT EXISTS trg_students_ins_cname AFTER INSERT ON students
WHEN TRIM(new.class_name) <> ''
BEGIN
  INSERT OR IGNORE INTO classes (name) VALUES (TRIM(new.class_name));
  UPDATE students
     SET class_id = (SELECT id FROM classes WHERE name = TRIM(new.class_name))
   WHERE id = new.id
     AND IFNULL(class_id, -1) <> (SELECT id FROM classes WHERE name = TRIM(new.class_name));
END;

CREATE TRIGGER IF NOT EXISTS trg_students_upd_cname AFTER UPDATE OF class_name ON students
WHEN TRIM(new.class_name) <> '' AND new.class_name IS NOT old.class_name
BEGIN
  INSERT OR IGNORE INTO classes (name) VALUES (TRIM(new.class_name));
  UPDATE students
     SET class_id = (SELECT id FROM classes WHERE name = TRIM(new.class_name))
   WHERE id = new.id
     AND IFNULL(class_id, -1) <> (SELECT id FROM classes WHERE name = TRIM(new.class_name));
END;
