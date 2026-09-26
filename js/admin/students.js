/* ============================================================
   老師後台 分頁：👨‍🎓 學生管理（js/admin/students.js）
   ------------------------------------------------------------
   匯入 Excel／貼上名單建檔、刪除學生、重設密碼、統計表。
   班級與老師設定：改我的班級、把未分班學生移入我的班級、
   指定學生所屬老師。
   全部透過 /api/students、/api/teacher/class、/api/teachers、/api/stats（需老師登入 token）。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;

  let excelStudentPreview = []; // 暫存 Excel 預覽資料

  async function apiFetch(path, options) {
    const token = ExamCloud.getTeacherToken();
    if (!token) { alert("請先登入"); return null; }
    const res = await fetch(ExamCloud.apiBase() + path, {
      ...options,
      headers: { ...(options && options.headers), authorization: "Bearer " + token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    return data;
  }

  /* ---------- Excel 匯入 ---------- */
  function parseExcelStudents(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = e.target.result;
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (rows.length < 2) {
          alert("Excel 檔案沒有資料（至少需要標題列 + 一筆資料）");
          return;
        }
        // 自動偵測標題行（含「座號」或「座位」或「seat」的列）
        const headerRow = rows[0];
        const idxSeat = headerRow.findIndex(h => String(h).includes("座號") || String(h).includes("座位") || String(h).toLowerCase() === "seat");
        const idxName = headerRow.findIndex(h => String(h).includes("姓名") || String(h).includes("名字") || String(h).toLowerCase() === "name");
        const idxPass = headerRow.findIndex(h => String(h).includes("密碼") || String(h).toLowerCase() === "password");

        excelStudentPreview = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const seat = String(r[idxSeat >= 0 ? idxSeat : 0]).trim();
          const name = String(r[idxName >= 0 ? idxName : 1]).trim();
          const password = idxPass >= 0 ? String(r[idxPass]).trim() : "";
          if (!seat || !name) continue;
          excelStudentPreview.push({ seat, name, password });
        }
        renderExcelPreview();
      } catch (err) {
        alert("讀取 Excel 失敗：" + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function renderExcelPreview() {
    const tbody = $("excel-preview-tbody");
    const defaultPass = $("default-password").value.trim();
    tbody.innerHTML = "";
    excelStudentPreview.forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${s.seat}</td><td>${s.name}</td><td>${s.password || defaultPass || "（使用統一密碼）"}</td>`;
      tbody.appendChild(tr);
    });
    $("excel-preview-count").textContent = `預覽 ${excelStudentPreview.length} 位`;
    $("excel-preview-wrap").classList.remove("hidden");
  }

  /* ---------- 我的班級 ---------- */
  async function loadMyClass() {
    try {
      const data = await apiFetch("/api/teacher/me");
      if (!data) return;
      $("my-class-input").value = data.teacher.className || "";
    } catch (e) {
      $("my-class-msg").textContent = "載入失敗：" + e.message;
    }
  }

  async function saveMyClass() {
    const className = $("my-class-input").value.trim();
    if (!className) { $("my-class-msg").textContent = "❌ 班級名稱不能為空"; return; }
    const current = (JSON.parse(localStorage.getItem("exam_teacher_info") || "{}").className) || "";
    let moveStudents = false;
    if (current && current !== className) {
      moveStudents = confirm(
        "你的班級要從「" + current + "」改成「" + className + "」。\n\n" +
        "要一併把目前「" + current + "」的學生也移到新班級嗎？\n" +
        "（不移的話，舊學生會留在舊班級，你就看不到他們了）"
      );
    }
    try {
      const data = await apiFetch("/api/teacher/class", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ className, moveStudents })
      });
      if (!data) return;
      // 更新本地存的教師資訊，讓頂欄 badge 同步
      const info = JSON.parse(localStorage.getItem("exam_teacher_info") || "{}");
      info.className = data.className;
      localStorage.setItem("exam_teacher_info", JSON.stringify(info));
      const badge = document.getElementById("teacher-class-badge");
      if (badge) {
        badge.textContent = "📚 " + data.className;
        badge.style.display = "inline";
      }
      $("my-class-msg").textContent = "✅ 已改為「" + data.className + "」"
        + (data.movedStudents ? "（學生已一併移入）" : "");
      loadStudents();
    } catch (e) {
      $("my-class-msg").textContent = "❌ " + e.message;
    }
  }

  /* ---------- 未分班學生 ---------- */
  async function claimStudents() {
    if (!confirm("把所有「班級為空」的學生移到你的班級？\n（這樣他們才會出現在排名與名單裡）")) return;
    try {
      const data = await apiFetch("/api/students/claim", { method: "POST" });
      if (!data) return;
      $("claim-msg").textContent = data.claimed > 0
        ? "✅ 已移入 " + data.claimed + " 位到「" + data.className + "」"
        : "沒有未分班的學生";
      loadStudents();
    } catch (e) {
      $("claim-msg").textContent = "❌ " + e.message;
    }
  }

  /* ---------- 老師清單（指定所屬老師） ---------- */
  let teacherList = [];

  async function loadTeachers() {
    try {
      const data = await apiFetch("/api/teachers");
      if (!data) return;
      teacherList = data.teachers || [];
      const me = JSON.parse(localStorage.getItem("exam_teacher_info") || "{}");
      const options = teacherList.map((t) =>
        `<option value="${t.id}">${t.name || t.username}（${t.className}）${t.id === me.id ? "・我" : ""}</option>`
      ).join("");
      const assignSel = $("assign-teacher-select");
      const createSel = $("create-teacher-select");
      if (assignSel) {
        assignSel.innerHTML = options;
        if (me.id) assignSel.value = String(me.id);
      }
      if (createSel) {
        createSel.innerHTML = options;
        if (me.id) createSel.value = String(me.id);
      }
    } catch (e) {
      $("assign-teacher-msg").textContent = "老師清單載入失敗：" + e.message;
    }
  }

  async function assignTeacher() {
    const checks = document.querySelectorAll(".student-check:checked");
    if (!checks.length) { $("assign-teacher-msg").textContent = "❌ 請先勾選學生"; return; }
    const teacherId = Number($("assign-teacher-select").value) || 0;
    if (!teacherId) { $("assign-teacher-msg").textContent = "❌ 請選擇老師"; return; }
    const seats = Array.from(checks).map((c) => c.dataset.seat);
    try {
      const data = await apiFetch("/api/students/assign-teacher", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seats, teacherId })
      });
      if (!data) return;
      $("assign-teacher-msg").textContent = "✅ 已更新 " + data.updated + " 位";
      loadStudents();
    } catch (e) {
      $("assign-teacher-msg").textContent = "❌ " + e.message;
    }
  }

  /* ---------- 全選 / 個別指定所屬老師 ---------- */
  function syncSelectAll() {
    const all = $("select-all-students");
    if (!all) return;
    const boxes = document.querySelectorAll(".student-check");
    const checked = document.querySelectorAll(".student-check:checked");
    all.checked = boxes.length > 0 && checked.length === boxes.length;
    all.indeterminate = checked.length > 0 && checked.length < boxes.length;
  }

  function toggleSelectAll(checked) {
    document.querySelectorAll(".student-check").forEach((c) => { c.checked = checked; });
  }

  async function assignTeacherToSeat(seat, teacherId) {
    if (!teacherId) return;
    try {
      const data = await apiFetch("/api/students/assign-teacher", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seats: [seat], teacherId })
      });
      if (!data) return;
      $("assign-teacher-msg").textContent = "✅ 座號 " + seat + " 的所屬老師已更新";
    } catch (e) {
      $("assign-teacher-msg").textContent = "❌ " + e.message;
    }
  }

  /* ---------- 建檔 ---------- */
  async function createStudents() {
    const text = $("student-list-text").value.trim();
    const defaultPass = $("default-password").value.trim();
    const teacherId = Number($("create-teacher-select").value) || 0;
    let students;
    if (excelStudentPreview.length > 0) {
      students = excelStudentPreview.map(s => ({
        seat: s.seat,
        name: s.name,
        password: s.password || defaultPass,
        teacherId
      }));
      excelStudentPreview = [];
      $("excel-preview-wrap").classList.add("hidden");
      $("excel-preview-count").textContent = "";
      $("student-excel-file").value = "";
    } else if (!text) {
      $("student-create-msg").textContent = "請輸入名單或匯入 Excel";
      return;
    } else {
      students = text.split(/\n/).map(l => {
        const parts = l.split(/[,，\t]+/);
        return { seat: parts[0] && parts[0].trim(), name: parts[1] && parts[1].trim(), password: parts[2] && parts[2].trim() || defaultPass, teacherId };
      }).filter(s => s.seat);
    }
    if (!students.length) { $("student-create-msg").textContent = "無有效資料"; return; }
    try {
      const data = await apiFetch("/api/students", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ students })
      });
      if (!data) return;
      $("student-create-msg").textContent = "成功建檔 " + data.imported + " 位";
      loadStudents();
    } catch (e) {
      $("student-create-msg").textContent = "失敗：" + e.message;
    }
  }

  /* ---------- 名單 ---------- */
  function teacherOptions(selectedId) {
    const list = teacherList.map((t) =>
      `<option value="${t.id}"${Number(selectedId) === t.id ? " selected" : ""}>${t.name || t.username}</option>`
    ).join("");
    // 沒有指定老師時，要加一個「未指定」選項，
    // 否則瀏覽器會自動選第一個，看起來像已經有指定。
    return selectedId ? list : '<option value="">（未指定）</option>' + list;
  }

  async function loadStudents() {
    try {
      if (!teacherList.length) await loadTeachers();
      const data = await apiFetch("/api/students");
      if (!data) return;
      renderStudents(data.students);
    } catch (e) {
      $("student-count").textContent = "載入失敗：" + e.message;
    }
  }

  function renderStudents(students) {
    const tbody = $("students-tbody");
    tbody.innerHTML = "";
    $("student-count").textContent = students ? students.length + " 位" : "0 位";
    const all = $("select-all-students");
    if (all) { all.checked = false; all.indeterminate = false; }
    if (!students) return;
    students.forEach((s) => {
      const rate = s.total > 0 ? Math.round(s.correct / s.total * 100) + "%" : "-";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" class="student-check" data-seat="${s.seat}"></td>
        <td>${s.seat}</td>
        <td class="stu-name">${s.name}</td>
        <td class="stu-teacher">
          <select class="stu-teacher-select" data-seat="${s.seat}">${teacherOptions(s.teacher_id)}</select>
        </td>
        <td>${s.total || 0}</td>
        <td>${s.correct || 0}</td>
        <td>${rate}</td>
        <td>
          <button class="btn btn-sm btn-gray reset-btn" data-seat="${s.seat}">重設密碼</button>
          <button class="btn btn-sm btn-red delete-btn" data-seat="${s.seat}">刪除</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    // 每列直接改所屬老師
    tbody.querySelectorAll(".stu-teacher-select").forEach((sel) => {
      sel.addEventListener("change", () => assignTeacherToSeat(sel.dataset.seat, Number(sel.value)));
    });
    // 個別勾選時同步全選框狀態
    tbody.addEventListener("change", syncSelectAll);
    // 綁定重設密碼按鈕
    tbody.querySelectorAll(".reset-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const seat = btn.dataset.seat;
        const pass = prompt("輸入新密碼：");
        if (!pass) return;
        resetPassword(seat, pass);
      });
    });
    // 綁定刪除按鈕
    tbody.querySelectorAll(".delete-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!confirm("確認刪除座號 " + btn.dataset.seat + "？")) return;
        deleteStudent(btn.dataset.seat);
      });
    });
  }

  async function resetPassword(seat, password) {
    try {
      await apiFetch("/api/students/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seat, password })
      });
      alert("已重設 " + seat + " 的密碼");
    } catch (e) {
      alert("重設失敗：" + e.message);
    }
  }

  async function deleteStudent(seat) {
    try {
      await apiFetch("/api/students", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seats: [seat] })
      });
      loadStudents();
    } catch (e) {
      alert("刪除失敗：" + e.message);
    }
  }

  async function deleteSelected() {
    const checks = document.querySelectorAll(".student-check:checked");
    if (!checks.length) { alert("請勾選要刪除的學生"); return; }
    if (!confirm("確認刪除「" + Array.from(checks).map(c => c.dataset.seat).join("、") + "」？")) return;
    const seats = Array.from(checks).map(c => c.dataset.seat);
    try {
      await apiFetch("/api/students", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seats })
      });
      $("delete-msg").textContent = "已刪除 " + seats.length + " 位";
      loadStudents();
    } catch (e) {
      $("delete-msg").textContent = "失敗：" + e.message;
    }
  }

  /* ---------- 統計 ---------- */
  async function loadStats() {
    try {
      const data = await apiFetch("/api/stats");
      if (!data) return;
      renderStats(data.stats);
    } catch (e) {
      alert("統計載入失敗：" + e.message);
    }
  }

  function renderStats(stats) {
    const tbody = $("stats-tbody");
    tbody.innerHTML = "";
    $("stats-table").style.display = stats && stats.length ? "table" : "none";
    if (!stats) return;
    stats.forEach(s => {
      const rate = s.total > 0 ? Math.round(s.correct / s.total * 100) + "%" : "-";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${s.bank}</td><td>${s.lesson}</td><td>${s.mode}</td><td>${s.total}</td><td>${s.correct}</td><td>${rate}</td>`;
      tbody.appendChild(tr);
    });
  }

  /* ---------- 事件綁定 ---------- */
  function bind() {
    $("batch-create-btn").addEventListener("click", createStudents);
    $("student-excel-file").addEventListener("change", (e) => {
      if (e.target.files.length > 0) parseExcelStudents(e.target.files[0]);
    });
    $("load-students-btn").addEventListener("click", loadStudents);
    $("delete-selected-btn").addEventListener("click", deleteSelected);
    $("load-stats-btn").addEventListener("click", loadStats);
    $("save-my-class-btn").addEventListener("click", saveMyClass);
    $("claim-students-btn").addEventListener("click", claimStudents);
    $("assign-teacher-btn").addEventListener("click", assignTeacher);
    $("select-all-students").addEventListener("change", (e) => toggleSelectAll(e.target.checked));
    loadMyClass();
    loadTeachers();
  }

  A.students = {
    parseExcelStudents,
    renderExcelPreview,
    createStudents,
    loadStudents,
    renderStudents,
    resetPassword,
    deleteStudent,
    deleteSelected,
    loadStats,
    renderStats,
    loadMyClass,
    saveMyClass,
    claimStudents,
    loadTeachers,
    assignTeacher,
    syncSelectAll,
    toggleSelectAll,
    assignTeacherToSeat,
    bind
  };

})();
