/* ============================================================
   統一登入頁（login.html）
   學生：座號＋密碼 → 學生首頁 index.html
   老師：帳號＋密碼 → 題庫管理 admin.html（上方為老師首頁頂欄）
   已登入狀態下開啟本頁 → 自動跳轉對應首頁
   ============================================================ */

(function () {
  "use strict";

  const STUDENT_TOKEN_KEY = "exam_student_token";
  const TEACHER_TOKEN_KEY = "exam_teacher_token";
  const $ = (id) => document.getElementById(id);

  function apiBase() {
    const cfg = window.APP_CONFIG || {};
    return String(cfg.apiBase || "").replace(/\/+$/, "");
  }

  function switchRole(role) {
    const isStudent = role === "student";
    $("tab-student").classList.toggle("selected", isStudent);
    $("tab-teacher").classList.toggle("selected", !isStudent);
    $("student-form").classList.toggle("hidden", !isStudent);
    $("teacher-form").classList.toggle("hidden", isStudent);
    $("login-error").textContent = "";
  }

  function showError(msg) { $("login-error").textContent = msg || ""; }

  async function doStudentLogin() {
    const seat = $("login-seat").value.trim();
    const password = $("login-password").value;
    if (!seat || !password) { showError("❌ 請輸入座號與密碼"); return; }
    try {
      await window.ExamCloud.studentLogin(seat, password);
      location.replace("index.html");
    } catch (e) {
      showError("❌ " + e.message);
    }
  }

  async function doTeacherLogin() {
    const username = $("login-username").value.trim();
    const password = $("login-teacher-password").value;
    if (!username || !password) { showError("❌ 請輸入帳號與密碼"); return; }
    try {
      const res = await fetch(apiBase() + "/api/teacher/login", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      localStorage.setItem(TEACHER_TOKEN_KEY, data.token);
      window.ExamCloud.setTeacherToken(data.token);
      localStorage.setItem("exam_teacher_info", JSON.stringify(data.teacher));
      location.replace("admin.html");
    } catch (e) {
      showError("❌ " + e.message);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    // 已登入：直接跳對應首頁
    if (localStorage.getItem(STUDENT_TOKEN_KEY)) { location.replace("index.html"); return; }
    if (localStorage.getItem(TEACHER_TOKEN_KEY)) { location.replace("admin.html"); return; }

    switchRole("student");
    $("tab-student").addEventListener("click", () => switchRole("student"));
    $("tab-teacher").addEventListener("click", () => switchRole("teacher"));
    $("student-login-btn").addEventListener("click", doStudentLogin);
    $("teacher-login-btn").addEventListener("click", doTeacherLogin);
    $("login-seat").addEventListener("keydown", (e) => { if (e.key === "Enter") $("login-password").focus(); });
    $("login-password").addEventListener("keydown", (e) => { if (e.key === "Enter") doStudentLogin(); });
    $("login-username").addEventListener("keydown", (e) => { if (e.key === "Enter") $("login-teacher-password").focus(); });
    $("login-teacher-password").addEventListener("keydown", (e) => { if (e.key === "Enter") doTeacherLogin(); });
  });
})();