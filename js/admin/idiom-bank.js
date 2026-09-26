/* ============================================================
   老師後台 分頁：🎯 成語練習 — 題庫管理（js/admin/idiom-bank.js）
   ------------------------------------------------------------
   成語課次與成語表格的新增、刪除、編輯、補齊（內建庫／AI）與儲存。
   「批次貼上成語」在 idiom-batch.js。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;
  const S = A.state;

  function idiomLessonNames() { return Object.keys(S.iBank); }

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
      opt.textContent = `${name}（${S.iBank[name].length} 筆）`;
      sel.appendChild(opt);
    });
    sel.value = lessons[0];
    renderIdiomRows();
  }

  function currentIdiomLesson() {
    const sel = $("idiom-lesson-select");
    return sel.value ? S.iBank[sel.value] : null;
  }

  function addIdiomLesson() {
    const name = $("idiom-lesson-name").value.trim();
    if (!name) { $("idiom-lesson-name").focus(); return; }
    if (S.iBank[name]) { alert("這個課次已經存在了！"); return; }
    S.iBank[name] = [blankIdiomRow()];
    $("idiom-lesson-name").value = "";
    renderIdiomLessonSelect();
    A.store.persistIBank();
  }

  function deleteIdiomLesson() {
    const sel = $("idiom-lesson-select");
    const lesson = sel.value;
    if (!lesson || !S.iBank[lesson]) { alert("目前沒有課次可以刪除。"); return; }
    const count = S.iBank[lesson].length;
    const ok = confirm(`確定要刪除「${lesson}」嗎？\n（共有 ${count} 筆，刪掉就不能救回來囉！）`);
    if (!ok) return;
    delete S.iBank[lesson];
    renderIdiomLessonSelect();
    A.store.persistIBank();
    $("save-msg").textContent = `🗑 已刪除「${lesson}」並存進瀏覽器；若要給其他電腦用，別忘了按「📤 匯出給學生」取得含全部題庫的檔。`;
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
        const lessonName = $("idiom-lesson-select").value;
        S.iBank[lessonName].splice(idx, 1);
        if (S.iBank[lessonName].length === 0) S.iBank[lessonName].push(blankIdiomRow());
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
    S.iBank[lesson] = [];
    rows.forEach((tr) => {
      const inputs = tr.querySelectorAll("input, textarea");
      const idiom = inputs[0].value.trim();
      const bo = inputs[1].value.trim();
      if (!idiom) return;
      S.iBank[lesson].push({
        idiom,
        bo,
        meaning: inputs[2].value.trim(),
        synonym: inputs[3].value.trim(),
        antonym: inputs[4].value.trim()
      });
    });
    if (S.iBank[lesson].length === 0) S.iBank[lesson].push(blankIdiomRow());
  }

  function saveIdiomLesson() {
    collectIdiomRows();
    if (A.store.persistIBank()) {
      renderIdiomLessonSelect();
      $("save-msg").textContent = "✅ 成語題庫已儲存！要給學生，按「📤 匯出給學生」取得包含成語的題庫檔。";
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
    const cfg = A.ai.loadAI();
    if (!A.ai.cfgHasKey(cfg)) { alert("還沒有 AI 金鑰：到「📖 文意測驗」頁的「✨ AI 自動出題」區選一家提供者貼上金鑰，按「存金鑰」即可。"); return; }
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
    const cfg = A.ai.loadAI();
    if (!A.ai.cfgHasKey(cfg)) { alert("還沒有 AI 金鑰：到「📖 文意測驗」頁的「✨ AI 自動出題」區貼上金鑰並按「存金鑰」。"); return; }
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

  A.idiom = {
    idiomLessonNames,
    renderIdiomLessonSelect,
    currentIdiomLesson,
    addIdiomLesson,
    deleteIdiomLesson,
    blankIdiomRow,
    renderIdiomRows,
    addIdiomRow,
    collectIdiomRows,
    saveIdiomLesson,
    fillIdiomsLocal,
    fillIdiomsAI,
    suggestIdiomsAI
  };

})();
