/* ============================================================
   雲端共用（老師後台 ＋ 學生端）

   資料來源：全部以 D1 為唯一真實來源。
   學生端直接讀 /api/words、/api/content、/api/idioms；
   老師後台存檔時用對應的單表 PUT 寫回 D1。
   瀏覽器不再保存任何題庫副本（無 localStorage 鏡像、無匯入）。

   老師後台另有：老師登入、AI 代理、備份中心。
   學生端另有：座號＋密碼登入 → 作答上雲 → 錯題本跨裝置。

   apiBase 來自 js/app-config.js 的 window.APP_CONFIG.apiBase。
   留空時所有雲端功能自動停用。
   ============================================================ */

(function () {
  "use strict";

  const TEACHER_TOKEN_KEY = "exam_teacher_token";

  function base() {
    const cfg = (typeof window !== "undefined" && window.APP_CONFIG) || {};
    return String(cfg.apiBase || "").replace(/\/+$/, "");
  }

  function enabled() { return base() !== ""; }


  /* ============ 老師 teacher token ============ */
  function getTeacherToken() {
    try { return localStorage.getItem(TEACHER_TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setTeacherToken(t) {
    try {
      if (t) localStorage.setItem(TEACHER_TOKEN_KEY, t);
      else localStorage.removeItem(TEACHER_TOKEN_KEY);
    } catch (e) { /* 忽略 */ }
  }
  function teacherHeaders() {
    const h = { accept: "application/json", "content-type": "application/json" };
    const t = getTeacherToken();
    if (t) { h.authorization = "Bearer " + t; h["x-teacher-token"] = t; }
    return h;
  }

  /* ============ 老師 AI 設定（金鑰只存伺服器 D1，瀏覽器不持有） ============ */
  async function aiSettingsGet() {
    if (!enabled()) throw new Error("尚未設定 API 網址（js/app-config.js 的 apiBase）");
    if (!getTeacherToken()) throw new Error("請先以老師帳號登入");
    const res = await fetch(base() + "/api/ai/settings", { headers: teacherHeaders() });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error || ""; } catch (e) { /* 忽略 */ }
      throw new Error("HTTP " + res.status + (msg ? "：" + msg : ""));
    }
    return res.json();
  }

  async function aiSettingsSet(provider, apiKey, model) {
    if (!enabled()) throw new Error("尚未設定 API 網址（js/app-config.js 的 apiBase）");
    if (!getTeacherToken()) throw new Error("請先以老師帳號登入");
    const res = await fetch(base() + "/api/ai/settings", {
      method: "POST",
      headers: teacherHeaders(),
      body: JSON.stringify({ provider, apiKey, model })
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error || ""; } catch (e) { /* 忽略 */ }
      throw new Error("HTTP " + res.status + (msg ? "：" + msg : ""));
    }
    return res.json();
  }

  /* 測試 AI 連線（伺服器端代理測試）。回傳 { ok, message, model? } */
  async function aiTest(provider, model) {
    const res = await fetch(base() + "/api/ai/test", {
      method: "POST",
      headers: teacherHeaders(),
      body: JSON.stringify({ provider, model })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data;
  }

  /* 伺服器端 AI 代理：prompt 由前端組好，金鑰在伺服器。回傳 { text } */
  async function aiChat(provider, model, prompt, system, temperature) {
    const res = await fetch(base() + "/api/ai/chat", {
      method: "POST",
      headers: teacherHeaders(),
      body: JSON.stringify({ provider, model, prompt, system, temperature })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    if (!data || typeof data.text !== "string") throw new Error("AI 沒有回傳內容");
    return data.text;
  }

  /* 判斷目前是否有「伺服器端 AI 可用」（已登入 + 已設定 apiBase） */
  function aiProxyEnabled() {
    return enabled() && getTeacherToken() !== "";
  }

  /* ============ 題庫：讀寫都直接對 D1 ============ */

  const BANK_PATH = { words: "/api/words", content: "/api/content", idioms: "/api/idioms" };

  function assertBank(kind) {
    if (!BANK_PATH[kind]) throw new Error("不支援的題庫：" + kind);
  }

  /* 讀取單一題庫（學生端與老師後台都用這個） */
  async function getBank(kind) {
    assertBank(kind);
    if (!enabled()) throw new Error("尚未設定 API 網址（js/app-config.js 的 apiBase）");
    const res = await fetch(base() + BANK_PATH[kind], { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  /* 一次取三份（老師後台開台時用） */
  async function fetchBanks() {
    if (!enabled()) return null;
    const res = await fetch(base() + "/api/banks", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  /* 寫回單一題庫（老師後台「儲存」按鈕） */
  async function pushBank(kind, arr) {
    assertBank(kind);
    if (!enabled()) throw new Error("尚未設定 API 網址（js/app-config.js 的 apiBase）");
    const token = getTeacherToken();
    if (!token) throw new Error("請先以老師帳號登入");
    const res = await fetch(base() + BANK_PATH[kind], {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: "Bearer " + token, "x-teacher-token": token },
      body: JSON.stringify(Array.isArray(arr) ? arr : [])
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error || ""; } catch (e) { /* 忽略 */ }
      throw new Error("HTTP " + res.status + (msg ? "：" + msg : ""));
    }
    return res.json();
  }

  /* 老師後台通用請求（帳號、班級、備份等新端點都走這裡） */
  async function teacherFetch(path, options) {
    if (!enabled()) throw new Error("尚未設定 API 網址（js/app-config.js 的 apiBase）");
    const token = getTeacherToken();
    if (!token) throw new Error("請先以老師帳號登入");
    const opt = Object.assign({}, options || {});
    opt.method = opt.method || "GET";
    opt.headers = Object.assign({ accept: "application/json" }, teacherHeaders(), opt.headers || {});
    if (opt.body !== undefined && typeof opt.body !== "string") {
      opt.headers["content-type"] = "application/json";
      opt.body = JSON.stringify(opt.body);
    }
    const res = await fetch(base() + path, opt);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data;
  }

  /* ============ 備份中心（僅管理員） ============ */

  async function fetchBackup() { return teacherFetch("/api/backup"); }

  async function restoreBackup(payload) {
    return teacherFetch("/api/backup/restore", { method: "POST", body: payload });
  }

  async function backupLog() { return teacherFetch("/api/backup/log"); }

  /* ============================================================
     學生端：座號＋密碼登入 → 作答上雲 → 錯題本跨裝置
     - login(seat, password)：POST /api/student/login
       回傳 { token, student:{id,seat,name} }，token 存本機
     - logout()：POST /api/student/logout（需 token）
     - pushAttempt(item)：POST /api/attempts（需 token）
       item = { bank, lesson, mode, itemKey, prompt, chosen, correct }
     - mergeWrongCloud(localWrong)：GET /api/attempts/me?wrong=1
       抓雲端錯題，與本機 localWrong 以 (bank|lesson|mode|itemKey) 去重合併
     ============================================================ */

  const STUDENT_TOKEN_KEY = "exam_student_token";
  const STUDENT_INFO_KEY = "exam_student_info";

  function getStudentToken() {
    try { return localStorage.getItem(STUDENT_TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setStudentToken(t) {
    try {
      if (t) localStorage.setItem(STUDENT_TOKEN_KEY, t);
      else localStorage.removeItem(STUDENT_TOKEN_KEY);
    } catch (e) { /* 忽略 */ }
  }
  function getStudentInfo() {
    try { return JSON.parse(localStorage.getItem(STUDENT_INFO_KEY) || "null"); } catch (e) { return null; }
  }
  function setStudentInfo(o) {
    try {
      if (o) localStorage.setItem(STUDENT_INFO_KEY, JSON.stringify(o));
      else localStorage.removeItem(STUDENT_INFO_KEY);
    } catch (e) { /* 忽略 */ }
  }
  function studentLoggedIn() {
    return enabled() && getStudentToken() !== "";
  }
  function studentHeaders() {
    const h = {
      accept: "application/json",
      "content-type": "application/json"
    };
    const t = getStudentToken();
    if (t) {
      h.authorization = "Bearer " + t;
      h["x-student-token"] = t;
    }
    return h;
  }

  async function studentLogin(seat, password) {
    if (!enabled()) throw new Error("尚未設定 API 位址（js/app-config.js 的 apiBase）");
    const res = await fetch(base() + "/api/student/login", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ seat: String(seat || ""), password: String(password || "") })
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    setStudentToken(data.token);
    setStudentInfo(data.student || null);
    return data;
  }

  async function studentLogout() {
    if (!studentLoggedIn()) { setStudentToken(""); setStudentInfo(null); return; }
    try {
      await fetch(base() + "/api/student/logout", {
        method: "POST",
        headers: studentHeaders()
      });
    } catch (e) { /* 忽略 */ }
    setStudentToken("");
    setStudentInfo(null);
  }

  /* 學生修改密碼：POST /api/student/password */
  async function studentChangePassword(oldPassword, newPassword) {
    if (!studentLoggedIn()) throw new Error("尚未登入");
    const res = await fetch(base() + "/api/student/password", {
      method: "POST",
      headers: studentHeaders(),
      body: JSON.stringify({
        oldPassword: String(oldPassword || ""),
        password: String(newPassword || "")
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
    return data;
  }

  /* 作答上雲。成功回 true；未登入／未啟用時回 false。 */
  async function pushAttempt(item) {
    if (!studentLoggedIn() || !item) return false;
    const res = await fetch(base() + "/api/attempts", {
      method: "POST",
      headers: studentHeaders(),
      body: JSON.stringify({
        bank: String((item && item.bank) || ""),
        lesson: String((item && item.lesson) || ""),
        mode: String((item && item.mode) || ""),
        itemKey: String((item && item.itemKey) || ""),
        prompt: String((item && item.prompt) || ""),
        chosen: String((item && item.chosen) || ""),
        correct: (item && item.correct) ? 1 : 0
      })
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error || ""; } catch (e) { /* 忽略 */ }
      throw new Error("HTTP " + res.status + (msg ? "：" + msg : ""));
    }
    return true;
  }

  function wrongKey(it) {
    return [String((it && it.bank) || ""), String((it && it.lesson) || ""),
      String((it && it.mode) || ""), String((it && it.itemKey) || "")].join("|");
  }

  /* 登入時整包合併：本機 localWrong 為基底，雲端錯題（wrong=1）補上不重複的。 */
  async function mergeWrongCloud(localWrong) {
    if (!studentLoggedIn()) return Array.isArray(localWrong) ? localWrong.slice() : [];
    try {
      const res = await fetch(base() + "/api/attempts/me?wrong=1", {
        headers: studentHeaders()
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const cloud = Array.isArray(data && data.attempts) ? data.attempts : [];
      const local = Array.isArray(localWrong) ? localWrong.slice() : [];
      const seen = new Set(local.map(wrongKey));
      cloud.forEach((c) => {
        const it = {
          bank: String(c.bank || ""),
          lesson: String(c.lesson || ""),
          mode: String(c.mode || ""),
          itemKey: String(c.itemKey || c.item_key || ""),
          prompt: String(c.prompt || ""),
          chosen: String(c.chosen || ""),
          correct: !!c.correct
        };
        const k = wrongKey(it);
        if (!seen.has(k)) { seen.add(k); local.push(it); }
      });
      return local;
    } catch (e) {
      if (window.console) console.warn("雲端錯題抓取失敗：", e.message);
      return Array.isArray(localWrong) ? localWrong.slice() : [];
    }
  }

  /* 練習頁共用的「學生狀態列」：顯示目前登入學生＋登出鈕。
     三隻練習頁（zhuyin/content/idiom）都載入 cloud.js、共用同一登入 session。 */
  function renderStudentBar() {
    const bar = document.getElementById("student-bar");
    if (!bar) return;
    if (!enabled() || !studentLoggedIn()) {
      bar.classList.add("hidden");
      return;
    }
    const info = getStudentInfo();
    const name = (info && (info.name || info.seat)) || "同學";
    bar.classList.remove("hidden");
    bar.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = "👋 " + name;
    const out = document.createElement("button");
    out.className = "btn btn-sm btn-gray";
    out.textContent = "🚪 登出";
    out.addEventListener("click", async () => {
      await studentLogout();
      location.replace("login.html");
    });
    bar.appendChild(span);
    bar.appendChild(out);
  }

  window.ExamCloud = {
    enabled: function () { return enabled(); },
    apiBase: function () { return base(); },
    getTeacherToken,
    setTeacherToken,
    aiSettingsGet,
    aiSettingsSet,
    aiTest,
    aiChat,
    aiProxyEnabled,
    getBank,
    fetchBanks,
    pushBank,
    teacherFetch,
    fetchBackup,
    restoreBackup,
    backupLog,
    renderStudentBar,
    getStudentToken,
    setStudentToken,
    getStudentInfo,
    studentLoggedIn,
    studentLogin,
    studentLogout,
    studentChangePassword,
    pushAttempt,
    mergeWrongCloud
  };
})();
