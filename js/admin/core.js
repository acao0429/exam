/* ============================================================
   老師後台 共用核心（js/admin/core.js）
   ------------------------------------------------------------
   這裡只放「所有分頁都會用到」的東西：
     1. Admin 命名空間（window.Admin）
     2. DOM 小工具 Admin.$()
     3. 共享狀態 Admin.state（bank / cBank / iBank / 批次暫存 / AI 設定）
     4. 題庫的載入、扁平化、寫回 D1
     5. AI 服務商對照表
   其餘功能各自放在同資料夾的其他檔案，最後由 main.js 組裝。

   資料來源：D1 是唯一真實來源。讀用 ExamCloud.getBank()，
   寫用 ExamCloud.pushBank()，瀏覽器不再保存題庫副本。
   ============================================================ */

(function () {
  "use strict";

  const A = (window.Admin = window.Admin || {});

  A.$ = (id) => document.getElementById(id);

  /* 目前登入老師的資訊（含權限角色），由 main.js 登入時填入（見 A.state.teacher） */
  A.isAdmin = function () {
    return !!(A.state.teacher && A.state.teacher.isAdmin);
  };

  /* AI 服務商（出題、補詞義、補成語都依這張表） */
  A.AI_PROVIDERS = {
    gemini: { label: "Gemini", icon: "🧠", free: true, models: ["gemini-2.5-flash"] },
    groq: { label: "Groq", icon: "⚡", free: true, models: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b", "openai/gpt-oss-120b"] },
    agnes: { label: "Agnes AI", icon: "✨", free: true, models: ["agnes-2.5-flash", "agnes-2.0-flash", "agnes-1.5-flash"] },
    nvidia: { label: "NVIDIA NIM", icon: "🎮", free: true, models: ["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b", "openai/gpt-oss-20b", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"] },
    openai: { label: "OpenAI", icon: "🅾️", free: false, models: ["gpt-4o-mini", "gpt-4o"] }
  };

  /* 共享狀態：各分頁透過 A.state 取用，避免同一份題庫有多個副本。
     注意：bank / cBank / iBank 會被整份取代（重設、匯入時），
     所以一律用 A.state.bank 這種寫法，不要把值抓成區域變數。 */
  A.state = {
    teacher: null,     // { id, username, displayName, classId, className, role, isAdmin }
    bank: {},          // { "課名": [ {char, zhuyin, def}, ... ] }  國字注音
    cBank: {},         // { "課名": { lesson, title, passage, questions: [...] } }  文意測驗
    iBank: {},         // { "課名": [ {idiom, bo, meaning, synonym, antonym}, ... ] }  成語
    batchRows: [],     // 批次配注音的暫存結果 [{ char, zhuyin, from }]
    batchIdiomRows: [],// 批次查成語的暫存結果
    AI_PROXY: { enabled: false, settings: {} } // settings[provider] = { hasKey, model }
  };

  /* ---------- 國字注音題庫 ----------
     內部用「課名 → [生字/語詞]」方便編輯；
     對外（存進 D1、給學生讀）一律是扁平陣列。 */

  function cloud() {
    if (!window.ExamCloud || !window.ExamCloud.enabled()) {
      throw new Error("尚未設定 API 網址（js/app-config.js 的 apiBase）");
    }
    return window.ExamCloud;
  }

  function groupToMap(flat) {
    const grouped = {};
    flat.forEach((w) => {
      if (!grouped[w.lesson]) grouped[w.lesson] = [];
      grouped[w.lesson].push({ char: w.char, zhuyin: w.zhuyin, def: w.def || "" });
    });
    return grouped;
  }

  async function loadBank() {
    return groupToMap(await cloud().getBank("words"));
  }

  function bankToFlat() {
    const flat = [];
    Object.keys(A.state.bank).forEach((lesson) => {
      A.state.bank[lesson].forEach((w) => {
        if (w.char && w.zhuyin) {
          flat.push({ lesson, char: w.char, zhuyin: w.zhuyin, ...(w.def ? { def: w.def } : {}) });
        }
      });
    });
    return flat;
  }

  /* 整份國字注音題庫寫回 D1 */
  function persistWordBank() {
    return cloud().pushBank("words", bankToFlat());
  }

  /* ---------- 文意測驗題庫 ---------- */
  async function loadCBank() {
    const grouped = {};
    (await cloud().getBank("content")).forEach((item) => { grouped[item.lesson] = item; });
    return grouped;
  }

  function cBankToFlat() {
    return Object.keys(A.state.cBank).map((lesson) => A.state.cBank[lesson]);
  }

  function persistContentBank() {
    return cloud().pushBank("content", cBankToFlat());
  }

  /* ---------- 成語題庫 ---------- */
  function groupIdiomsMap(flat) {
    const grouped = {};
    flat.forEach((it) => {
      if (!it || !it.lesson) return;
      if (!grouped[it.lesson]) grouped[it.lesson] = [];
      grouped[it.lesson].push({
        idiom: it.idiom || "",
        bo: it.bo || "",
        meaning: it.meaning || "",
        synonym: it.synonym || "",
        antonym: it.antonym || ""
      });
    });
    return grouped;
  }

  async function loadIBank() {
    return groupIdiomsMap(await cloud().getBank("idioms"));
  }

  function iBankToFlat() {
    const flat = [];
    Object.keys(A.state.iBank).forEach((lesson) => {
      A.state.iBank[lesson].forEach((it) => {
        if (it.idiom && it.bo) flat.push({
          lesson,
          idiom: it.idiom,
          bo: it.bo,
          ...(it.meaning ? { meaning: it.meaning } : {}),
          ...(it.synonym ? { synonym: it.synonym } : {}),
          ...(it.antonym ? { antonym: it.antonym } : {})
        });
      });
    });
    return flat;
  }

  function persistIBank() {
    return cloud().pushBank("idioms", iBankToFlat());
  }

  /* ---------- 三份題庫一次讀 / 一次存 ---------- */
  async function reloadAllBanks() {
    const [bank, cBank, iBank] = await Promise.all([
      loadBank(), loadCBank(), loadIBank()
    ]);
    A.state.bank = bank;
    A.state.cBank = cBank;
    A.state.iBank = iBank;
  }

  /* 國字注音題庫單獨存 */
  async function saveToCloud() {
    try {
      await persistWordBank();
      A.$("save-msg").textContent = "✅ 國字注音題庫已存到 D1。";
    } catch (e) {
      A.$("save-msg").textContent = "⚠️ 儲存失敗：" + e.message;
    }
  }

  /* 國字注音 + 文意測驗 + 成語 一起存到 D1 */
  async function saveAllToCloud() {
    A.words.collectWordRows();

    const item = A.content.currentContent();
    if (item) {
      const err = A.content.validateContent(item);
      if (err) {
        alert(`⚠️ 文意測驗忘了檢查：「${err}」`);
        return;
      }
    }

    A.idiom.collectIdiomRows();

    const msg = A.$("save-msg");
    msg.textContent = "⏳ 儲存中…";
    try {
      await Promise.all([persistWordBank(), persistContentBank(), persistIBank()]);
      A.words.renderLessonSelect();
      A.idiom.renderIdiomLessonSelect();
      msg.textContent = "✅ 三份題庫都已存到 D1，學生端下次就讀得到。";
    } catch (e) {
      msg.textContent = "⚠️ 儲存失敗：" + e.message;
    }
  }

  /* ---------- 小工具 ---------- */
  function fetchWithTimeout(url, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      fetch(url).then(
        (r) => { clearTimeout(timer); resolve(r); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  /* 題庫存檔是背景自動觸發（新增/刪除課次等），失敗時不要讓整頁炸掉 */
  function quiet(promise) {
    return promise.catch((e) => {
      if (window.console) console.warn("題庫儲存失敗：", e.message);
    });
  }

  A.store = {
    groupToMap,
    loadBank,
    bankToFlat,
    persistWordBank,
    loadCBank,
    cBankToFlat,
    persistContentBank,
    groupIdiomsMap,
    loadIBank,
    iBankToFlat,
    persistIBank,
    reloadAllBanks,
    quiet
  };

  A.save = { saveToCloud, saveAllToCloud };
  A.net = { fetchWithTimeout };

})();
