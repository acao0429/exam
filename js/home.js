/* ============================================================
   學生首頁（index.html）
   未登入 → 整頁跳回 login.html
   已登入：顯示歡迎、排名、修改密碼、登出
   ------------------------------------------------------------
   排名與修改密碼是獨立頁面（student-ranking.html /
   student-password.html），首頁只負責連過去。
   ============================================================ */

(function () {
  "use strict";

  const STUDENT_TOKEN_KEY = "exam_student_token";
  const $ = (id) => document.getElementById(id);

  function requireLogin() {
    try {
      if (!localStorage.getItem(STUDENT_TOKEN_KEY)) {
        location.replace("login.html");
        return false;
      }
    } catch (e) {
      location.replace("login.html");
      return false;
    }
    return true;
  }

  /* ---------- 歡迎列 ---------- */
  function fillWelcome() {
    const info = window.ExamCloud.getStudentInfo();
    const name = (info && (info.name || info.seat)) || "同學";
    $("student-welcome-text").textContent = "👋 " + name + " 已登入";
    $("student-welcome-text").style.display = "inline-block";
    $("top-ranking-btn").style.display = "inline-block";
    $("change-student-password-btn").style.display = "inline-block";
    $("student-logout-btn").style.display = "inline-block";
  }

  async function doLogout() {
    try { await window.ExamCloud.studentLogout(); } catch (e) { /* 忽略 */ }
    location.replace("login.html");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!requireLogin()) return;
    fillWelcome();
    $("student-logout-btn").addEventListener("click", doLogout);
  });
})();
