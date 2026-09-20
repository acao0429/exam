/* ============================================================
   雲端共用（老師後台 ＋ 學生端）
   - 老師後台：pushAll() 三份題庫整批覆蓋；fetchBanks() 讀雲端
   - 學生端：座號＋密碼登入 → 作答上雲（POST /api/attempts）
     → 登入時抓雲端錯題（POST /api/attempts/me?wrong=1）整包合併
     → 錯題本變成跨裝置（手機/平板/電腦共用同一本）
   apiBase 來自 js/app-config.js 的 window.APP_CONFIG.apiBase。
   留空時所有雲端功能自動停用，行為與原本相同。
   ============================================================ */

(function () {
  "use strict";

  const TEACHER_TOKEN_KEY = "exam_teacher_token";
  const WORD_KEY = "exam_word_bank_v1";
  const CONTENT_KEY = "exam_passage_bank_v1";
  const IDIOM_KEY = "exam_idiom_bank_v1";

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

  /* ============ 本機題庫快取 ============ */
  function saveLocal(key, arr, savedKey) {
    if (!Array.isArray(arr)) return;
    localStorage.setItem(key, JSON.stringify(arr));
    localStorage.setItem(savedKey, "1");
  }

  async function fetchBanks() {
    if (!enabled()) return null;
    const res = await fetch(base() + "/api/banks", {
      headers: { accept: "application/json" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  /* 學生端：把雲端題庫抓下來整批覆蓋本機快取（成功才有值）。 */
  async function hydrateLocalFromCloud() {
    try {
      const data = await fetchBanks();
      if (!data) return false;
      saveLocal(WORD_KEY, data.words, "exam_word_bank_saved");
      saveLocal(CONTENT_KEY, data.content, "exam_passage_bank_saved");
      saveLocal(IDIOM_KEY, data.idioms, "exam_idiom_bank_saved");
      return true;
    } catch (e) {
      if (window.console) console.warn("雲端題庫載入失敗：", e.message);
      return false;
    }
  }

  /* 老師後台：三份題庫整批蓋雲端。data 需含 words / content / idioms。 */
  async function pushAll(data) {
    if (!enabled()) throw new Error("尚未設定 API 網址（js/app-config.js 的 apiBase）");
    const token = getTeacherToken();
    if (!token) throw new Error("請先以老師帳號登入");
    const res = await fetch(base() + "/api/banks", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error || ""; } catch (e) { /* 忽略 */ }
      throw new Error("HTTP " + res.status + (msg ? "：" + msg : ""));
    }
    return res.json();
  }

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
      renderStudentBar();
    });
    bar.appendChild(span);
    bar.appendChild(out);
  }

  window.ExamCloud = {
    enabled: function () { return enabled(); },
    apiBase: function () { return base(); },
    getTeacherToken,
    setTeacherToken,
    fetchBanks,
    hydrateLocalFromCloud,
    pushAll,
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
