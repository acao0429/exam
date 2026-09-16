/* ============================================================
   學生端「匯入題庫檔」共用邏輯
   老師後台「📤 匯出給學生」會給一份「學生題庫.json」，
   裡面一次包含三份題庫：
     words   → 國字注音（exam_word_bank_v1）
     content → 文意測驗（exam_passage_bank_v1）
     idioms  → 成語練習（exam_idiom_bank_v1）
   學生在國字注音 / 文意 / 成語任一頁按「📂 匯入題庫檔」
   選這份檔，三種練習就會一次全部載入。
   ============================================================ */

(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function stripBOM(txt) { return String(txt).replace(/^\uFEFF/, ""); }

  /* 學生端不執行不熟悉的程式碼：只讀取「題庫備份 json」格式。
     若有人放了 JS 檔（data*.js），會被當成格式錯誤提示，
     不會真的執行裡面的程式。 */
  function importBankFile(file) {
    if (!/\.json$/i.test(file.name)) {
      return "請選擇老師給的「學生題庫.json」（或後台匯出的「題庫備份-日期.json」）。";
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(stripBOM(reader.result));
        if (!obj || (!obj.words && !obj.content && !obj.idioms)) {
          throw new Error("裡面找不到題庫（沒有 words / content / idioms）。");
        }
        const words = Array.isArray(obj.words) ? obj.words : [];
        const content = Array.isArray(obj.content) ? obj.content : [];
        const idioms = Array.isArray(obj.idioms) ? obj.idioms : [];

        localStorage.setItem("exam_word_bank_v1", JSON.stringify(words));
        localStorage.setItem("exam_word_bank_saved", "1");
        localStorage.setItem("exam_passage_bank_v1", JSON.stringify(content));
        localStorage.setItem("exam_passage_bank_saved", "1");
        localStorage.setItem("exam_idiom_bank_v1", JSON.stringify(idioms));
        localStorage.setItem("exam_idiom_bank_saved", "1");

        const parts = [];
        if (words.length) parts.push(`國字注音 ${words.length} 筆`);
        if (content.length) parts.push(`文意 ${content.length} 課`);
        if (idioms.length) parts.push(`成語 ${idioms.length} 筆`);
        const status = $("import-status");
        if (status) status.textContent = parts.length
          ? `✅ 已匯入（${parts.join("、")}），重新整理後就能用囉！`
          : "✅ 已匯入，但這份檔是空的。";
        setTimeout(() => location.reload(), 900);
      } catch (e) {
        const status = $("import-status");
        if (status) status.textContent = `⚠️ 匯入失敗：${e.message}`;
        else alert(`⚠️ 匯入失敗：${e.message}`);
      }
    };
    reader.onerror = () => {
      const status = $("import-status");
      if (status) status.textContent = "⚠️ 讀檔失敗，請再試一次。";
      else alert("⚠️ 讀檔失敗，請再試一次。");
    };
    reader.readAsText(file, "utf-8");
    return null;
  }

  function bind() {
    const input = $("import-bank-file");
    if (!input) return;
    input.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const msg = importBankFile(f);
      if (msg) {
        const status = $("import-status");
        if (status) status.textContent = `⚠️ ${msg}`;
        else alert(`⚠️ ${msg}`);
      }
      e.target.value = "";
    });
  }

  document.addEventListener("DOMContentLoaded", bind);
})();