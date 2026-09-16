/* ============================================================
   首頁：老師登入
   ============================================================ */

(function () {
  "use strict";

  const LOGIN_KEY = "exam_teacher_logged_in";
  const $ = (id) => document.getElementById(id);

  function openLogin() {
    $("login-pop").classList.remove("hidden");
    $("login-user").focus();
    $("login-error").textContent = "";
  }

  function closeLogin() {
    $("login-pop").classList.add("hidden");
  }

  function doLogin() {
    const u = $("login-user").value.trim();
    const p = $("login-pass").value;
    if (u === ADMIN_CONFIG.username && p === ADMIN_CONFIG.password) {
      sessionStorage.setItem(LOGIN_KEY, "1");
      window.location.href = "admin.html";
    } else {
      $("login-error").textContent = "❌ 帳號或密碼錯誤，請再試一次。";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("top-login-btn").addEventListener("click", openLogin);
    $("login-cancel").addEventListener("click", closeLogin);
    $("login-btn").addEventListener("click", doLogin);
    $("login-pass").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
    $("login-user").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("login-pass").focus();
    });
  });
})();