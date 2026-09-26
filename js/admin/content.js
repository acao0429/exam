/* ============================================================
   老師後台 分頁：📖 文意測驗（js/admin/content.js）
   ------------------------------------------------------------
   課文（標題＋內文）與題目（題目＋四個選項＋答案）的編輯、檢查與儲存。
   自動出題在 ai-generate.js，AI 金鑰在 ai-settings.js。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;
  const S = A.state;

  function currentContent() {
    const sel = $("content-lesson-select");
    return sel.value ? S.cBank[sel.value] : null;
  }

  function blankQuestion() {
    return { type: "文意", q: "", options: ["", "", "", ""], answer: 0 };
  }

  function renderContentLessonSelect() {
    const sel = $("content-lesson-select");
    sel.innerHTML = "";
    const lessons = Object.keys(S.cBank);
    if (lessons.length === 0) {
      sel.innerHTML = "<option value=''>（尚無課次，請先新增）</option>";
      $("content-edit").classList.add("hidden");
      return;
    }
    lessons.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      const item = S.cBank[name];
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
    if (S.cBank[name]) {
      alert("這個課次已經存在了！");
      return;
    }
    S.cBank[name] = { lesson: name, title: "", passage: "", questions: [blankQuestion()] };
    $("content-lesson-name").value = "";
    renderContentLessonSelect();
    A.store.quiet(A.store.persistContentBank());
  }

  function deleteContentLesson() {
    const sel = $("content-lesson-select");
    const lesson = sel.value;
    if (!lesson || !S.cBank[lesson]) {
      alert("目前沒有課次可以刪除。");
      return;
    }
    const n = Array.isArray(S.cBank[lesson].questions) ? S.cBank[lesson].questions.length : 0;
    const ok = confirm(`確定要刪除「${lesson}」嗎？\n（共有 ${n} 題，刪掉就不能救回來囉！）`);
    if (!ok) return;
    delete S.cBank[lesson];
    renderContentLessonSelect();
    A.store.quiet(A.store.persistContentBank());
    $("save-msg").textContent = `🗑 已刪除「${lesson}」並存進瀏覽器；若要給其他電腦用，別忘了按「📤 匯出給學生」取得含全部題庫的檔。`;
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
    A.store.persistContentBank().then(() => {
      renderContentLessonSelect();
      $("save-msg").textContent = "✅ 文意題庫已儲存到 D1，學生端下次就讀得到。";
    }).catch((e) => {
      $("save-msg").textContent = "⚠️ 儲存失敗：" + e.message;
    });
  }

  A.content = {
    currentContent,
    blankQuestion,
    renderContentLessonSelect,
    addContentLesson,
    deleteContentLesson,
    renderContentForm,
    renderQuestionEditors,
    buildQuestionBlock,
    addContentQuestion,
    validateContent,
    saveContent
  };

})();
