/* ============================================================
   學生首頁（index.html）
   未登入 → 整頁跳回 login.html
   已登入：顯示歡迎、排名、修改密碼、登出
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

  function apiBase() {
    const cfg = window.APP_CONFIG || {};
    return String(cfg.apiBase || "").replace(/\/+$/, "");
  }

  function studentHeaders() {
    const h = { accept: "application/json", "content-type": "application/json" };
    const t = window.ExamCloud.getStudentToken();
    if (t) { h.authorization = "Bearer " + t; h["x-student-token"] = t; }
    return h;
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

  /* ---------- 排名 ---------- */
  async function loadRanking() {
    const token = window.ExamCloud.getStudentToken();
    if (!token) { location.replace("login.html"); return; }
    try {
      const res = await fetch(apiBase() + "/api/ranking", {
        headers: { accept: "application/json", "x-student-token": token }
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
    try {
      await window.ExamCloud.studentChangePassword(oldPwd, newPwd);
      $("change-pwd-msg").textContent = "✅ 密碼已修改，請重新登入";
      setTimeout(() => { location.replace("login.html"); }, 1200);
    } catch (e) {
      $("change-pwd-msg").textContent = "❌ " + e.message;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!requireLogin()) return;
    fillWelcome();
    $("top-ranking-btn").addEventListener("click", openRanking);
    $("ranking-close").addEventListener("click", closeRanking);
    $("ranking-refresh").addEventListener("click", openRanking);
    $("change-student-password-btn").addEventListener("click", openChangePassword);
    $("cancel-change-btn").addEventListener("click", closeChangePassword);
    $("submit-change-btn").addEventListener("click", doChangePassword);
    $("student-logout-btn").addEventListener("click", doLogout);
  });
})();