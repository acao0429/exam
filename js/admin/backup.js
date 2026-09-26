(function () {
  "use strict";
  const A = window.Admin;
  A.backup = {
    render: function () {
      const box = document.getElementById("tab-backup");
      if (!box) return;
      box.innerHTML = '\
        <div class="panel"><h2>📦 備份與還原（管理員專用）</h2>\
        <p class="hint">所有資料（帳號、班級、題庫、學生）統一備份為一份 JSON。</p>\
        <div style="margin-top:12px">\
          <button class="btn btn-blue" onclick="window.ExamCloud && window.ExamCloud.fetchBackup ? window.ExamCloud.fetchBackup().then(b=>alert(\'備份成功，筆數：\'+(b.teachers?b.teachers.length:0))).catch(e=>alert(\'失敗：\'+e.message)) : alert(\'尚未初始化\')">📤 匯出備份（JSON）</button>\
          <button class="btn btn-red" onclick="alert(\'還原功能：請使用管理員帳號透過 /api/backup/restore 還原備份\')">📥 還原備份</button>\
        </div></div>';
    }
  };
})();
