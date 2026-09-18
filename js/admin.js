/* ============================================================
   老師後台：登入 + 題庫管理 + 批次配注音 + 儲存/匯出
   ============================================================ */

(function () {
  "use strict";

  const STORE_KEY = "exam_word_bank_v1";
  const LOGIN_KEY = "exam_teacher_logged_in";
  const CONTENT_STORE_KEY = "exam_passage_bank_v1";
  const IDIOM_STORE_KEY = "exam_idiom_bank_v1";

  const $ = (id) => document.getElementById(id);

  let bank = {}; // { "課名": [ {char, zhuyin}, ... ] }
  let batchRows = []; // 批次輸入的暫存結果 [{ char, zhuyin }]
  let cBank = {}; // { "課名": { lesson, title, passage, questions: [...] } }
  let iBank = {}; // { "課名": [ { idiom, bo, meaning, synonym, antonym }, ... ] }

  /* ---------- 題庫載入 ----------
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
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) return groupToMap(JSON.parse(saved));
    } catch (e) { /* 忽略 */ }
    return groupToMap(WORD_BANK);
  }

  function bankToFlat() {
    const flat = [];
    Object.keys(bank).forEach((lesson) => {
      bank[lesson].forEach((w) => {
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
      localStorage.setItem(STORE_KEY, JSON.stringify(bankToFlat()));
      localStorage.setItem("exam_word_bank_saved", "1");
      return true;
    } catch (e) { return false; }
  }

  function persistContentBank() {
    try {
      localStorage.setItem(CONTENT_STORE_KEY, JSON.stringify(cBankToFlat()));
      localStorage.setItem("exam_passage_bank_saved", "1");
      return true;
    } catch (e) { return false; }
  }

  function saveToLocal() {
    if (persistWordBank()) {
      $("save-msg").textContent = "✅ 已存到這台電腦的瀏覽器！";
    } else {
      $("save-msg").textContent = "⚠️ 儲存失敗，可能是瀏覽器空間不足。";
    }
  }

  /* 國字注音 + 文意測驗 + 成語 一起存到這台電腦 */
  function saveAllLocal() {
    collectWordRows();
    const okWord = persistWordBank();

    let okContent = true;
    const item = currentContent();
    if (item) {
      const err = validateContent(item);
      if (err) {
        alert(`⚠️ 文意測驗忘了檢查：「${err}」`);
        okContent = false;
      } else {
        okContent = persistContentBank();
      }
    } else {
      okContent = persistContentBank();
    }

    collectIdiomRows();
    const okIdiom = persistIBank();

    renderLessonSelect();
    renderIdiomLessonSelect();
    if (okWord && okContent && okIdiom) {
      downloadTextFile("data.js", buildWordDataJS());
      downloadTextFile("data-content.js", buildContentJS(cBankToFlat().filter((it) => !validateContent(it))));
      downloadTextFile("data-idioms.js", buildIdiomDataJS());
      $("save-msg").textContent = "✅ 三份題庫都已存檔，並自動下載 data.js、data-content.js、data-idioms.js 備份！";
    } else {
      $("save-msg").textContent = "⚠️ 儲存失敗，可能是瀏覽器空間不足。";
    }
  }

  /* ---------- 登入 ---------- */
  function doLogin() {
    const u = $("login-user").value.trim();
    const p = $("login-pass").value;
    if (u === ADMIN_CONFIG.username && p === ADMIN_CONFIG.password) {
      sessionStorage.setItem(LOGIN_KEY, "1");
      showAdmin();
    } else {
      $("login-error").textContent = "❌ 帳號或密碼錯誤，請再試一次。";
    }
  }

  /* ---------- 文意測驗題庫載入 ---------- */
  function loadCBank() {
    const grouped = {};
    PASSAGE_BANK.forEach((item) => { grouped[item.lesson] = item; });
    try {
      const saved = localStorage.getItem(CONTENT_STORE_KEY);
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
    return Object.keys(cBank).map((lesson) => cBank[lesson]);
  }

  function showAdmin() {
    $("login-screen").classList.add("hidden");
    $("admin-screen").classList.remove("hidden");
    renderLessonSelect();
    renderBatchLessonSelect();
    renderContentLessonSelect();
    renderIdiomLessonSelect();
    fillAI();
  }

  function checkLogin() {
    const logged = sessionStorage.getItem(LOGIN_KEY) === "1";
    if (logged) {
      showAdmin();
      $("login-user").disabled = true;
      $("login-pass").disabled = true;
    } else {
      $("login-user").focus();
    }
  }

  /* ---------- 頁籤切換 ---------- */
  function switchTab(tab) {
    document.querySelectorAll(".tabbar .chip").forEach((c) => c.classList.remove("selected"));
    document.querySelector(`.tabbar [data-tab="${tab}"]`).classList.add("selected");
    $("tab-manual").classList.toggle("hidden", tab !== "manual");
    $("tab-batch").classList.toggle("hidden", tab !== "batch");
    $("tab-content").classList.toggle("hidden", tab !== "content");
    $("tab-idiom").classList.toggle("hidden", tab !== "idiom");
  }

  /* ---------- 課次管理 ---------- */
  function lessonNames() { return Object.keys(bank); }

  function renderLessonSelect() {
    const sel = $("lesson-select");
    sel.innerHTML = "";
    const lessons = lessonNames();
    if (lessons.length === 0) {
      sel.innerHTML = "<option value=''>（尚無課次，請先新增）</option>";
      $("word-edit").classList.add("hidden");
      return;
    }
    lessons.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = `${name}（${bank[name].length} 筆）`;
      sel.appendChild(opt);
    });
    sel.value = lessons[0];
    renderWordRows();
  }

  function renderBatchLessonSelect() {
    const sel = $("batch-lesson-select");
    if (!sel) return;
    sel.innerHTML = "";
    const lessons = lessonNames();
    if (lessons.length === 0) {
      sel.innerHTML = "<option value=''>（尚無課次，請先到「逐字輸入」新增）</option>";
      return;
    }
    lessons.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  function addLesson() {
    const name = $("lesson-name").value.trim();
    if (!name) {
      $("lesson-name").focus();
      return;
    }
    if (bank[name]) {
      alert("這個課次已經存在了！");
      return;
    }
    bank[name] = [{ char: "", zhuyin: "" }];
    $("lesson-name").value = "";
    renderLessonSelect();
    renderBatchLessonSelect();
    persistWordBank();
  }

  function currentLesson() {
    const sel = $("lesson-select");
    return sel.value ? bank[sel.value] : null;
  }

  function deleteLesson() {
    const sel = $("lesson-select");
    const lesson = sel.value;
    if (!lesson || !bank[lesson]) {
      alert("目前沒有課次可以刪除。");
      return;
    }
    const count = bank[lesson].length;
    const ok = confirm(`確定要刪除「${lesson}」嗎？\n（共有 ${count} 筆，刪掉就不能救回來囉！）`);
    if (!ok) return;
    delete bank[lesson];
    renderLessonSelect();
    renderBatchLessonSelect();
    persistWordBank();
    $("save-msg").textContent = `🗑 已刪除「${lesson}」並存進瀏覽器；若要給其他電腦用，別忘了匯出 data.js。`;
  }

  /* ---------- 生字表格 ---------- */
  function renderWordRows() {
    const tbody = $("word-tbody");
    tbody.innerHTML = "";
    const words = currentLesson();
    if (!words) return;
    $("word-edit").classList.remove("hidden");

    words.forEach((w, idx) => {
      const tr = document.createElement("tr");

      const tdChar = document.createElement("td");
      const inputChar = document.createElement("input");
      inputChar.type = "text";
      inputChar.maxLength = 12;
      inputChar.value = w.char || "";
      inputChar.placeholder = "國字或語詞";
      tdChar.appendChild(inputChar);

      const tdZhuyin = document.createElement("td");
      const inputZhuyin = document.createElement("input");
      inputZhuyin.type = "text";
      inputZhuyin.value = w.zhuyin || "";
      inputZhuyin.placeholder = "例如 ㄔㄨㄣ ㄊㄧㄢ";
      tdZhuyin.appendChild(inputZhuyin);

      const tdDef = document.createElement("td");
      const inputDef = document.createElement("textarea");
      inputDef.rows = 2;
      inputDef.maxLength = 120;
      inputDef.value = w.def || "";
      inputDef.placeholder = "選填，例如：溫暖花開的季節";
      tdDef.appendChild(inputDef);

      const tdDel = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-sm btn-gray";
      delBtn.textContent = "🗑 刪除";
      delBtn.addEventListener("click", () => {
        bank[selValue()].splice(idx, 1);
        if (bank[selValue()].length === 0) bank[selValue()].push({ char: "", zhuyin: "", def: "" });
        renderWordRows();
      });
      tdDel.appendChild(delBtn);

      tr.appendChild(tdChar);
      tr.appendChild(tdZhuyin);
      tr.appendChild(tdDef);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
  }

  function selValue() { return $("lesson-select").value; }

  function addWordRow() {
    const words = currentLesson();
    if (words) {
      words.push({ char: "", zhuyin: "", def: "" });
      renderWordRows();
    }
  }

  /* 把表格內容寫回 bank */
  function collectWordRows() {
    const lesson = selValue();
    const rows = $("word-tbody").querySelectorAll("tr");
    bank[lesson] = [];
    rows.forEach((tr) => {
      const inputs = tr.querySelectorAll("input, textarea");
      const char = inputs[0].value.trim();
      const zhuyin = inputs[1].value.trim();
      const def = inputs[2].value.trim();
      if (char && zhuyin) bank[lesson].push({ char, zhuyin, def });
    });
    if (bank[lesson].length === 0) bank[lesson].push({ char: "", zhuyin: "", def: "" });
  }

  function saveLesson() {
    collectWordRows();
    if (persistWordBank()) {
      renderLessonSelect();
      renderBatchLessonSelect();
      downloadTextFile("data.js", buildWordDataJS());
      $("save-msg").textContent = "✅ 已儲存，並自動下載 data.js 備份！把這個檔案取代 js/data.js 發給學生即可。";
    } else {
      $("save-msg").textContent = "⚠️ 儲存失敗。";
    }
  }

  /* 從萌典（教育部辭典）資料結構取第一條意義 */
  function extractDef(data) {
    if (!data) return "";
    if (Array.isArray(data.h)) { /* 語詞 /a/ */
      for (const entry of data.h) {
        if (Array.isArray(entry.d) && entry.d.length && entry.d[0] && entry.d[0].f) {
          return String(entry.d[0].f).replace(/[`~]/g, "").replace(/\s+/g, " ").slice(0, 40);
        }
      }
    }
    if (Array.isArray(data.heteronyms)) { /* 單字 /uni/ */
      for (const h of data.heteronyms) {
        if (Array.isArray(h.definitions) && h.definitions.length && h.definitions[0] && h.definitions[0].def) {
          return String(h.definitions[0].def).replace(/[`~]/g, "").replace(/\s+/g, " ").slice(0, 40);
        }
      }
    }
    return "";
  }

  async function lookupDefOnline(text) {
    const url = text.length === 1
      ? `https://www.moedict.tw/uni/${encodeURIComponent(text)}.json`
      : `https://www.moedict.tw/a/${encodeURIComponent(text)}.json`;
    const resp = await fetchWithTimeout(url, 8000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return extractDef(await resp.json());
  }

  /* 批次填詞義（教育部辭典，有連網才能用） */
  async function fillDefsOnline() {
    const rows = [...$("word-tbody").querySelectorAll("tr")];
    const jobs = [];
    rows.forEach((tr) => {
      const inputs = tr.querySelectorAll("input, textarea");
      const char = inputs[0].value.trim();
      if (char) jobs.push({ inputs, char });
    });
    if (jobs.length === 0) { alert("這個課次還沒有生字，先輸入喔。"); return; }

    const btn = $("fill-defs-btn");
    btn.disabled = true;
    const oldText = btn.textContent;
    let ok = 0, fail = 0;
    let skip = 0;
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      btn.textContent = `🔍 查詞義（${i + 1}/${jobs.length}）…`;
      if (job.inputs[2].value.trim()) { skip++; continue; }
      try {
        const def = await lookupDefOnline(job.char);
        if (def) { job.inputs[2].value = def; ok++; } else fail++;
      } catch (e) { fail++; }
    }
    btn.disabled = false;
    btn.textContent = oldText;
    $("save-msg").textContent = `🔍 完成：${ok} 筆填上詞義，${fail} 筆查不到，${skip} 筆原本就有。檢查後記得按「儲存此課」。`;
  }

  /* 批次補詞義（AI，需要後台已存的金鑰） */
  async function fillDefsAI() {
    const cfg = loadAI();
    if (!cfg.key) { alert("還沒有 AI 金鑰：到「✨ AI 自動出題」區貼上 Gemini 或 Groq 金鑰，按「存金鑰」即可。"); return; }
    const rows = [...$("word-tbody").querySelectorAll("tr")];
    const words = [];
    rows.forEach((tr) => {
      const inputs = tr.querySelectorAll("input, textarea");
      const char = inputs[0].value.trim();
      if (char && !inputs[2].value.trim()) words.push(char);
    });
    if (words.length === 0) { alert("這個課次的詞義都填好了，不用補。"); return; }

    const btn = $("fill-defs-ai-btn");
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "🤖 AI 補詞義中…";
    try {
      const defs = await GenQuestions.aiFillDefs(words, cfg);
      let n = 0;
      rows.forEach((tr) => {
        const inputs = tr.querySelectorAll("input, textarea");
        const char = inputs[0].value.trim();
        if (char && defs[char] && !inputs[2].value.trim()) { inputs[2].value = defs[char]; n++; }
      });
      $("save-msg").textContent = `🤖 AI 補了 ${n} 筆詞義，${words.length - n} 筆沒補到。檢查後記得按「儲存此課」。`;
    } catch (e) {
      $("save-msg").textContent = `🤖 AI 補詞義失敗：${e.message}`;
    }
    btn.disabled = false;
    btn.textContent = oldText;
  }

  /* ============================================================
     批次配注音
     ============================================================ */

  /* 線上：萌典（教育部國語辭典）
     - 單字查 uni/字.json -> heteronyms[0].bopomofo
     - 語詞查 a/詞.json -> h[0].b */
  async function lookupOnline(text) {
    const url = text.length === 1
      ? `https://www.moedict.tw/uni/${encodeURIComponent(text)}.json`
      : `https://www.moedict.tw/a/${encodeURIComponent(text)}.json`;
    const resp = await fetchWithTimeout(url, 8000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (text.length === 1) {
      return (data.heteronyms && data.heteronyms[0] && data.heteronyms[0].bopomofo) || null;
    }
    return (data.h && data.h[0] && data.h[0].b) || null;
  }

  function fetchWithTimeout(url, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      fetch(url).then(
        (r) => { clearTimeout(timer); resolve(r); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  /* 離線：逐字拆開查內建表 */
  function lookupOffline(text) {
    const parts = [...text].map((c) => (OFFLINE_ZHUYIN && OFFLINE_ZHUYIN[c]) || null);
    if (parts.some((p) => !p)) return null;
    return parts.join(" ");
  }

  async function lookupZhuyin(text) {
    // 線上優先；失敗或離線時用離線表
    let online = null;
    if (navigator.onLine !== false) {
      try {
        online = await lookupOnline(text);
      } catch (e) { online = null; }
    }
    if (online) return { zhuyin: online, from: "online" };
    const offline = lookupOffline(text);
    if (offline) return { zhuyin: offline, from: "offline" };
    return { zhuyin: "", from: "none" };
  }

  function runBatch() {
    const raw = $("batch-text").value;
    const texts = [...new Set(
      raw.split(/\n/).map((s) => s.trim()).filter((s) => s.length >= 1)
    )];
    if (texts.length === 0) {
      $("batch-status").textContent = "⚠️ 請先貼上生字或語詞。";
      return;
    }
    batchRows = texts.map((t) => ({ char: t, zhuyin: "", from: "none" }));

    $("batch-run-btn").disabled = true;
    $("batch-run-btn").textContent = "✨ 配注音中…";
    $("batch-status").textContent = "⏳ 正在自動配注音，請稍候…";

    renderBatchPreview();

    (async () => {
      for (let i = 0; i < batchRows.length; i++) {
        const r = await lookupZhuyin(batchRows[i].char);
        r.from = r.from || "none";
        batchRows[i].zhuyin = r.zhuyin;
        renderBatchPreview(); // 逐筆更新，看到即時結果
      }
      const miss = batchRows.filter((r) => !r.zhuyin).length;
      $("batch-run-btn").disabled = false;
      $("batch-run-btn").textContent = "✨ 自動配注音";
      $("batch-status").textContent = miss
        ? `✅ 完成！有 ${miss} 筆查不到，請手動補上注音。`
        : "✅ 全部配好囉！檢查注音沒問題就能加入題庫。";
    })();
  }

  function renderBatchPreview() {
    const tbody = $("batch-tbody");
    tbody.innerHTML = "";
    batchRows.forEach((r, idx) => {
      const tr = document.createElement("tr");

      const tdChar = document.createElement("td");
      tdChar.textContent = r.char;
      tdChar.style.fontSize = "20px";

      const tdZhuyin = document.createElement("td");
      const inputZhuyin = document.createElement("input");
      inputZhuyin.type = "text";
      inputZhuyin.value = r.zhuyin || "";
      inputZhuyin.placeholder = "手動填注音";
      inputZhuyin.setAttribute("data-idx", idx);
      inputZhuyin.addEventListener("input", (e) => {
        batchRows[parseInt(e.target.dataset.idx, 10)].zhuyin = e.target.value.trim();
      });
      tdZhuyin.appendChild(inputZhuyin);

      const tdTag = document.createElement("td");
      if (r.from === "online") tdTag.textContent = "🌐";
      else if (r.from === "offline") tdTag.textContent = "📴";
      else tdTag.textContent = "";
      tdTag.style.fontSize = "16px";

      tr.appendChild(tdChar);
      tr.appendChild(tdZhuyin);
      tr.appendChild(tdTag);
      tbody.appendChild(tr);
    });
    $("batch-preview-wrap").classList.remove("hidden");
  }

  function addBatchToBank() {
    const sel = $("batch-lesson-select");
    const lesson = sel.value;
    if (!lesson || !bank[lesson]) {
      alert("請先新增課次，或選擇要加入的課次。");
      return;
    }
    const valid = batchRows.filter((r) => r.char && r.zhuyin);
    if (valid.length === 0) {
      alert("沒有可以加入的資料，請先配好注音。");
      return;
    }
    valid.forEach((r) => bank[lesson].push({ char: r.char, zhuyin: r.zhuyin }));
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(bankToFlat()));
      renderLessonSelect();
      renderBatchLessonSelect();
      $("batch-status").textContent = `🎉 已把 ${valid.length} 筆加入「${lesson}」！可以繼續貼下一批，或用「逐字輸入」檢查。`;
      $("batch-preview-wrap").classList.add("hidden");
      $("batch-text").value = "";
      batchRows = [];
    } catch (e) {
      $("batch-status").textContent = "⚠️ 儲存失敗。";
    }
  }

  /* ============================================================
     文意測驗 題庫管理
     ============================================================ */

  function currentContent() {
    const sel = $("content-lesson-select");
    return sel.value ? cBank[sel.value] : null;
  }

  function blankQuestion() {
    return { type: "文意", q: "", options: ["", "", "", ""], answer: 0 };
  }

  function renderContentLessonSelect() {
    const sel = $("content-lesson-select");
    sel.innerHTML = "";
    const lessons = Object.keys(cBank);
    if (lessons.length === 0) {
      sel.innerHTML = "<option value=''>（尚無課次，請先新增）</option>";
      $("content-edit").classList.add("hidden");
      return;
    }
    lessons.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      const item = cBank[name];
      const n = Array.isArray(item.questions) ? item.questions.length : 0;
      opt.textContent = `${name}（${n} 題）`;
      sel.appendChild(opt);
    });
    sel.value = lessons[0];
    renderContentForm();
  }

  function addContentLesson() {
    const name = $("content-lesson-name").value.trim();
    if (!name) {
      $("content-lesson-name").focus();
      return;
    }
    if (cBank[name]) {
      alert("這個課次已經存在了！");
      return;
    }
    cBank[name] = { lesson: name, title: "", passage: "", questions: [blankQuestion()] };
    $("content-lesson-name").value = "";
    renderContentLessonSelect();
    persistContentBank();
  }

  function deleteContentLesson() {
    const sel = $("content-lesson-select");
    const lesson = sel.value;
    if (!lesson || !cBank[lesson]) {
      alert("目前沒有課次可以刪除。");
      return;
    }
    const n = Array.isArray(cBank[lesson].questions) ? cBank[lesson].questions.length : 0;
    const ok = confirm(`確定要刪除「${lesson}」嗎？\n（共有 ${n} 題，刪掉就不能救回來囉！）`);
    if (!ok) return;
    delete cBank[lesson];
    renderContentLessonSelect();
    persistContentBank();
    $("save-msg").textContent = `🗑 已刪除「${lesson}」並存進瀏覽器；若要給其他電腦用，別忘了匯出 data-content.js。`;
  }

  function renderContentForm() {
    const item = currentContent();
    if (!item) {
      $("content-edit").classList.add("hidden");
      return;
    }
    $("content-edit").classList.remove("hidden");
    $("content-title").value = item.title || "";
    $("content-passage").value = item.passage || "";
    renderQuestionEditors();
  }

  /* 題目區塊編輯器（值直接即時寫回 cBank） */
  function renderQuestionEditors() {
    const wrap = $("content-questions");
    wrap.innerHTML = "";
    const item = currentContent();
    if (!item) return;
    if (item.questions.length === 0) item.questions.push(blankQuestion());
    item.questions.forEach((qq, idx) => buildQuestionBlock(wrap, qq, idx));
  }

  function buildQuestionBlock(wrap, qq, idx) {
    const block = document.createElement("div");
    block.className = "q-block";

    const head = document.createElement("div");
    head.className = "q-head";

    const num = document.createElement("b");
    num.textContent = `第 ${idx + 1} 題`;

    const typeSel = document.createElement("select");
    typeSel.className = "q-type";
    ["主旨", "文意", "細節", "詞句", "其他"].forEach((t) => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      if (t === (qq.type || "文意")) o.selected = true;
      typeSel.appendChild(o);
    });
    typeSel.addEventListener("change", () => { qq.type = typeSel.value; });

    const del = document.createElement("button");
    del.className = "btn btn-sm btn-gray";
    del.textContent = "🗑 刪除";
    del.addEventListener("click", () => {
      currentContent().questions.splice(idx, 1);
      renderQuestionEditors();
    });

    head.appendChild(num);
    head.appendChild(typeSel);
    head.appendChild(del);
    block.appendChild(head);

    const qInput = document.createElement("input");
    qInput.className = "admin-input";
    qInput.value = qq.q || "";
    qInput.placeholder = "題目，例如：這篇文章主要在說什麼？";
    qInput.addEventListener("input", () => { qq.q = qInput.value; });
    block.appendChild(qInput);

    const optList = document.createElement("div");
    optList.className = "opt-list";
    const letters = ["A", "B", "C", "D"];
    for (let i = 0; i < 4; i++) {
      const line = document.createElement("label");
      line.className = "opt-line";
      if (qq.answer === i) line.classList.add("correct-row");

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `ans-${idx}`;
      radio.value = String(i);
      radio.checked = qq.answer === i;
      radio.addEventListener("change", () => {
        qq.answer = i;
        optList.querySelectorAll(".opt-line").forEach((l, li) => {
          l.classList.toggle("correct-row", li === i);
        });
      });

      const tag = document.createElement("span");
      tag.className = "opt-letter-tag";
      tag.textContent = letters[i];

      const optInput = document.createElement("input");
      optInput.className = "admin-input";
      optInput.value = qq.options[i] || "";
      optInput.placeholder = `選項 ${letters[i]}`;
      optInput.addEventListener("input", () => { qq.options[i] = optInput.value; });

      line.appendChild(radio);
      line.appendChild(tag);
      line.appendChild(optInput);
      optList.appendChild(line);
    }
    block.appendChild(optList);
    wrap.appendChild(block);
  }

  function addContentQuestion() {
    const item = currentContent();
    if (!item) return;
    item.questions.push(blankQuestion());
    renderQuestionEditors();
  }

  /* 檢查這一課的題目是否完整，回傳錯誤訊息或 null */
  function validateContent(item) {
    if (!item.title || !item.title.trim()) return "記得填上文章標題～";
    if (!item.passage || !item.passage.trim()) return "記得填上課文內容～";
    if (!Array.isArray(item.questions) || item.questions.length === 0) return "至少要有 1 題喔。";
    for (let i = 0; i < item.questions.length; i++) {
      const q = item.questions[i];
      if (!q.q || !q.q.trim()) return `第 ${i + 1} 題還沒寫題目。`;
      if (!Array.isArray(q.options) || q.options.some((o) => !o || !o.trim())) return `第 ${i + 1} 題有選項還沒填。`;
      if (typeof q.answer !== "number" || q.answer < 0 || q.answer > 3) return `第 ${i + 1} 題請勾選正確答案。`;
    }
    return null;
  }

  function saveContent() {
    const item = currentContent();
    if (!item) {
      alert("請先新增課次。");
      return;
    }
    const err = validateContent(item);
    if (err) {
      alert(`⚠️ ${err}`);
      return;
    }
    if (persistContentBank()) {
      renderContentLessonSelect();
      downloadTextFile("data-content.js", buildContentJS(cBankToFlat().filter((it) => !validateContent(it))));
      $("save-msg").textContent = "✅ 文意題庫已儲存，並自動下載 data-content.js 備份！";
    } else {
      $("save-msg").textContent = "⚠️ 儲存失敗。";
    }
  }

  /* ---------- 成語練習 批次輸入 ---------- */

  /* 解析貼上的成語：換行、頓號、逗號、分號、空白、全形逗號、句點都可分開 */
  function splitIdiomText(raw) {
    return [...new Set(
      raw.split(/[\n、，,；;。.、\s·・]+/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 8)
    )];
  }

  /* 單一成語：先用內建庫，查不到的欄位留空 */
  function lookupIdiomData(text) {
    const src = (typeof OFFLINE_IDIOMS !== "undefined" && OFFLINE_IDIOMS[text]) || null;
    return {
      idiom: text,
      bo: src ? src.bo : "",
      meaning: src ? src.meaning : "",
      synonym: src ? (src.synonym || "") : "",
      antonym: src ? (src.antonym || "") : "",
      from: src ? "offline" : "none"
    };
  }

  let batchIdiomRows = [];

  function runIdiomBatch() {
    const raw = $("idiom-batch-text").value;
    const idioms = splitIdiomText(raw);
    if (idioms.length === 0) {
      $("idiom-batch-status").textContent = "⚠️ 沒讀到成語，請先貼上成語。";
      return;
    }
    batchIdiomRows = idioms.map(lookupIdiomData);
    renderIdiomBatchPreview();
    const miss = batchIdiomRows.filter((r) => r.from === "none").length;
    $("idiom-batch-status").textContent = miss
      ? `✅ 共 ${idioms.length} 筆；有 ${miss} 筆內建成語庫沒有，請手填或按下方「🤖 AI 補齊」。`
      : `✅ 共 ${idioms.length} 筆，全部從內建成語庫查到資料！`;
  }

  function renderIdiomBatchPreview() {
    const tbody = $("idiom-batch-tbody");
    tbody.innerHTML = "";
    batchIdiomRows.forEach((r, idx) => {
      const tr = document.createElement("tr");
      const cells = [
        { key: "idiom", tag: "input", value: r.idiom, ph: "四字成語" },
        { key: "bo", tag: "input", value: r.bo, ph: "例如 ㄕㄡˇ ㄓㄨ ㄉㄞˋ ㄊㄨˋ" },
        { key: "meaning", tag: "textarea", value: r.meaning, ph: "成語的意思" },
        { key: "synonym", tag: "input", value: r.synonym, ph: "選填" },
        { key: "antonym", tag: "input", value: r.antonym, ph: "選填" }
      ];
      cells.forEach((c) => {
        const td = document.createElement("td");
        const el = document.createElement(c.tag);
        if (c.tag === "textarea") { el.rows = 2; el.maxLength = 80; }
        else { el.type = "text"; el.maxLength = 12; }
        el.value = c.value || "";
        el.placeholder = c.ph;
        el.addEventListener("input", (e) => {
          batchIdiomRows[idx][c.key] = e.target.value.trim();
        });
        td.appendChild(el);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    $("idiom-batch-preview-wrap").classList.remove("hidden");
  }

  function addIdiomBatchToLesson() {
    const lesson = $("idiom-lesson-select").value;
    if (!lesson || !iBank[lesson]) {
      alert("請先在下方選好要加入的課次（或先新增課次）。");
      return;
    }
    const valid = batchIdiomRows.filter((r) => r.idiom && r.bo && r.meaning);
    if (valid.length === 0) {
      alert("沒有可以加入的資料，每個成語請填好注音與釋義。");
      return;
    }
    const existing = new Set(iBank[lesson].map((x) => x.idiom));
    const added = valid.filter((r) => !existing.has(r.idiom));
    if (added.length === 0) {
      $("idiom-batch-status").textContent = "⚠️ 這些成語這個課次裡都有了。";
      return;
    }
    added.forEach((r) => {
      iBank[lesson].push({
        idiom: r.idiom,
        bo: r.bo,
        meaning: r.meaning,
        synonym: r.synonym,
        antonym: r.antonym
      });
    });
    persistIBank();
    renderIdiomLessonSelect();
    renderIdiomRows();
    $("save-msg").textContent = `✅ 已把 ${added.length} 筆成語加入「${lesson}」。請檢查後記得按「儲存此課」或「存到這台電腦」。`;
    $("idiom-batch-text").value = "";
    $("idiom-batch-status").textContent = "";
    $("idiom-batch-preview-wrap").classList.add("hidden");
  }

  /* ---------- 成語練習 題庫管理 ---------- */
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
      const saved = localStorage.getItem(IDIOM_STORE_KEY);
      if (saved) return groupIdiomsMap(JSON.parse(saved));
    } catch (e) { /* 忽略 */ }
    return groupIdiomsMap(IDIOM_BANK);
  }

  function iBankToFlat() {
    const flat = [];
    Object.keys(iBank).forEach((lesson) => {
      iBank[lesson].forEach((it) => {
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
      localStorage.setItem(IDIOM_STORE_KEY, JSON.stringify(iBankToFlat()));
      localStorage.setItem("exam_idiom_bank_saved", "1");
      return true;
    } catch (e) { return false; }
  }

  function idiomLessonNames() { return Object.keys(iBank); }

  function renderIdiomLessonSelect() {
    const sel = $("idiom-lesson-select");
    sel.innerHTML = "";
    const lessons = idiomLessonNames();
    if (lessons.length === 0) {
      sel.innerHTML = "<option value=''>（尚無課次，請先新增）</option>";
      $("idiom-edit").classList.add("hidden");
      return;
    }
    lessons.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = `${name}（${iBank[name].length} 筆）`;
      sel.appendChild(opt);
    });
    sel.value = lessons[0];
    renderIdiomRows();
  }

  function currentIdiomLesson() {
    const sel = $("idiom-lesson-select");
    return sel.value ? iBank[sel.value] : null;
  }

  function addIdiomLesson() {
    const name = $("idiom-lesson-name").value.trim();
    if (!name) { $("idiom-lesson-name").focus(); return; }
    if (iBank[name]) { alert("這個課次已經存在了！"); return; }
    iBank[name] = [{ idiom: "", bo: "", meaning: "", synonym: "", antonym: "" }];
    $("idiom-lesson-name").value = "";
    renderIdiomLessonSelect();
    persistIBank();
  }

  function deleteIdiomLesson() {
    const sel = $("idiom-lesson-select");
    const lesson = sel.value;
    if (!lesson || !iBank[lesson]) { alert("目前沒有課次可以刪除。"); return; }
    const count = iBank[lesson].length;
    const ok = confirm(`確定要刪除「${lesson}」嗎？\n（共有 ${count} 筆，刪掉就不能救回來囉！）`);
    if (!ok) return;
    delete iBank[lesson];
    renderIdiomLessonSelect();
    persistIBank();
    $("save-msg").textContent = `🗑 已刪除「${lesson}」並存進瀏覽器；若要給其他電腦用，別忘了匯出 data-idioms.js。`;
  }

  function blankIdiomRow() {
    return { idiom: "", bo: "", meaning: "", synonym: "", antonym: "" };
  }

  function renderIdiomRows() {
    const tbody = $("idiom-tbody");
    tbody.innerHTML = "";
    const rows = currentIdiomLesson();
    if (!rows) return;
    $("idiom-edit").classList.remove("hidden");

    rows.forEach((it, idx) => {
      const tr = document.createElement("tr");

      const tdIdiom = document.createElement("td");
      const inputIdiom = document.createElement("input");
      inputIdiom.type = "text";
      inputIdiom.maxLength = 12;
      inputIdiom.value = it.idiom || "";
      inputIdiom.placeholder = "四字成語";
      tdIdiom.appendChild(inputIdiom);

      const tdBo = document.createElement("td");
      const inputBo = document.createElement("input");
      inputBo.type = "text";
      inputBo.value = it.bo || "";
      inputBo.placeholder = "例如 ㄕㄡˇ ㄓㄨ ㄉㄞˋ ㄊㄨˋ";
      tdBo.appendChild(inputBo);

      const tdMeaning = document.createElement("td");
      const inputMeaning = document.createElement("textarea");
      inputMeaning.rows = 2;
      inputMeaning.maxLength = 80;
      inputMeaning.value = it.meaning || "";
      inputMeaning.placeholder = "成語的意思，用簡單的話";
      tdMeaning.appendChild(inputMeaning);

      const tdSyn = document.createElement("td");
      const inputSyn = document.createElement("input");
      inputSyn.type = "text";
      inputSyn.maxLength = 12;
      inputSyn.value = it.synonym || "";
      inputSyn.placeholder = "選填";
      tdSyn.appendChild(inputSyn);

      const tdAnt = document.createElement("td");
      const inputAnt = document.createElement("input");
      inputAnt.type = "text";
      inputAnt.maxLength = 12;
      inputAnt.value = it.antonym || "";
      inputAnt.placeholder = "選填";
      tdAnt.appendChild(inputAnt);

      const tdDel = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-sm btn-gray";
      delBtn.textContent = "🗑 刪除";
      delBtn.addEventListener("click", () => {
        iBank[$("idiom-lesson-select").value].splice(idx, 1);
        if (iBank[$("idiom-lesson-select").value].length === 0) iBank[$("idiom-lesson-select").value].push(blankIdiomRow());
        renderIdiomRows();
      });
      tdDel.appendChild(delBtn);

      tr.appendChild(tdIdiom);
      tr.appendChild(tdBo);
      tr.appendChild(tdMeaning);
      tr.appendChild(tdSyn);
      tr.appendChild(tdAnt);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
  }

  function addIdiomRow() {
    const rows = currentIdiomLesson();
    if (rows) { rows.push(blankIdiomRow()); renderIdiomRows(); }
  }

  function collectIdiomRows() {
    const lesson = $("idiom-lesson-select").value;
    const rows = $("idiom-tbody").querySelectorAll("tr");
    iBank[lesson] = [];
    rows.forEach((tr) => {
      const inputs = tr.querySelectorAll("input, textarea");
      const idiom = inputs[0].value.trim();
      const bo = inputs[1].value.trim();
      if (!idiom) return;
      iBank[lesson].push({
        idiom,
        bo,
        meaning: inputs[2].value.trim(),
        synonym: inputs[3].value.trim(),
        antonym: inputs[4].value.trim()
      });
    });
    if (iBank[lesson].length === 0) iBank[lesson].push(blankIdiomRow());
  }

  function saveIdiomLesson() {
    collectIdiomRows();
    if (persistIBank()) {
      renderIdiomLessonSelect();
      downloadTextFile("data-idioms.js", buildIdiomDataJS());
      $("save-msg").textContent = "✅ 成語題庫已儲存，並自動下載 data-idioms.js 備份！把這個檔案取代 js/data-idioms.js 發給學生即可。";
    } else {
      $("save-msg").textContent = "⚠️ 儲存失敗。";
    }
  }

  /* 用內建成語庫一次補齊釋義/注音/近反義（免網路免金鑰） */
  function fillIdiomsLocal() {
    const rows = [...$("idiom-tbody").querySelectorAll("tr")];
    let ok = 0;
    rows.forEach((tr) => {
      const inputs = tr.querySelectorAll("input, textarea");
      const idiom = inputs[0].value.trim();
      if (!idiom) return;
      const src = (typeof OFFLINE_IDIOMS !== "undefined") && OFFLINE_IDIOMS[idiom];
      if (!src) return;
      if (!inputs[1].value.trim()) inputs[1].value = src.bo;
      if (!inputs[2].value.trim()) inputs[2].value = src.meaning;
      if (!inputs[3].value.trim() && src.synonym) inputs[3].value = src.synonym;
      if (!inputs[4].value.trim() && src.antonym) inputs[4].value = src.antonym;
      ok++;
    });
    $("save-msg").textContent = ok
      ? `🔍 已用內建成語庫補齊 ${ok} 筆。第三欄若有破音字會用教育部發音，檢查後記得按「儲存此課」。`
      : "🔍 這些成語內建庫裡沒有，改用「🤖 AI 補齊」或直接手填。";
  }

  /* 針對缺釋義/注音/近反義的成語，AI 一次補齊 */
  async function fillIdiomsAI() {
    const cfg = loadAI();
    if (!cfg.key) { alert("還沒有 AI 金鑰：到「📖 文意測驗」頁的「✨ AI 自動出題」區貼上 Gemini 或 Groq 金鑰，按「存金鑰」即可。"); return; }
    const rows = [...$("idiom-tbody").querySelectorAll("tr")];
    const items = [];
    rows.forEach((tr) => {
      const inputs = tr.querySelectorAll("input, textarea");
      const idiom = inputs[0].value.trim();
      if (!idiom) return;
      const need = !inputs[1].value.trim() || !inputs[2].value.trim();
      items.push({ idiom, need });
    });
    if (items.filter((x) => x.need).length === 0) { alert("這課的成語資料都填好了，不用補。"); return; }

    const btn = $("fill-idioms-ai-btn");
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "🤖 AI 補齊中…";
    try {
      const found = await GenIdioms.aiFillIdioms(items.map((x) => x.idiom), cfg);
      const map = {};
      found.forEach((it) => { map[it.idiom] = it; });
      let n = 0;
      rows.forEach((tr) => {
        const inputs = tr.querySelectorAll("input, textarea");
        const idiom = inputs[0].value.trim();
        const src = map[idiom];
        if (!src) return;
        if (!inputs[1].value.trim()) { inputs[1].value = src.bo; }
        if (!inputs[2].value.trim()) { inputs[2].value = src.meaning; if (src.meaning) n++; }
        if (!inputs[3].value.trim() && src.synonym) inputs[3].value = src.synonym;
        if (!inputs[4].value.trim() && src.antonym) inputs[4].value = src.antonym;
      });
      $("save-msg").textContent = `🤖 AI 補了 ${n} 筆。內建庫沒有的成語，注音也可以同時補上。檢查後記得按「儲存此課」。`;
    } catch (e) {
      $("save-msg").textContent = `🤖 AI 補齊失敗：${e.message}`;
    }
    btn.disabled = false;
    btn.textContent = oldText;
  }

  /* 依課名主題，AI 一次建議 6 個成語加進表格 */
  async function suggestIdiomsAI() {
    const cfg = loadAI();
    if (!cfg.key) { alert("還沒有 AI 金鑰：到「📖 文意測驗」頁的「✨ AI 自動出題」區貼上金鑰並按「存金鑰」。"); return; }
    const lesson = $("idiom-lesson-select").value;
    if (!lesson) { alert("請先新增或選擇課次。"); return; }

    const btn = $("suggest-idioms-btn");
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "🤖 建議成語中…";
    try {
      const found = await GenIdioms.aiSuggest(lesson, cfg);
      if (found.length === 0) { alert("AI 沒有回傳成語，請再試一次。"); return; }
      /* 有的成語內建庫有，直接用內建資料比較準；再用 AI 補空的 */
      const rows = currentIdiomLesson();
      found.forEach((it) => {
        const base = (typeof OFFLINE_IDIOMS !== "undefined") && OFFLINE_IDIOMS[it.idiom];
        rows.push({
          idiom: it.idiom,
          bo: (base && base.bo) || it.bo,
          meaning: (base && base.meaning) || it.meaning,
          synonym: (base && base.synonym) || it.synonym,
          antonym: (base && base.antonym) || it.antonym
        });
      });
      renderIdiomRows();
      $("save-msg").textContent = `🤖 依課名建議了 ${found.length} 個成語，已加入表格。檢查後記得按「儲存此課」。`;
    } catch (e) {
      $("save-msg").textContent = `🤖 AI 建議失敗：${e.message}`;
    }
    btn.disabled = false;
    btn.textContent = oldText;
  }

  /* ---------- AI 金鑰存取（每家各自一筆，切換就自動帶入） ---------- */
  /* 舊版（2026/9 前）金鑰只存一格，自動搬移到 Gemini */
  function migrateLegaAI() {
    if (!localStorage.getItem("exam_ai_key_gemini") && localStorage.getItem("exam_ai_key")) {
      localStorage.setItem("exam_ai_key_gemini", localStorage.getItem("exam_ai_key"));
      localStorage.setItem("exam_ai_model_gemini", localStorage.getItem("exam_ai_model") || "");
      localStorage.removeItem("exam_ai_key");
      localStorage.removeItem("exam_ai_model");
    }
  }

  function loadAI() {
    migrateLegaAI();
    const provider = localStorage.getItem("exam_ai_provider") || "gemini";
    return {
      provider,
      key: localStorage.getItem("exam_ai_key_" + provider) || "",
      model: localStorage.getItem("exam_ai_model_" + provider) || ""
    };
  }

  function saveAI() {
    const provider = $("ai-provider").value;
    localStorage.setItem("exam_ai_provider", provider);
    localStorage.setItem("exam_ai_key_" + provider, $("ai-key").value.trim());
    localStorage.setItem("exam_ai_model_" + provider, $("ai-model").value.trim());
    $("gen-status").textContent = "💾 已存「" + $("ai-provider").selectedOptions[0].textContent + "」的金鑰！";
  }

  function fillAI() {
    const cfg = loadAI();
    $("ai-provider").value = cfg.provider;
    $("ai-key").value = cfg.key;
    $("ai-model").value = cfg.model;
  }

  function onAIProviderChange() {
    saveAI(); // 先把目前輸入的存回原本的 provider
    fillAI(); // 再載入新選的 provider 的金鑰
  }

  /* ---------- 測試 AI 連線 ---------- */
  async function testAI() {
    saveAI();
    const cfg = loadAI();
    $("ai-test-btn").disabled = true;
    $("gen-status").textContent = "⏳ 測試連線中…";
    try {
      const r = await GenQuestions.testConnection(cfg);
      $("gen-status").textContent = (r.ok ? "✅ " : "❌ ") + r.message;
    } catch (e) {
      $("gen-status").textContent = "❌ 測試連線出錯：" + (e.message || e);
    }
    $("ai-test-btn").disabled = false;
  }

  /* ---------- 自動出題 ---------- */
  async function autoGenerateQuestions() {
    const item = currentContent();
    if (!item) { alert("請先新增課次。"); return; }
    if (!item.passage || !item.passage.trim()) { alert("請先填上課文內容，才能自動出題喔。"); return; }

    const cfg = loadAI();
    $("gen-btn").disabled = true;
    $("gen-btn").textContent = "✨ 出題中…";
    $("gen-status").textContent = "⏳ 嘗試用 AI 出題…";

    let qs = [];
    if (cfg.key) {
      try {
        $("gen-status").textContent = "⏳ 用 AI（" + cfg.provider + "）出題中…";
        qs = await GenQuestions.aiGenerate(item, cfg);
      } catch (e) {
        $("gen-status").textContent = `⚠️ AI 失敗（${e.message}），改用教育部辭典…`;
        qs = [];
      }
    }

    if (!qs || qs.length === 0) {
      $("gen-status").textContent = cfg.key ? "⏳ 改用教育部辭典規則式出題…" : "⏳ 沒有 AI 金鑰，用教育部辭典免費出題…";
      try { qs = await GenQuestions.ruleGenerate(item, Object.keys(cBank).map((n) => cBank[n])); }
      catch (e) { qs = []; }
    }

    $("gen-btn").disabled = false;
    $("gen-btn").textContent = "✨ 自動出題";

    if (!qs || qs.length === 0) {
      $("gen-status").textContent = "⚠️ 自動出題失敗：需要連網（教育部辭典），或請貼上 AI 金鑰。離線時請手動輸入。";
      return;
    }

    const msg = `自動出了 ${qs.length} 題，要加入「${item.lesson}」嗎？`;
    if (!confirm(msg)) return;
    item.questions = (item.questions || []).concat(qs);
    renderQuestionEditors();
    $("gen-status").textContent = `✨ 已加入 ${qs.length} 題，請檢查後再儲存！`;
  }

  /* ---------- 下載備份檔 / 給學生的一份檔 ---------- */
  function downloadTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/javascript;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* 全部三份題庫同時打包成一份 JSON：
     「備份」與「給學生」共用同一份內容，
     學生在任一個練習頁按「📂 匯入題庫檔」選這份檔，就三種題型全部載入。 */
  function buildAllDataJSON() {
    return {
      app: "國語月考複習樂園",
      savedAt: new Date().toISOString(),
      words: bankToFlat(),
      content: cBankToFlat(),
      idioms: iBankToFlat()
    };
  }

  /* 產生 data.js 的文字內容 */
  function buildWordDataJS() {
    const lines = [];
    lines.push("/* 這份題庫由老師後台匯出。若要手動修改格式，請參考 js/data.js 原檔說明。 */");
    lines.push("");
    lines.push("const WORD_BANK = [");
    const flat = bankToFlat();
    flat.forEach((w, i) => {
      const comma = i === flat.length - 1 ? "" : ",";
      const def = w.def ? `, def: ${JSON.stringify(w.def)}` : "";
      lines.push(`  { lesson: "${w.lesson}", char: "${w.char}", zhuyin: "${w.zhuyin}"${def} }${comma}`);
    });
    lines.push("];");
    lines.push("");
    return lines.join("\n");
  }

  function exportData() {
    downloadTextFile("data.js", buildWordDataJS());
    $("save-msg").textContent = "📤 已下載 data.js！請用這個檔案取代 js/data.js，再發給學生。";
  }

  /* ---------- 匯出 data-content.js ---------- */
  function buildContentJS(lessonsOut) {
    const lines = [];
    lines.push("/* 文意測驗題庫由後台匯出，格式說明請看 js/data-content.js 原檔。 */");
    lines.push("");
    lines.push("const PASSAGE_BANK = [");
    lessonsOut.forEach((item, i) => {
      const comma = i === lessonsOut.length - 1 ? "" : ",";
      lines.push("  {");
      lines.push(`    lesson: ${JSON.stringify(item.lesson)},`);
      lines.push(`    title: ${JSON.stringify(item.title)},`);
      lines.push(`    passage: ${JSON.stringify(item.passage)},`);
      lines.push("    questions: [");
      item.questions.forEach((q, qi) => {
        const qcomma = qi === item.questions.length - 1 ? "" : ",";
        lines.push("      {");
        lines.push(`        type: ${q.type ? JSON.stringify(q.type) : "\"文意\""},`);
        lines.push(`        q: ${JSON.stringify(q.q)},`);
        lines.push(`        options: ${JSON.stringify(q.options)},`);
        lines.push(`        answer: ${q.answer}`);
        if (q.explain && q.explain.trim()) lines.push(`        ,explain: ${JSON.stringify(q.explain)}`);
        lines.push(`      }${qcomma}`);
      });
      lines.push("    ]");
      lines.push(`  }${comma}`);
    });
    lines.push("];");
    return lines.join("\n");
  }

  function exportContentData() {
    const item = currentContent();
    if (!item) {
      alert("請先新增課次並填好題目。");
      return;
    }
    const err = validateContent(item);
    if (err) {
      alert(`⚠️ ${err}`);
      return;
    }
    const lessonsOut = Object.keys(cBank)
      .map((name) => cBank[name])
      .filter((it) => !validateContent(it));

    downloadTextFile("data-content.js", buildContentJS(lessonsOut));
    $("save-msg").textContent = "📤 已下載 data-content.js！請用這個檔案取代 js/data-content.js，再發給學生。";
  }

  /* ---------- 匯出 data-idioms.js ---------- */
  function buildIdiomDataJS() {
    const lines = [];
    lines.push("/* 成語題庫由老師後台匯出，格式說明請看 js/data-idioms.js 原檔。 */");
    lines.push("");
    lines.push("const IDIOM_BANK = [");
    const flat = iBankToFlat();
    flat.forEach((it, i) => {
      const comma = i === flat.length - 1 ? "" : ",";
      const syn = it.synonym ? `, synonym: ${JSON.stringify(it.synonym)}` : "";
      const ant = it.antonym ? `, antonym: ${JSON.stringify(it.antonym)}` : "";
      lines.push(`  { lesson: "${it.lesson}", idiom: "${it.idiom}", bo: "${it.bo}", meaning: ${it.meaning ? JSON.stringify(it.meaning) : "\"\""}${syn}${ant} }${comma}`);
    });
    lines.push("];");
    return lines.join("\n");
  }

  function exportIdiomData() {
    const flat = iBankToFlat();
    if (flat.length === 0) { alert("成語題庫還是空的，請先到「成語練習」頁輸入。"); return; }
    downloadTextFile("data-idioms.js", buildIdiomDataJS());
    $("save-msg").textContent = "📤 已下載 data-idioms.js！請用這個檔案取代 js/data-idioms.js，再發給學生。";
  }

  /* ---------- 備份 / 匯入 / 清除本機暫存 ---------- */
  function backupExport() {
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const data = buildAllDataJSON();
    downloadTextFile(`題庫備份-${stamp}.json`, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
    $("restore-msg").textContent = "📤 已下載「題庫備份-日期.json」，裡面同時有國字注音＋文意＋成語三份題庫。";
  }

  function exportStudentData() {
    const data = buildAllDataJSON();
    downloadTextFile("學生題庫.json", JSON.stringify(data, null, 2), "application/json;charset=utf-8");
    $("save-msg").textContent = "📤 已下載「學生題庫.json」！把這份檔傳給學生，學生在國字注音／文意／成語任何一頁按「📂 匯入題庫檔」選這份檔，三種練習就一次全部載入。";
  }

  /* 執行檔案內文，取回 WORD_BANK / PASSAGE_BANK / IDIOM_BANK（data*.js 都適用）。
     重要：頁面本身也載入了 data.js / data-content.js / data-idioms.js，
     WORD_BANK 等名稱在全域已經存在。所以這裡先檢查「檔案內文真的有宣告哪一份」，
     沒宣告的一律傳 null，才不會把內建的同名變數誤當成檔案內容。 */
  function evalBankText(txt) {
    const declares = (name) => new RegExp("(?:const|let|var)\\s+" + name + "\\s*=").test(txt);
    const word = declares("WORD_BANK") ? "WORD_BANK" : "null";
    const passage = declares("PASSAGE_BANK") ? "PASSAGE_BANK" : "null";
    const idiom = declares("IDIOM_BANK") ? "IDIOM_BANK" : "null";
    const fn = new Function(
      txt + "\n;\nreturn { wordBank: " + word + ", passageBank: " + passage + ", idiomBank: " + idiom + " };"
    );
    return fn();
  }

  function restoreIdioms(arr) {
    iBank = groupIdiomsMap(Array.isArray(arr) ? arr : []);
    persistIBank();
    renderIdiomLessonSelect();
    $("idiom-edit").classList.add("hidden");
  }

  function restoreWords(arr) {
    bank = groupToMap(Array.isArray(arr) ? arr : []);
    persistWordBank();
    renderLessonSelect();
    renderBatchLessonSelect();
    $("word-edit").classList.add("hidden");
  }

  function restoreContent(arr) {
    const map = {};
    (Array.isArray(arr) ? arr : []).forEach((item) => {
      if (item && item.lesson) map[item.lesson] = item;
    });
    cBank = map;
    persistContentBank();
    renderContentLessonSelect();
  }

  function importDataFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const txt = String(reader.result).replace(/^\uFEFF/, "");
        const isJson = /\.json$/i.test(file.name);
        if (isJson) {
          const obj = JSON.parse(txt);
          if (!obj || (!obj.words && !obj.content && !obj.idioms)) throw new Error("這不是「題庫備份.json」的格式");
          restoreWords(obj.words || []);
          restoreContent(obj.content || []);
          restoreIdioms(obj.idioms || []);
        } else {
          const found = evalBankText(txt);
          const hasWord = found.wordBank !== null && found.wordBank !== undefined;
          const hasContent = found.passageBank !== null && found.passageBank !== undefined;
          const hasIdiom = found.idiomBank !== null && found.idiomBank !== undefined;
          if (!hasWord && !hasContent && !hasIdiom) throw new Error("找不到 WORD_BANK、PASSAGE_BANK 或 IDIOM_BANK");
          if (hasWord) restoreWords(found.wordBank);
          if (hasContent) restoreContent(found.passageBank);
          if (hasIdiom) restoreIdioms(found.idiomBank);
        }
        $("restore-msg").textContent = `✅ 已匯入「${file.name}」，並存進這台電腦。請再按「匯出」產生新的 data.js / data-content.js / data-idioms.js 給學生（或直接蓋回 js/ 資料夾）。`;
      } catch (e) {
        alert(`⚠️ 匯入失敗：${e.message}`);
        $("restore-msg").textContent = "";
      }
    };
    reader.onerror = () => alert("⚠️ 讀檔失敗，請再試一次。");
    reader.readAsText(file, "utf-8");
  }

  /* 把瀏覽器暫存清掉，讓整組網頁以 js/ 資料夾內的 data.js、data-content.js 為準 */
  function resetLocal() {
    if (!confirm("確定要清除「這台電腦瀏覽器暫存」的題庫嗎？\n\n之後 admin.html / zhuyin.html / content.html / idiom.html 都會改用 js/ 資料夾裡的 data.js、data-content.js 與 data-idioms.js。\n（資料夾裡的檔案不會被刪）")) return;
    try {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(CONTENT_STORE_KEY);
      localStorage.removeItem(IDIOM_STORE_KEY);
      localStorage.removeItem("exam_word_bank_saved");
      localStorage.removeItem("exam_passage_bank_saved");
      localStorage.removeItem("exam_idiom_bank_saved");
    } catch (e) { /* 忽略 */ }
    bank = loadBank();
    cBank = loadCBank();
    iBank = loadIBank();
    renderLessonSelect();
    renderBatchLessonSelect();
    renderContentLessonSelect();
    renderIdiomLessonSelect();
    $("save-msg").textContent = "🗑 已清除本機暫存，現在完全以資料夾內 data.js、data-content.js、data-idioms.js 的題庫為準。";
    $("restore-msg").textContent = "💡 若想讓資料暫時留在瀏覽器，再按一次「存到這台電腦」即可。";
  }

  /* ---------- 雲端同步（Cloudflare D1） ---------- */
  function cloudInitUI() {
    const tokenInput = $("cloud-token");
    if (!tokenInput || !window.ExamCloud) return; /* 頁面未含雲端支援 */
    tokenInput.value = window.ExamCloud.getToken() || "";

    $("cloud-push-btn").addEventListener("click", () => {
      const msg = $("cloud-msg");
      msg.textContent = "☁️ 同步中…";
      window.ExamCloud.setToken(tokenInput.value.trim());
      collectWordRows();
      collectIdiomRows();
      window.ExamCloud.pushAll(buildAllDataJSON())
        .then(() => { msg.textContent = "✅ 已把三份題庫同步到雲端！學生開練習頁會自動抓到最新題庫。"; })
        .catch((e) => { msg.textContent = "❌ 同步失敗：" + e.message; });
    });

    $("cloud-pull-btn").addEventListener("click", () => {
      const msg = $("cloud-msg");
      msg.textContent = "☁️ 讀取雲端中…";
      window.ExamCloud.fetchBanks()
        .then((data) => {
          if (!data) throw new Error("尚未設定 API 網址（js/app-config.js 的 apiBase）");
          restoreWords(data.words || []);
          restoreContent(data.content || []);
          restoreIdioms(data.idioms || []);
          msg.textContent = "✅ 已從雲端載入三份題庫，並存進這台電腦。";
        })
        .catch((e) => { msg.textContent = "❌ 載入失敗：" + e.message; });
    });
  }

  /* ---------- 事件綁定 ---------- */
  function bind() {
    $("login-btn").addEventListener("click", doLogin);
    $("login-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    $("add-lesson-btn").addEventListener("click", addLesson);
    $("lesson-name").addEventListener("keydown", (e) => { if (e.key === "Enter") addLesson(); });
    $("lesson-select").addEventListener("change", renderWordRows);
    $("delete-lesson-btn").addEventListener("click", deleteLesson);
    $("add-word-btn").addEventListener("click", addWordRow);
    $("save-lesson-btn").addEventListener("click", saveLesson);
    $("fill-defs-btn").addEventListener("click", fillDefsOnline);
    $("fill-defs-ai-btn").addEventListener("click", fillDefsAI);
    $("save-local-btn").addEventListener("click", saveAllLocal);
    $("export-student-btn").addEventListener("click", exportStudentData);
    $("backup-btn").addEventListener("click", backupExport);
    $("reset-local-btn").addEventListener("click", resetLocal);
    $("import-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importDataFile(f);
      e.target.value = "";
    });
    $("export-btn").addEventListener("click", exportData);
    $("export-content-btn").addEventListener("click", exportContentData);
    $("export-idiom-btn").addEventListener("click", exportIdiomData);

    $("add-idiom-lesson-btn").addEventListener("click", addIdiomLesson);
    $("idiom-lesson-name").addEventListener("keydown", (e) => { if (e.key === "Enter") addIdiomLesson(); });
    $("idiom-lesson-select").addEventListener("change", renderIdiomRows);
    $("delete-idiom-lesson-btn").addEventListener("click", deleteIdiomLesson);
    $("add-idiom-btn").addEventListener("click", addIdiomRow);
    $("save-idiom-lesson-btn").addEventListener("click", saveIdiomLesson);
    $("fill-idioms-local-btn").addEventListener("click", fillIdiomsLocal);
    $("fill-idioms-ai-btn").addEventListener("click", fillIdiomsAI);
    $("suggest-idioms-btn").addEventListener("click", suggestIdiomsAI);
    $("idiom-batch-run-btn").addEventListener("click", runIdiomBatch);
    $("idiom-batch-add-btn").addEventListener("click", addIdiomBatchToLesson);
    $("idiom-batch-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runIdiomBatch();
    });

    $("add-content-lesson-btn").addEventListener("click", addContentLesson);
    $("content-lesson-name").addEventListener("keydown", (e) => { if (e.key === "Enter") addContentLesson(); });
    $("content-lesson-select").addEventListener("change", renderContentForm);
    $("delete-content-lesson-btn").addEventListener("click", deleteContentLesson);
    $("add-content-question-btn").addEventListener("click", addContentQuestion);
    $("save-content-btn").addEventListener("click", saveContent);
    $("content-title").addEventListener("input", () => {
      const it = currentContent();
      if (it) it.title = $("content-title").value;
    });
    $("content-passage").addEventListener("input", () => {
      const it = currentContent();
      if (it) it.passage = $("content-passage").value;
    });
    $("ai-save-btn").addEventListener("click", saveAI);
    $("ai-test-btn").addEventListener("click", testAI);
    $("ai-provider").addEventListener("change", onAIProviderChange);
    $("gen-btn").addEventListener("click", autoGenerateQuestions);

    document.querySelectorAll(".tabbar .chip").forEach((chip) => {
      chip.addEventListener("click", () => switchTab(chip.dataset.tab));
    });
    $("batch-run-btn").addEventListener("click", () => {
      const raw = $("batch-text").value;
      const texts = [...new Set(raw.split(/[\s、，,；;]+/).map((s) => s.trim()).filter((s) => s.length >= 1))];
      batchRows = texts.map((t) => ({ char: t, zhuyin: "", from: "none" }));
      runBatch();
    });
    $("batch-add-btn").addEventListener("click", addBatchToBank);
  }

  document.addEventListener("DOMContentLoaded", () => {
    bank = loadBank();
    cBank = loadCBank();
    iBank = loadIBank();
    bind();
    cloudInitUI();
    checkLogin();
  });
})();