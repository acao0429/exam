/* ============================================================
   獨立排名頁（student-ranking.html / teacher-ranking.html）
   ------------------------------------------------------------
   這個頁面只做一件事：顯示答對題數排名。
   角色由 <body data-role="student|teacher"> 決定，
   未登入 → 整頁跳回 login.html。
   資料來源：GET /api/ranking（老師只看自己班）
   ============================================================ */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function apiBase() {
    const cfg = window.APP_CONFIG || {};
    return String(cfg.apiBase || "").replace(/\/+$/, "");
  }

  function isTeacher() {
    return document.body.getAttribute("data-role") === "teacher";
  }

  function token() {
    return isTeacher()
      ? localStorage.getItem("exam_teacher_token")
      : localStorage.getItem("exam_student_token");
  }

  function authHeaders() {
    const t = token();
    const h = { accept: "application/json" };
    if (isTeacher()) {
      h["x-teacher-token"] = t;
      h.authorization = "Bearer " + t;
    } else {
      h["x-student-token"] = t;
    }
    return h;
  }

  function requireLogin() {
    try {
      if (!token()) {
        location.replace("login.html");
        return false;
      }
    } catch (e) {
      location.replace("login.html");
      return false;
    }
    return true;
  }

  /* ---------- 渲染 ---------- */
  function renderRanking(ranking) {
    const tbody = $("ranking-tbody");
    const msg = $("ranking-msg");
    tbody.innerHTML = "";
    if (!ranking || ranking.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">暫無資料</td></tr>';
      msg.innerHTML = isTeacher()
        ? '這個班級還沒有學生。請到 <a href="admin.html">題庫管理 → 學生管理</a>，'
          + '用「🧲 未分班學生 → 移入我的班級」把舊學生歸入，或直接批次建檔。'
        : '目前班級還沒有學生或尚未建立帳號，請向老師確認。';
      return;
    }
    msg.textContent = "";
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

  /* ---------- 載入（支援時間篩選） ---------- */
  async function loadRanking(period) {
    const tbody = $("ranking-tbody");
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">載入中…</td></tr>';
    $("ranking-msg").textContent = "";
    try {
      const url = apiBase() + "/api/ranking" + (period ? "?period=" + period : "");
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      renderRanking(data.ranking);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">載入失敗：' + e.message + "</td></tr>";
    }
  }

  window.loadRanking = loadRanking;

  document.addEventListener("DOMContentLoaded", () => {
    if (!requireLogin()) return;
    loadRanking();
    $("ranking-refresh").addEventListener("click", () => loadRanking());
  });
})();
