/* ============================================================
   老師後台：📤 匯出 / 📂 匯入 / 🗑 重設（js/admin/transfer.js）
   ------------------------------------------------------------
   三份題庫（國字注音、文意、成語）打包成同一份 JSON：
   「備份」與「給學生」共用同一份內容，學生在任一練習頁
   按「📂 匯入題庫檔」選這份檔，就三種題型全部載入。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;
  const S = A.state;

  function downloadTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/javascript;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function buildAllDataJSON() {
    return {
      app: "國語月考複習樂園",
      savedAt: new Date().toISOString(),
      words: A.store.bankToFlat(),
      content: A.store.cBankToFlat(),
      idioms: A.store.iBankToFlat()
    };
  }

  /* ---------- 匯出 ---------- */
  function backupExport() {
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const data = buildAllDataJSON();
    downloadTextFile(`題庫備份-${stamp}.json`, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
    $("restore-msg").textContent = "📤 已下載「題庫備份-日期.json」，裡面同時有國字注音＋文意＋成語三份題庫。";
  }

  function exportStudentData() {
    const data = buildAllDataJSON();
    downloadTextFile("學生題庫.json", JSON.stringify(data, null, 2), "application/json;charset=utf-8");
    $("save-msg").textContent = "📤 已下載「學生題庫.json」！把這份檔傳給學生，學生在國字注音／文意／成語任何一頁按「📂 匯入題庫檔」選這份檔，三種練習就一次全部載入。";
  }

  /* 執行檔案內文，取回 WORD_BANK / PASSAGE_BANK / IDIOM_BANK（data*.js 都適用）。
     重要：頁面本身也載入了 data.js / data-content.js / data-idioms.js，
     WORD_BANK 等名稱在全域已經存在。所以這裡先檢查「檔案內文真的有宣告哪一份」，
     沒宣告的一律傳 null，才不會把內建的同名變數誤當成檔案內容。 */
  function evalBankText(txt) {
    const declares = (name) => new RegExp("(?:const|let|var)\\s+" + name + "\\s*=").test(txt);
    const word = declares("WORD_BANK") ? "WORD_BANK" : "null";
    const passage = declares("PASSAGE_BANK") ? "PASSAGE_BANK" : "null";
    const idiom = declares("IDIOM_BANK") ? "IDIOM_BANK" : "null";
    const fn = new Function(
      txt + "\n;\nreturn { wordBank: " + word + ", passageBank: " + passage + ", idiomBank: " + idiom + " };"
    );
    return fn();
  }

  /* ---------- 還原（整份取代） ---------- */
  function restoreIdioms(arr) {
    S.iBank = A.store.groupIdiomsMap(Array.isArray(arr) ? arr : []);
    A.store.persistIBank();
    A.idiom.renderIdiomLessonSelect();
    $("idiom-edit").classList.add("hidden");
  }

  function restoreWords(arr) {
    S.bank = A.store.groupToMap(Array.isArray(arr) ? arr : []);
    A.store.persistWordBank();
    A.words.renderLessonSelect();
    A.words.renderBatchLessonSelect();
    $("word-edit").classList.add("hidden");
  }

  function restoreContent(arr) {
    const map = {};
    (Array.isArray(arr) ? arr : []).forEach((item) => {
      if (item && item.lesson) map[item.lesson] = item;
    });
    S.cBank = map;
    A.store.persistContentBank();
    A.content.renderContentLessonSelect();
  }

  function importDataFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const txt = String(reader.result).replace(/^\uFEFF/, "");
        const isJson = /\.json$/i.test(file.name);
        if (isJson) {
          const obj = JSON.parse(txt);
          if (!obj || (!obj.words && !obj.content && !obj.idioms)) throw new Error("這不是「題庫備份.json」的格式");
          restoreWords(obj.words || []);
          restoreContent(obj.content || []);
          restoreIdioms(obj.idioms || []);
        } else {
          const found = evalBankText(txt);
          const hasWord = found.wordBank !== null && found.wordBank !== undefined;
          const hasContent = found.passageBank !== null && found.passageBank !== undefined;
          const hasIdiom = found.idiomBank !== null && found.idiomBank !== undefined;
          if (!hasWord && !hasContent && !hasIdiom) throw new Error("找不到 WORD_BANK、PASSAGE_BANK 或 IDIOM_BANK");
          if (hasWord) restoreWords(found.wordBank);
          if (hasContent) restoreContent(found.passageBank);
          if (hasIdiom) restoreIdioms(found.idiomBank);
        }
        $("restore-msg").textContent = `✅ 已匯入「${file.name}」，並存進這台電腦。要給學生，請按「📤 匯出給學生」取得「學生題庫.json」一份檔（含國字注音＋文意＋成語）；或直接蓋回 js/ 資料夾裡的 data.js。`;
      } catch (e) {
        alert(`⚠️ 匯入失敗：${e.message}`);
        $("restore-msg").textContent = "";
      }
    };
    reader.onerror = () => alert("⚠️ 讀檔失敗，請再試一次。");
    reader.readAsText(file, "utf-8");
  }

  /* 把瀏覽器暫存清掉，讓整組網頁以 js/ 資料夾內的 data.js、data-content.js 為準 */
  function resetLocal() {
    if (!confirm("確定要清除「這台電腦瀏覽器暫存」的題庫嗎？\n\n之後 admin.html / zhuyin.html / content.html / idiom.html 都會改用 js/ 資料夾裡的 data.js、data-content.js 與 data-idioms.js。\n（資料夾裡的檔案不會被刪）")) return;
    try {
      localStorage.removeItem(A.keys.words);
      localStorage.removeItem(A.keys.content);
      localStorage.removeItem(A.keys.idioms);
      localStorage.removeItem("exam_word_bank_saved");
      localStorage.removeItem("exam_passage_bank_saved");
      localStorage.removeItem("exam_idiom_bank_saved");
    } catch (e) { /* 忽略 */ }
    A.store.reloadAllBanks();
    A.words.renderLessonSelect();
    A.words.renderBatchLessonSelect();
    A.content.renderContentLessonSelect();
    A.idiom.renderIdiomLessonSelect();
    $("save-msg").textContent = "🗑 已清除本機暫存，現在完全以資料夾內 data.js、data-content.js、data-idioms.js 的題庫為準。";
    $("restore-msg").textContent = "💡 若想讓資料暫時留在瀏覽器，再按一次「存到這台電腦」即可。";
  }

  A.transfer = {
    downloadTextFile,
    buildAllDataJSON,
    backupExport,
    exportStudentData,
    evalBankText,
    restoreWords,
    restoreContent,
    restoreIdioms,
    importDataFile,
    resetLocal
  };

})();
