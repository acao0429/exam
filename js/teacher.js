/* ============================================================
   老師登入：帳號/密碼 → teacher session token
   登入後導向 admin.html（後台頁面）
   ============================================================ */

(function () {
  "use strict";

  const TEACHER_TOKEN_KEY = "exam_teacher_token";
  const TEACHER_INFO_KEY = "exam_teacher_info";
  const $ = (id) => document.getElementById(id);

  function apiBase() {
    const cfg = window.APP_CONFIG || {};
    return String(cfg.apiBase || "").replace(/\/+$/, "");
  }

  function showLogin() {
    $("login-screen").classList.remove("hidden");
    $("dashboard-screen").classList.add("hidden");
    $("teacher-username").value = "";
    $("teacher-password").value = "";
    $("teacher-login-error").textContent = "";
    $("teacher-username").focus();
  }

  function showDashboard(teacher) {
    $("login-screen").classList.add("hidden");
    $("dashboard-screen").classList.remove("hidden");
    $("teacher-welcome").textContent =
      "👋 歡迎，" + (teacher.name || teacher.username) + " 老師（" + (teacher.className || "未設班級") + "）";
  }

  async function doTeacherLogin() {
    const username = $("teacher-username").value.trim();
    const password = $("teacher-password").value;
    if (!username || !password) {
      $("teacher-login-error").textContent = "❌ 請輸入帳號與密碼";
      return;
    }
    try {
      const res = await fetch(apiBase() + "/api/teacher/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      localStorage.setItem(TEACHER_TOKEN_KEY, data.token);
      localStorage.setItem(TEACHER_INFO_KEY, JSON.stringify(data.teacher));
      $("teacher-login-error").textContent = "";
      showDashboard(data.teacher);
    } catch (e) {
      $("teacher-login-error").textContent = "❌ " + e.message;
    }
  }

  async function doTeacherLogout() {
    const token = localStorage.getItem(TEACHER_TOKEN_KEY);
    if (token) {
      try {
        await fetch(apiBase() + "/api/teacher/logout", {
          method: "POST",
          headers: { "x-teacher-token": token }
        });
      } catch (e) { /* 忽略 */ }
    }
    localStorage.removeItem(TEACHER_TOKEN_KEY);
    localStorage.removeItem(TEACHER_INFO_KEY);
    showLogin();
  }

  function checkLogin() {
    const token = localStorage.getItem(TEACHER_TOKEN_KEY);
    const info = localStorage.getItem(TEACHER_INFO_KEY);
    if (token && info) {
      try {
        const teacher = JSON.parse(info);
        showDashboard(teacher);
        return;
      } catch (e) { /* fall through */ }
    }
    showLogin();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("teacher-login-btn").addEventListener("click", doTeacherLogin);
    $("teacher-cancel-btn").addEventListener("click", () => { window.location.href = "index.html"; });
    $("teacher-logout-btn").addEventListener("click", doTeacherLogout);
    $("go-admin-btn").addEventListener("click", () => { window.location.href = "admin.html"; });
    $("teacher-password").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doTeacherLogin();
    });
    $("teacher-username").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("teacher-password").focus();
    });
    checkLogin();
  });
})();
