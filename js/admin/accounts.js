(function () {
  "use strict";
  const A = window.Admin;
  const $ = A.$;

  /* ========== 載入教師清單 ========== */
  async function loadTeachers() {
    if (!window.ExamCloud || !window.ExamCloud.enabled()) {
      $("accounts-tbody").innerHTML = '<tr><td colspan="7" style="text-align:center;color:#c00">尚未設定 API 網址（js/app-config.js 的 apiBase），無法讀取帳號資料。</td></tr>';
      return;
    }
    try {
      const token = window.ExamCloud.getTeacherToken();
      if (!token) throw new Error("請先以管理員帳號登入");
      const res = await fetch(window.APP_CONFIG.apiBase + "/api/teachers", {
        headers: { authorization: "Bearer " + token, "x-teacher-token": token, accept: "application/json" }
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      renderTable(data.teachers || []);
    } catch (e) {
      $("accounts-tbody").innerHTML = '<tr><td colspan="7" style="text-align:center;color:#c00">讀取失敗：' + e.message + '</td></tr>';
    }
  }

  function renderTable(teachers) {
    const tbody = $("accounts-tbody");
    if (!teachers || teachers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">尚無教師帳號。請使用下方「新增教師」建立。</td></tr>';
      return;
    }
    tbody.innerHTML = teachers.map((t, i) => {
      const roleLabel = t.role === "admin" ? "管理員" : "教師";
      const statusLabel = t.isActive ? "啟用" : "停用";
      const statusClass = t.isActive ? "status-on" : "status-off";
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + (t.username || "") + '</td>' +
        '<td>' + (t.name || "") + '</td>' +
        '<td>' + (t.className || "—") + '</td>' +
        '<td><span class="badge ' + (t.role === "admin" ? "badge-admin" : "badge-teacher") + '">' + roleLabel + '</span></td>' +
        '<td><span class="badge ' + statusClass + '">' + statusLabel + '</span></td>' +
        '<td><button class="btn btn-sm btn-blue" onclick="window.Admin.accounts.editClass(' + t.id + ',\'' + (t.className || "") + '\')">修改班級</button></td>' +
        '<td><button class="btn btn-sm btn-red" onclick="window.Admin.accounts.deleteTeacher(' + t.id + ',\'' + (t.username || "") + '\',\'' + (t.role || "") + '\')" title="只能刪除非 admin 或不是最後一位 admin">刪除</button></td>' +
        '<td><button class="btn btn-sm btn-blue" onclick="window.Admin.accounts.resetPw(' + t.id + ',\'' + (t.username || "") + '\')">重設密碼</button></td>' +
        '<td><button class="btn btn-sm ' + (t.isActive ? 'btn-red' : 'btn-green') + '" onclick="window.Admin.accounts.toggleActive(' + t.id + ', ' + (!t.isActive) + ')">' + (t.isActive ? "停用" : "啟用") + '</button></td>' +
        '</tr>';
    }).join("");
  }

  /* ========== 新增教師表單 ========== */
  function showAddForm() {
    const wrap = document.getElementById("add-teacher-form-wrap");
    if (!wrap) {
      const panel = document.querySelector("#tab-accounts .panel");
      if (!panel) return;
      const div = document.createElement("div");
      div.id = "add-teacher-form-wrap";
      div.style.marginTop = "12px";
      div.innerHTML = `
        <div style="background:#f0f4f8;padding:12px;border-radius:6px;border:1px solid #dde;">
          <h4 style="margin:0 0 8px">➕ 新增教師帳號</h4>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="new-username" placeholder="登入帳號（2~32 字）" style="flex:1 1 120px;padding:6px;border:1px solid #ccc;border-radius:4px">
            <input id="new-name" placeholder="老師姓名" style="flex:1 1 120px;padding:6px;border:1px solid #ccc;border-radius:4px">
            <input id="new-class" placeholder="班級名稱（可留空）" style="flex:1 1 120px;padding:6px;border:1px solid #ccc;border-radius:4px">
            <input id="new-password" placeholder="密碼（至少 6 字）" type="password" style="flex:1 1 120px;padding:6px;border:1px solid #ccc;border-radius:4px">
            <label style="font-size:12px;color:#555;align-self:center"><input id="new-is-admin" type="checkbox"> 管理員</label>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px">
            <button class="btn btn-blue btn-sm" onclick="window.Admin.accounts.createTeacher()">建立帳號</button>
            <button class="btn btn-gray btn-sm" onclick="document.getElementById('add-teacher-form-wrap').remove()">取消</button>
          </div>
          <p id="new-teacher-msg" style="margin-top:6px;font-size:12px;color:#c00"></p>
        </div>`;
      panel.appendChild(div);
    }
  }

  async function createTeacher() {
    const username = String(document.getElementById("new-username").value || "").trim();
    const name = String(document.getElementById("new-name").value || "").trim();
    const className = String(document.getElementById("new-class").value || "").trim();
    const password = String(document.getElementById("new-password").value || "").trim();
    const isAdmin = document.getElementById("new-is-admin").checked;
    const msgEl = document.getElementById("new-teacher-msg");
    msgEl.textContent = "";
    if (!username) { msgEl.textContent = "請輸入登入帳號"; return; }
    if (!name) { msgEl.textContent = "請輸入姓名"; return; }
    if (password.length < 6) { msgEl.textContent = "密碼至少 6 個字元"; return; }
    try {
      const token = window.ExamCloud.getTeacherToken();
      if (!token) throw new Error("請先以管理員帳號登入");
      const res = await fetch(window.APP_CONFIG.apiBase + "/api/teachers", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token, "x-teacher-token": token },
        body: JSON.stringify({ username, name, className, password, role: isAdmin ? "admin" : "teacher" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      msgEl.style.color = "#080";
      msgEl.textContent = "✅ 已建立教師帳號：" + username + (isAdmin ? "（管理員）" : "");
      loadTeachers();
    } catch (e) {
      msgEl.textContent = "❌ 建立失敗：" + e.message;
    }
  }

  async function resetPw(id, username) {
    const pw = prompt("請輸入「" + username + "」的新密碼（至少 6 字）：", "");
    if (!pw) return;
    if (pw.length < 6) { alert("密碼至少 6 個字元"); return; }
    try {
      const token = window.ExamCloud.getTeacherToken();
      if (!token) throw new Error("請先以管理員帳號登入");
      const res = await fetch(window.APP_CONFIG.apiBase + "/api/teachers/" + id + "/password", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token, "x-teacher-token": token },
        body: JSON.stringify({ password: pw })
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      alert("✅ 已重設「" + username + "」的密碼，該老師所有裝置已登出。");
    } catch (e) {
      alert("❌ 重設密碼失敗：" + e.message);
    }
  }

  async function toggleActive(id, isActive) {
    const label = isActive ? "啟用" : "停用";
    if (!confirm("確定要將帳號「" + id + "」" + label + "嗎？")) return;
    try {
      const token = window.ExamCloud.getTeacherToken();
      if (!token) throw new Error("請先以管理員帳號登入");
      const res = await fetch(window.APP_CONFIG.apiBase + "/api/teachers/" + id, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: "Bearer " + token, "x-teacher-token": token },
        body: JSON.stringify({ isActive })
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      loadTeachers();
      alert("✅ 已將帳號「" + id + "」" + label);
    } catch (e) {
      alert("❌ 操作失敗：" + e.message);
    }
  }

  /* ---------- 修改班級（直接輸入新班級名，後端 trigger 自動建立 classes） ---------- */
  async function editClass(id, currentClassName) {
    const newName = prompt("請輸入新班級名稱（可留空，會自動建立 classes 記錄）：", currentClassName || "");
    if (newName === null) return; // 取消
    try {
      const token = window.ExamCloud.getTeacherToken();
      if (!token) throw new Error("請先以管理員帳號登入");
      const res = await fetch(window.APP_CONFIG.apiBase + "/api/teachers/" + id, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: "Bearer " + token, "x-teacher-token": token },
        body: JSON.stringify({ className: newName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
      alert("✅ 已修改帳號「" + id + "」的班級為：「" + newName + "」");
      loadTeachers();
    } catch (e) {
      alert("❌ 修改班級失敗：" + e.message);
    }
  }

  /* ---------- 刪除帳號（簡單提示 + 最後管理員保護，由後端強制拒絕） ---------- */
  async function deleteTeacher(id, username, role) {
    const isAdmin = role === "admin";
    let displayName = username || id;
    try {
      const token = window.ExamCloud.getTeacherToken();
      if (!token) { alert("請先以管理員帳號登入"); return; }
      const res = await fetch(window.APP_CONFIG.apiBase + "/api/teachers", {
        headers: { authorization: "Bearer " + token, "x-teacher-token": token }
      });
      const data = await res.json();
      if (res.ok && data.teachers) {
        const t = data.teachers.find(t => t.id === id);
        if (t) username = t.username || t.id;
      }
    } catch (e) {}
    
    const msg = isAdmin 
      ? `確定要刪除 admin 帳號「${username}」嗎？\n（系統必須保留至少一位 admin）`
      : `確定要刪除帳號「${username}」嗎？`;
    if (!confirm(msg)) return;
    
    try {
      const token = window.ExamCloud.getTeacherToken();
      if (!token) throw new Error("請先以管理員帳號登入");
      const res = await fetch(window.APP_CONFIG.apiBase + "/api/teachers/" + id, {
        method: "DELETE",
        headers: { authorization: "Bearer " + token, "x-teacher-token": token }
      });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = (data && data.error) || `HTTP ${res.status}`;
        throw new Error(errMsg);
      }
      const successMsg = data.relatedStudents 
        ? `✅ 已刪除帳號「${username}」！
關聯的 ${data.studentCount} 位學生已移除教師歸屬。`
        : `✅ 已刪除帳號「${username}」！`;
      alert(successMsg);
      loadTeachers();
    } catch (e) {
      // 顯示完整錯誤訊息幫助除錯
      alert("❌ 刪除失敗：" + e.message + "\n\n可能原因：\n• 不能刪除自己的帳號\n• 你是最後一位 admin\n• Token 已過期，請重新登入");
    }
  }

  A.accounts = {
    render: async function () {
      const box = document.getElementById("tab-accounts");
      if (!box) return;
      box.innerHTML = '\
        <div class="panel"><h2>👑 帳號與班級管理（管理員專用）</h2>\
        <button class="btn btn-blue" onclick="window.Admin.accounts.showAddForm()">➕ 新增教師帳號</button>\
        <table class="word-table" style="margin-top:12px;width:100%"><thead><tr><th>#</th><th>登入帳號</th><th>姓名</th><th>班級</th><th>角色</th><th>狀態</th><th>操作</th></tr></thead><tbody id="accounts-tbody"><tr><td colspan="7">載入中…</td></tr></tbody></table>\
        </div>';
      await loadTeachers();
    },
    showAddForm: showAddForm,
    createTeacher: createTeacher,
    resetPw: resetPw,
    toggleActive: toggleActive,
    editClass: editClass,
    deleteTeacher: deleteTeacher,
    loadTeachers: loadTeachers
  };
})();
