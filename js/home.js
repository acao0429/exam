/* ============================================================
   首頁：學生登入、排名
   老師登入導向 teacher.html，不在此處理。
   ============================================================ */

(function () {
  "use strict";

  const STUDENT_TOKEN_KEY = "exam_student_token";
  const STUDENT_INFO_KEY = "exam_student_info";
  const $ = (id) => document.getElementById(id);

  /* ========== 學生登入 ========== */
  function openStudentLogin() {
    $("student-login-pop").classList.remove("hidden");
    $("student-seat").style.display = "";
    $("student-password").style.display = "";
    $("student-login-btn").style.display = "";
    $("student-login-cancel").style.display = "";
    $("student-login-error").style.display = "";
    $("student-seat").value = "";
    $("student-password").value = "";
    $("student-login-error").textContent = "";
    $("old-password").value = "";
    $("new-password").value = "";
    $("confirm-password").value = "";
    $("change-pwd-msg").textContent = "";
    $("change-password-section").classList.add("hidden");
    $("change-student-password-btn").style.display = "none";
    $("student-login-cancel").addEventListener("click", closeStudentLogin);
  }

  function closeStudentLogin() {
    $("student-login-pop").classList.add("hidden");
  }

  async function doStudentLogin() {
    const seat = $("student-seat").value.trim();
    const password = $("student-password").value;
    if (!seat || !password) {
      $("student-login-error").textContent = "❌ 請輸入座號與密碼";
      return;
    }
    try {
      const apiBase = window.APP_CONFIG && window.APP_CONFIG.apiBase
        ? window.APP_CONFIG.apiBase.replace(/\/+$/, "") : "";
      const res = await fetch(apiBase + "/api/student/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seat, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      localStorage.setItem(STUDENT_TOKEN_KEY, data.token);
      localStorage.setItem(STUDENT_INFO_KEY, JSON.stringify(data.student));
      $("student-login-error").textContent = "";
      // 登入成功：只隱藏輸入欄與按鈕，不隱藏整個彈窗（讓修改密碼鈕＋歡迎訊息可見）
      $("student-seat").style.display = "none";
      $("student-password").style.display = "none";
      $("student-login-btn").style.display = "none";
      $("student-login-cancel").style.display = "none";
      $("student-login-error").style.display = "none";
      $("student-welcome-text").textContent = (data.student.name || data.student.seat) + " 已登入";
      $("student-welcome-text").style.display = "inline-block";
      $("top-student-btn").style.display = "none";
      $("change-student-password-btn").style.display = "inline-block";
      $("top-ranking-btn").style.display = "inline-block";
      updateLogoutBtn();
    } catch (e) {
      $("student-login-error").textContent = "❌ " + e.message;
    }
  }

  function updateLogoutBtn() {
    const logoutBtn = $("student-logout-btn");
    if (!logoutBtn) return;
    if (localStorage.getItem(STUDENT_TOKEN_KEY)) {
      logoutBtn.style.display = "inline-block";
      logoutBtn.textContent = "👋 " + (JSON.parse(localStorage.getItem(STUDENT_INFO_KEY) || "{}").name || "登出");
      logoutBtn.onclick = doStudentLogout;
    } else {
      logoutBtn.style.display = "none";
    }
  }

  async function doStudentLogout() {
    const token = localStorage.getItem(STUDENT_TOKEN_KEY);
    if (token) {
      try {
        const apiBase = window.APP_CONFIG && window.APP_CONFIG.apiBase
          ? window.APP_CONFIG.apiBase.replace(/\/+$/, "") : "";
        await fetch(apiBase + "/api/student/logout", {
          method: "POST",
          headers: { "x-student-token": token }
        });
      } catch (e) { /* 忽略 */ }
    }
    localStorage.removeItem(STUDENT_TOKEN_KEY);
    localStorage.removeItem(STUDENT_INFO_KEY);
    // 登出：恢復輸入欄與按鈕（不隱藏整個彈窗）
    $("student-seat").style.display = "";
    $("student-password").style.display = "";
    $("student-login-btn").style.display = "";
    $("student-login-cancel").style.display = "";
    $("student-login-error").style.display = "";
    $("change-student-password-btn").style.display = "none";
    $("top-ranking-btn").style.display = "none";
    $("student-welcome-text").style.display = "none";
    $("student-welcome-text").textContent = "";
    $("student-logout-btn").style.display = "none";
    $("top-student-btn").style.display = "inline-block";
    $("student-welcome").textContent = "";
    alert("已登出");
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
    const token = localStorage.getItem(STUDENT_TOKEN_KEY);
    const apiBase = window.APP_CONFIG && window.APP_CONFIG.apiBase
      ? window.APP_CONFIG.apiBase.replace(/\/+$/, "") : "";
    try {
      const res = await fetch(apiBase + "/api/student/password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-student-token": token
        },
        body: JSON.stringify({ oldPassword: oldPwd, password: newPwd })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
      $("change-pwd-msg").textContent = "✅ 密碼已修改，請重新登入";
      // 登出讓學生重新登入
      localStorage.removeItem(STUDENT_TOKEN_KEY);
      localStorage.removeItem(STUDENT_INFO_KEY);
      setTimeout(() => {
        $("student-login-pop").classList.add("hidden");
        $("change-student-password-btn").style.display = "none";
        $("top-ranking-btn").style.display = "none";
        $("student-welcome").textContent = "";
      }, 1500);
    } catch (e) {
      $("change-pwd-msg").textContent = "❌ " + e.message;
    }
  }

  /* ========== 排名 ========== */
  async function loadRanking() {
    const apiBase = window.APP_CONFIG && window.APP_CONFIG.apiBase
      ? window.APP_CONFIG.apiBase.replace(/\/+$/, "") : "";
    try {
      const res = await fetch(apiBase + "/api/ranking");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
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

  /* ========== 初始化 ========== */
  document.addEventListener("DOMContentLoaded", () => {
    // 學生按鈕
    $("top-student-btn").addEventListener("click", openStudentLogin);
    $("student-login-btn").addEventListener("click", doStudentLogin);
    $("student-login-cancel").addEventListener("click", closeStudentLogin);
    $("change-student-password-btn").addEventListener("click", () => {
      $("change-password-section").classList.toggle("hidden");
    });
    $("submit-change-btn").addEventListener("click", doChangePassword);
    $("cancel-change-btn").addEventListener("click", () => {
      $("change-password-section").classList.add("hidden");
      $("old-password").value = "";
      $("new-password").value = "";
      $("confirm-password").value = "";
      $("change-pwd-msg").textContent = "";
    });

    // 排名按鈕
    $("top-ranking-btn").addEventListener("click", openRanking);
    $("ranking-close").addEventListener("click", closeRanking);
    $("ranking-refresh").addEventListener("click", openRanking);

    // 檢查是否已登入
    if (localStorage.getItem(STUDENT_TOKEN_KEY)) {
      const info = JSON.parse(localStorage.getItem(STUDENT_INFO_KEY) || "{}");
      $("student-welcome-text").textContent = (info.name || info.seat) + " 已登入";
      $("student-welcome-text").style.display = "inline-block";
      $("change-student-password-btn").style.display = "inline-block";
      $("top-ranking-btn").style.display = "inline-block";
      updateLogoutBtn();
      $("top-student-btn").style.display = "none";
    }
  });
})();
