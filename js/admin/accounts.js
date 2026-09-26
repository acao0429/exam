(function () {
  "use strict";
  const A = window.Admin;
  A.accounts = {
    render: function () {
      const box = document.getElementById("tab-accounts");
      if (!box) return;
      box.innerHTML = '\
        <div class="panel"><h2>👑 管理員帳號與班級管理</h2>\
        <p class="hint">（管理員專用）可建立教師帳號、設定班級、停用帳號、重設密碼。</p>\
        <p>此頁面將由後台管理員使用，目前為骨架。已在雲端設定角色與 classes 表。</p>\
        <button class="btn btn-blue" onclick="alert(\'帳號管理介面：請在後台直接呼叫 /api/teachers 等 API 管理\')">📋 查看目前教師列表（可擴充為表格）</button>\
        </div>';
    }
  };
})();
