/* ============================================================
   練習頁登入門禁（學生）
   放在練習頁 <head> 或最前面的 <script>：
   未登入（沒有 exam_student_token）→ 整頁跳回 login.html
   ============================================================ */
(function () {
  "use strict";
  try {
    if (!localStorage.getItem("exam_student_token")) {
      location.replace("login.html");
    }
  } catch (e) {
    location.replace("login.html");
  }
})();