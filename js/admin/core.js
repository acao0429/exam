/* ============================================================
   老師後台 共用核心（js/admin/core.js）
   ------------------------------------------------------------
   這裡只放「所有分頁都會用到」的東西：
     1. Admin 命名空間（window.Admin）
     2. DOM 小工具 Admin.$()
     3. 共享狀態 Admin.state（bank / cBank / iBank / 批次暫存 / AI 設定）
     4. 題庫的載入、扁平化、寫回瀏覽器
     5. AI 服務商對照表
   其餘功能各自放在同資料夾的其他檔案，最後由 main.js 組裝。
   ============================================================ */

(function () {
  "use strict";

  const A = (window.Admin = window.Admin || {});

  A.$ = (id) => document.getElementById(id);

  /* localStorage 的鍵名（學生端與雲端也用同一組，不要隨意改名） */
  A.keys = {
    words: "exam_word_bank_v1",
    content: "exam_passage_bank_v1",
    idioms: "exam_idiom_bank_v1",
    login: "exam_teacher_logged_in"
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
    bank: {},          // { "課名": [ {char, zhuyin, def}, ... ] }  國字注音
    cBank: {},         // { "課名": { lesson, title, passage, questions: [...] } }  文意測驗
    iBank: {},         // { "課名": [ {idiom, bo, meaning, synonym, antonym}, ... ] }  成語
    batchRows: [],     // 批次配注音的暫存結果 [{ char, zhuyin, from }]
    batchIdiomRows: [],// 批次查成語的暫存結果
    AI_PROXY: { enabled: false, settings: {} } // settings[provider] = { hasKey, model }
  };

  /* ---------- 國字注音題庫 ----------
     內部用「課名 → [生字/語詞]」方便編輯；
     localStorage 統一存成 WORD_BANK 相同的扁平陣列，學生端才讀得懂。 */
  function groupToMap(flat) {
    const grouped = {};
    flat.forEach((w) => {
      if (!grouped[w.lesson]) grouped[w.lesson] = [];
      grouped[w.lesson].push({ char: w.char, zhuyin: w.zhuyin, def: w.def || "" });
    });
    return grouped;
  }

  function loadBank() {
    try {
      const saved = localStorage.getItem(A.keys.words);
      if (saved) return groupToMap(JSON.parse(saved));
    } catch (e) { /* 忽略 */ }
    return groupToMap(WORD_BANK);
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

  /* 把整份題庫寫進瀏覽器 + 打「已存過」記號（記號讓學生端知道：空的就當真的空，不要回退到內建範例） */
  function persistWordBank() {
    try {
      localStorage.setItem(A.keys.words, JSON.stringify(bankToFlat()));
      localStorage.setItem("exam_word_bank_saved", "1");
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 文意測驗題庫 ---------- */
  function loadCBank() {
    const grouped = {};
    PASSAGE_BANK.forEach((item) => { grouped[item.lesson] = item; });
    try {
      const saved = localStorage.getItem(A.keys.content);
      if (saved) {
        const arr = JSON.parse(saved);
        const parsed = {};
        arr.forEach((item) => { parsed[item.lesson] = item; });
        return parsed;
      }
    } catch (e) { /* 忽略 */ }
    return grouped;
  }

  function cBankToFlat() {
    return Object.keys(A.state.cBank).map((lesson) => A.state.cBank[lesson]);
  }

  function persistContentBank() {
    try {
      localStorage.setItem(A.keys.content, JSON.stringify(cBankToFlat()));
      localStorage.setItem("exam_passage_bank_saved", "1");
      return true;
    } catch (e) { return false; }
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

  function loadIBank() {
    try {
      const saved = localStorage.getItem(A.keys.idioms);
      if (saved) return groupIdiomsMap(JSON.parse(saved));
    } catch (e) { /* 忽略 */ }
    return groupIdiomsMap(IDIOM_BANK);
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
    try {
      localStorage.setItem(A.keys.idioms, JSON.stringify(iBankToFlat()));
      localStorage.setItem("exam_idiom_bank_saved", "1");
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 三份題庫一次存 / 一次重載 ---------- */
  function reloadAllBanks() {
    A.state.bank = loadBank();
    A.state.cBank = loadCBank();
    A.state.iBank = loadIBank();
  }

  function saveToLocal() {
    if (persistWordBank()) {
      A.$("save-msg").textContent = "✅ 已存到這台電腦的瀏覽器！";
    } else {
      A.$("save-msg").textContent = "⚠️ 儲存失敗，可能是瀏覽器空間不足。";
    }
  }

  /* 國字注音 + 文意測驗 + 成語 一起存到這台電腦 */
  function saveAllLocal() {
    A.words.collectWordRows();
    const okWord = persistWordBank();

    let okContent = true;
    const item = A.content.currentContent();
    if (item) {
      const err = A.content.validateContent(item);
      if (err) {
        alert(`⚠️ 文意測驗忘了檢查：「${err}」`);
        okContent = false;
      } else {
        okContent = persistContentBank();
      }
    } else {
      okContent = persistContentBank();
    }

    A.idiom.collectIdiomRows();
    const okIdiom = persistIBank();

    A.words.renderLessonSelect();
    A.idiom.renderIdiomLessonSelect();
    if (okWord && okContent && okIdiom) {
      A.$("save-msg").textContent = "✅ 三份題庫都已存到這台電腦！要給學生，請按「📤 匯出給學生」取得一份含全部題庫的檔案。";
    } else {
      A.$("save-msg").textContent = "⚠️ 儲存失敗，可能是瀏覽器空間不足。";
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
    reloadAllBanks
  };

  A.save = { saveToLocal, saveAllLocal };
  A.net = { fetchWithTimeout };

})();
