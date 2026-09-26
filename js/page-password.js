/* ============================================================
   獨立修改密碼頁（student-password.html / teacher-password.html）
   ------------------------------------------------------------
   這個頁面只做一件事：修改自己的密碼。
   角色由 <body data-role="student|teacher"> 決定：
     學生 → window.ExamCloud.studentChangePassword()
     老師 → POST /api/teacher/password
   未登入 → 整頁跳回 login.html。
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

  function teacherToken() {
    return localStorage.getItem("exam_teacher_token");
  }

  function requireLogin() {
    try {
      const ok = isTeacher()
        ? !!localStorage.getItem("exam_teacher_token")
        : !!localStorage.getItem("exam_student_token");
      if (!ok) {
        location.replace("login.html");
        return false;
      }
    } catch (e) {
      location.replace("login.html");
      return false;
    }
    return true;
  }

  /* ---------- 老師改密碼 ---------- */
  async function teacherChangePassword(oldPwd, newPwd) {
    const token = teacherToken();
    const res = await fetch(apiBase() + "/api/teacher/password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-teacher-token": token,
        authorization: "Bearer " + token
      },
      body: JSON.stringify({ oldPassword: oldPwd, password: newPwd })
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
  }

  /* ---------- 送出 ---------- */
  async function doChangePassword() {
    const oldPwd = $("old-password").value;
    const newPwd = $("new-password").value;
    const confirmPwd = $("confirm-password").value;
    if (!oldPwd || !newPwd || !confirmPwd) {
      $("change-pwd-msg").textContent = "❌ 請填寫所有欄位";
      return;
    }
    if (newPwd !== confirmPwd) {
      $("change-pwd-msg").textContent = "❌ 新密碼與確認新密碼不一致";
      return;
    }
    if (newPwd.length < 4) {
      $("change-pwd-msg").textContent = "❌ 密碼至少 4 個字元";
      return;
    }
    const btn = $("submit-change-btn");
    btn.disabled = true;
    $("change-pwd-msg").textContent = "處理中…";
    try {
      if (isTeacher()) {
        await teacherChangePassword(oldPwd, newPwd);
      } else {
        await window.ExamCloud.studentChangePassword(oldPwd, newPwd);
      }
      $("change-pwd-msg").textContent = "✅ 密碼已修改，請重新登入";
      setTimeout(() => { location.replace("login.html"); }, 1200);
    } catch (e) {
      $("change-pwd-msg").textContent = "❌ " + e.message;
      btn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!requireLogin()) return;
    $("submit-change-btn").addEventListener("click", doChangePassword);
  });
})();
