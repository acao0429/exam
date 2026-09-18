/* ============================================================
   雲端 API 設定（可安心給學生載入，不含任何密碼）
   部署 Worker 後，把 apiBase 填成 Worker 的網址（結尾不要加斜線）：
     window.APP_CONFIG = { apiBase: "https://exam-api.你的子網域.workers.dev" };
   留空 = 不啟用雲端，完全使用本機題庫（原本的行為）。
   ============================================================ */

window.APP_CONFIG = {
  apiBase: "https://exam-api.ples.workers.dev"
};
