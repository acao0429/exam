/* ============================================================
   老師後台 分頁：✏️ 逐字輸入（js/admin/words.js）
   ------------------------------------------------------------
   國字注音題庫的新增、刪除、編輯表格，以及「批次補詞義」。
   儲存動作統一走 A.store 的函式。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;
  const S = A.state;

  /* ---------- 課次管理 ---------- */
  function lessonNames() { return Object.keys(S.bank); }

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
      opt.textContent = `${name}（${S.bank[name].length} 筆）`;
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
    if (S.bank[name]) {
      alert("這個課次已經存在了！");
      return;
    }
    S.bank[name] = [{ char: "", zhuyin: "" }];
    $("lesson-name").value = "";
    renderLessonSelect();
    renderBatchLessonSelect();
    A.store.persistWordBank();
  }

  function currentLesson() {
    const sel = $("lesson-select");
    return sel.value ? S.bank[sel.value] : null;
  }

  function deleteLesson() {
    const sel = $("lesson-select");
    const lesson = sel.value;
    if (!lesson || !S.bank[lesson]) {
      alert("目前沒有課次可以刪除。");
      return;
    }
    const count = S.bank[lesson].length;
    const ok = confirm(`確定要刪除「${lesson}」嗎？\n（共有 ${count} 筆，刪掉就不能救回來囉！）`);
    if (!ok) return;
    delete S.bank[lesson];
    renderLessonSelect();
    renderBatchLessonSelect();
    A.store.persistWordBank();
    $("save-msg").textContent = `🗑 已刪除「${lesson}」並存進瀏覽器；若要給其他電腦用，別忘了按「📤 匯出給學生」取得含全部題庫的檔。`;
  }

  /* ---------- 生字表格 ---------- */
  function selValue() { return $("lesson-select").value; }

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
        S.bank[selValue()].splice(idx, 1);
        if (S.bank[selValue()].length === 0) S.bank[selValue()].push({ char: "", zhuyin: "", def: "" });
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
    S.bank[lesson] = [];
    rows.forEach((tr) => {
      const inputs = tr.querySelectorAll("input, textarea");
      const char = inputs[0].value.trim();
      const zhuyin = inputs[1].value.trim();
      const def = inputs[2].value.trim();
      if (char && zhuyin) S.bank[lesson].push({ char, zhuyin, def });
    });
    if (S.bank[lesson].length === 0) S.bank[lesson].push({ char: "", zhuyin: "", def: "" });
  }

  function saveLesson() {
    collectWordRows();
    if (A.store.persistWordBank()) {
      renderLessonSelect();
      renderBatchLessonSelect();
      $("save-msg").textContent = "✅ 已儲存！要給學生，按「📤 匯出給學生」取得包含國字注音的題庫檔。";
    } else {
      $("save-msg").textContent = "⚠️ 儲存失敗。";
    }
  }

  /* ---------- 批次補詞義 ---------- */

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
    const resp = await A.net.fetchWithTimeout(url, 8000);
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
    const cfg = A.ai.loadAI();
    if (!A.ai.cfgHasKey(cfg)) { alert("還沒有 AI 金鑰：到「✨ AI 自動出題」區選一家提供者貼上金鑰，按「存金鑰」即可（金鑰存雲端）。"); return; }
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

  A.words = {
    lessonNames,
    renderLessonSelect,
    renderBatchLessonSelect,
    addLesson,
    currentLesson,
    deleteLesson,
    selValue,
    renderWordRows,
    addWordRow,
    collectWordRows,
    saveLesson,
    extractDef,
    lookupDefOnline,
    fillDefsOnline,
    fillDefsAI
  };

})();
