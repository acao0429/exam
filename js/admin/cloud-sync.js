/* ============================================================
   老師後台：☁️ 雲端同步（js/admin/cloud-sync.js）
   ------------------------------------------------------------
   把三份題庫推到 Cloudflare D1，或從雲端拉回來。
   需要 js/cloud.js 與老師登入 token；沒有雲端支援時整段略過。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;

  function cloudInitUI() {
    if (!window.ExamCloud) return; /* 頁面未含雲端支援 */
    $("cloud-push-btn").addEventListener("click", () => {
      const msg = $("cloud-msg");
      msg.textContent = "☁️ 同步中…";
      A.words.collectWordRows();
      A.idiom.collectIdiomRows();
      window.ExamCloud.pushAll(A.transfer.buildAllDataJSON())
        .then(() => { msg.textContent = "✅ 已把三份題庫同步到雲端！學生開練習頁會自動抓到最新題庫。"; })
        .catch((e) => { msg.textContent = "❌ 同步失敗：" + e.message; });
    });

    $("cloud-pull-btn").addEventListener("click", () => {
      const msg = $("cloud-msg");
      msg.textContent = "☁️ 讀取雲端中…";
      window.ExamCloud.fetchBanks()
        .then((data) => {
          if (!data) throw new Error("尚未設定 API 網址（js/app-config.js 的 apiBase）");
          A.transfer.restoreWords(data.words || []);
          A.transfer.restoreContent(data.content || []);
          A.transfer.restoreIdioms(data.idioms || []);
          msg.textContent = "✅ 已從雲端載入三份題庫，並存進這台電腦。";
        })
        .catch((e) => { msg.textContent = "❌ 載入失敗：" + e.message; });
    });
  }

  A.cloudSync = { cloudInitUI };

})();
