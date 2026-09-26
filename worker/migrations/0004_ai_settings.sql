-- 0004_ai_settings.sql
--
-- ⚠️ 這個檔案曾在 repo 遺失（2026-09-26 發現）。
--    遠端 d1_migrations 有記錄套用過，但檔案不在 git，導致任何人重建資料庫時
--    4 個 AI 端點（/api/ai/settings、/api/ai/test、/api/ai/chat）都會 500。
--    本檔依 production 實際 schema 補回。
--
-- 注意：原本是「每位老師各一組金鑰」，已於 0005 改為「全站共用一組」。
CREATE TABLE IF NOT EXISTS ai_settings (
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  api_key    TEXT NOT NULL DEFAULT '',
  model      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (teacher_id, provider)
);
