/* ============================================================
   老師後台 入口（js/admin/main.js）
   ------------------------------------------------------------
   最後載入：負責登入檢查、頁籤切換、把所有按鈕綁到各分頁模組。
   頁面 DOM 一律用 A.$("id") 取得，元件本身在 js/admin/ 其他檔案。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;

  function showAdmin() {
    $("admin-screen").classList.remove("hidden");
    $("logout-btn").style.display = "inline-block";
    const teacherInfo = JSON.parse(localStorage.getItem("exam_teacher_info") || "{}");
    $("teacher-welcome-text").textContent =
      "👋 歡迎，" + (teacherInfo.name || teacherInfo.username || "") + " 老師" +
      (teacherInfo.className ? "（" + teacherInfo.className + "）" : "");
    $("teacher-welcome-text").style.display = "inline";
    if (teacherInfo.className) {
      $("teacher-class-badge").textContent = "📚 " + teacherInfo.className;
      $("teacher-class-badge").style.display = "inline";
    }
    $("ranking-link").style.display = "inline-block";
    $("change-pwd-link").style.display = "inline-block";
    A.words.renderLessonSelect();
    A.words.renderBatchLessonSelect();
    A.content.renderContentLessonSelect();
    A.idiom.renderIdiomLessonSelect();
    A.ai.refreshAISettings(); /* 載入 AI 金鑰狀態（有金鑰的服務商）給出題／補值用 */
  }

  function checkLogin() {
    const token = localStorage.getItem("exam_teacher_token");
    if (!token) {
      location.replace("login.html");
      return;
    }
    window.ExamCloud.setTeacherToken(token);
    showAdmin();
  }

  function doLogout() {
    const token = localStorage.getItem("exam_teacher_token");
    if (token) {
      const apiBase = window.APP_CONFIG && window.APP_CONFIG.apiBase ? window.APP_CONFIG.apiBase.replace(/\/+$/, "") : "";
      fetch(apiBase + "/api/teacher/logout", {
        method: "POST",
        headers: { "x-teacher-token": token }
      }).catch(() => {});
    }
    localStorage.removeItem("exam_teacher_token");
    localStorage.removeItem(A.keys.login);
    localStorage.removeItem("exam_teacher_info");
    window.ExamCloud.setTeacherToken("");
    $("logout-btn").style.display = "none";
    location.replace("login.html");
  }

  /* ---------- 頁籤切換 ---------- */
  const TABS = ["manual", "batch", "content", "idiom", "students", "ai-settings"];

  function switchTab(tab) {
    document.querySelectorAll(".tabbar .chip").forEach((c) => c.classList.remove("selected"));
    const chip = document.querySelector(`.tabbar [data-tab="${tab}"]`);
    if (chip) chip.classList.add("selected");
    TABS.forEach((t) => $("tab-" + t).classList.toggle("hidden", t !== tab));
    if (tab === "ai-settings") A.ai.renderAISettings();
  }

  /* ---------- 事件綁定 ---------- */
  function bind() {
    $("logout-btn").addEventListener("click", doLogout);

    /* ✏️ 逐字輸入 */
    $("add-lesson-btn").addEventListener("click", A.words.addLesson);
    $("lesson-name").addEventListener("keydown", (e) => { if (e.key === "Enter") A.words.addLesson(); });
    $("lesson-select").addEventListener("change", A.words.renderWordRows);
    $("delete-lesson-btn").addEventListener("click", A.words.deleteLesson);
    $("add-word-btn").addEventListener("click", A.words.addWordRow);
    $("save-lesson-btn").addEventListener("click", A.words.saveLesson);
    $("fill-defs-btn").addEventListener("click", A.words.fillDefsOnline);
    $("fill-defs-ai-btn").addEventListener("click", A.words.fillDefsAI);

    /* ⚡ 批次輸入（國字注音） */
    $("batch-run-btn").addEventListener("click", A.zhuyinBatch.runBatch);
    $("batch-add-btn").addEventListener("click", A.zhuyinBatch.addBatchToBank);

    /* 📖 文意測驗 */
    $("add-content-lesson-btn").addEventListener("click", A.content.addContentLesson);
    $("content-lesson-name").addEventListener("keydown", (e) => { if (e.key === "Enter") A.content.addContentLesson(); });
    $("content-lesson-select").addEventListener("change", A.content.renderContentForm);
    $("delete-content-lesson-btn").addEventListener("click", A.content.deleteContentLesson);
    $("add-content-question-btn").addEventListener("click", A.content.addContentQuestion);
    $("save-content-btn").addEventListener("click", A.content.saveContent);
    $("content-title").addEventListener("input", () => {
      const it = A.content.currentContent();
      if (it) it.title = $("content-title").value;
    });
    $("content-passage").addEventListener("input", () => {
      const it = A.content.currentContent();
      if (it) it.passage = $("content-passage").value;
    });
    $("gen-btn").addEventListener("click", A.aiGenerate.autoGenerateQuestions);

    /* 🎯 成語練習 */
    $("add-idiom-lesson-btn").addEventListener("click", A.idiom.addIdiomLesson);
    $("idiom-lesson-name").addEventListener("keydown", (e) => { if (e.key === "Enter") A.idiom.addIdiomLesson(); });
    $("idiom-lesson-select").addEventListener("change", A.idiom.renderIdiomRows);
    $("delete-idiom-lesson-btn").addEventListener("click", A.idiom.deleteIdiomLesson);
    $("add-idiom-btn").addEventListener("click", A.idiom.addIdiomRow);
    $("save-idiom-lesson-btn").addEventListener("click", A.idiom.saveIdiomLesson);
    $("fill-idioms-local-btn").addEventListener("click", A.idiom.fillIdiomsLocal);
    $("fill-idioms-ai-btn").addEventListener("click", A.idiom.fillIdiomsAI);
    $("suggest-idioms-btn").addEventListener("click", A.idiom.suggestIdiomsAI);
    $("idiom-batch-run-btn").addEventListener("click", A.idiomBatch.runIdiomBatch);
    $("idiom-batch-add-btn").addEventListener("click", A.idiomBatch.addIdiomBatchToLesson);
    $("idiom-batch-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) A.idiomBatch.runIdiomBatch();
    });

    /* 💾 儲存 / 📤 匯出 / 📂 匯入 */
    $("save-local-btn").addEventListener("click", A.save.saveAllLocal);
    $("export-student-btn").addEventListener("click", A.transfer.exportStudentData);
    $("backup-btn").addEventListener("click", A.transfer.backupExport);
    $("reset-local-btn").addEventListener("click", A.transfer.resetLocal);
    $("import-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) A.transfer.importDataFile(f);
      e.target.value = "";
    });

    /* 頁籤 */
    document.querySelectorAll(".tabbar .chip").forEach((chip) => {
      chip.addEventListener("click", () => switchTab(chip.dataset.tab));
    });
    // 文意測驗頁裡連到 AI 設定的說明文字
    const aiLink = document.getElementById("link-ai-settings");
    if (aiLink) aiLink.addEventListener("click", (e) => { e.preventDefault(); switchTab("ai-settings"); });

    /* 👨‍🎓 學生管理 */
    A.students.bind();
  }

  document.addEventListener("DOMContentLoaded", () => {
    A.store.reloadAllBanks();
    bind();
    A.cloudSync.cloudInitUI();
    checkLogin();
  });

  A.main = { showAdmin, checkLogin, doLogout, switchTab, bind };

})();
