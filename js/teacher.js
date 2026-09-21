/* ============================================================
   老師首頁（teacher.html）
   未登入 → 整頁跳回 login.html
   已登入：顯示歡迎、進入後台、全班排名、修改密碼、登出
   ============================================================ */

(function () {
  "use strict";

  const TEACHER_TOKEN_KEY = "exam_teacher_token";
  const $ = (id) => document.getElementById(id);

  function requireLogin() {
    try {
      if (!localStorage.getItem(TEACHER_TOKEN_KEY)) {
        location.replace("login.html");
        return false;
      }
    } catch (e) {
      location.replace("login.html");
      return false;
    }
    return true;
  }

  function apiBase() {
    const cfg = window.APP_CONFIG || {};
    return String(cfg.apiBase || "").replace(/\/+$/, "");
  }

  function teacherHeaders() {
    const t = localStorage.getItem(TEACHER_TOKEN_KEY) || "";
    const h = { accept: "application/json", "content-type": "application/json" };
    if (t) { h.authorization = "Bearer " + t; h["x-teacher-token"] = t; }
    return h;
  }

  function fillWelcome() {
    const info = JSON.parse(localStorage.getItem("exam_teacher_info") || "{}");
    $("teacher-welcome").textContent =
      "👋 歡迎，" + (info.name || info.username || "") + " 老師（" + (info.className || "未設班級") + "）";
    if (info.className) {
      $("teacher-class-badge").textContent = "📚 " + info.className;
      $("teacher-class-badge").style.display = "inline";
    }
    $("teacher-logout-btn").style.display = "inline-block";
  }

  async function doLogout() {
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
    localStorage.removeItem("exam_teacher_info");
    window.ExamCloud.setTeacherToken("");
    location.replace("login.html");
  }

  /* ---------- 排名 ---------- */
  async function loadRanking() {
    const token = localStorage.getItem(TEACHER_TOKEN_KEY);
    if (!token) { location.replace("login.html"); return; }
    try {
      const res = await fetch(apiBase() + "/api/ranking", {
        headers: { accept: "application/json", "x-teacher-token": token }
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      renderRanking(data.ranking);
      $("ranking-msg").textContent = "";
    } catch (e) {
      $("ranking-tbody").innerHTML = '<tr><td colspan="4">載入失敗：' + e.message + '</td></tr>';
      $("ranking-msg").textContent = "";
    }
  }

  function renderRanking(ranking) {
    const tbody = $("ranking-tbody");
    tbody.innerHTML = "";
    if (!ranking || ranking.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">暫無資料</td></tr>';
      return;
    }
    ranking.forEach((item, index) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${item.seat}</td>
        <td>${item.correct || 0}</td>
        <td>${item.total || 0}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function openRanking() {
    $("ranking-pop").classList.remove("hidden");
    loadRanking();
  }

  function closeRanking() {
    $("ranking-pop").classList.add("hidden");
  }

  /* ---------- 修改密碼 ---------- */
  function openChangePassword() {
    $("change-pwd-pop").classList.remove("hidden");
    $("old-password").value = "";
    $("new-password").value = "";
    $("confirm-password").value = "";
    $("change-pwd-msg").textContent = "";
  }

  function closeChangePassword() {
    $("change-pwd-pop").classList.add("hidden");
  }

  async function doChangePassword() {
    const oldPwd = $("old-password").value;
    const newPwd = $("new-password").value;
    const confirmPwd = $("confirm-password").value;
    if (!oldPwd || !newPwd || !confirmPwd) {
      $("change-pwd-msg").textContent = "❌ 請填寫所有欄位";
      return;
    }
    if (newPwd !== confirmPwd) {
      $("change-pwd-msg").textContent = "❌ 新密碼與確認密碼不一致";
      return;
    }
    if (newPwd.length < 4) {
      $("change-pwd-msg").textContent = "❌ 密碼至少 4 個字元";
      return;
    }
    const token = localStorage.getItem(TEACHER_TOKEN_KEY);
    try {
      const res = await fetch(apiBase() + "/api/teacher/password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-teacher-token": token },
        body: JSON.stringify({ oldPassword: oldPwd, password: newPwd })
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      $("change-pwd-msg").textContent = "✅ 密碼已修改，請重新登入";
      setTimeout(() => {
        localStorage.removeItem(TEACHER_TOKEN_KEY);
        localStorage.removeItem("exam_teacher_info");
        window.ExamCloud.setTeacherToken("");
        location.replace("login.html");
      }, 1200);
    } catch (e) {
      $("change-pwd-msg").textContent = "❌ " + e.message;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!requireLogin()) return;
    fillWelcome();
    $("go-admin-btn").addEventListener("click", () => { window.location.href = "admin.html"; });
    $("ranking-btn").addEventListener("click", openRanking);
    $("ranking-close").addEventListener("click", closeRanking);
    $("ranking-refresh").addEventListener("click", openRanking);
    $("change-pwd-btn").addEventListener("click", openChangePassword);
    $("cancel-change-btn").addEventListener("click", closeChangePassword);
    $("submit-change-btn").addEventListener("click", doChangePassword);
    $("teacher-logout-btn").addEventListener("click", doLogout);
  });
})();