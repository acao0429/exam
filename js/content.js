/* ============================================================
   文意內容 練習邏輯
   閱讀題組：先讀課文，再逐題作答，答錯會顯示正確答案和解釋。
   ============================================================ */

(function () {
  "use strict";

  /* 題庫：唯一來源是 D1（透過 js/cloud.js 的 ExamCloud.getBank） */
  let BANK = [];

  function getBank() { return BANK; }
  async function loadBank() {
    if (!window.ExamCloud || !window.ExamCloud.enabled()) return;
    try {
      BANK = await window.ExamCloud.getBank("content");
    } catch (e) {
      BANK = [];
      if (window.console) console.error("題庫載入失敗：", e.message);
    }
  }

  const LETTERS = ["A", "B", "C", "D"];

  let selectedLessons = new Set();
  let hidePassage = false;   // 作答時是否隱藏課文
  let passageVisible = true; // 目前課文是否顯示
  let questionQuota = 10;    // 每次做幾題（10 / 15 / "all"）
  let questions = [];
  let currentIndex = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let wrongItems = [];
  let currentQuestion = null; // { bank, q }
  let answered = false;

  const $ = (id) => document.getElementById(id);

  /* ---------- 初始化 ---------- */
  function init() {
    buildLessonChips();
    initViewChips();
    initCountChips();
    $("start-btn").addEventListener("click", startQuiz);
    $("next-btn").addEventListener("click", nextQuestion);
    $("finish-btn").addEventListener("click", showResult);
    $("passage-toggle").addEventListener("click", togglePassage);
  }

  function buildLessonChips() {
    const container = $("lesson-chips");
    container.innerHTML = "";
    const lessons = [...new Set(getBank().map((w) => w.lesson))];
    if (lessons.length === 0) {
      container.innerHTML = "<p class='hint'>題庫還是空的喔！請老師先到後台輸入課文和題目。</p>";
      return;
    }
    lessons.forEach((lesson) => {
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.textContent = lesson;
      btn.dataset.lesson = lesson;
      btn.addEventListener("click", () => toggleLesson(btn, lesson));
      container.appendChild(btn);
    });
  }

  function toggleLesson(btn, lesson) {
    if (selectedLessons.has(lesson)) {
      selectedLessons.delete(lesson);
      btn.classList.remove("selected");
    } else {
      selectedLessons.add(lesson);
      btn.classList.add("selected");
    }
  }

  function initViewChips() {
    const btns = document.querySelectorAll("#view-chips .chip");
    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        btns.forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        hidePassage = btn.dataset.view === "hide";
      });
    });
  }

  function initCountChips() {
    const btns = document.querySelectorAll("#count-chips .chip");
    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        btns.forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        const v = btn.dataset.count;
        questionQuota = v === "all" ? "all" : parseInt(v, 10);
      });
    });
  }

  /* ---------- 出題 ---------- */
  function buildQuestions() {
    questions = [];
    getBank().forEach((item) => {
      if (!selectedLessons.has(item.lesson)) return;
      const qs = Array.isArray(item.questions) ? item.questions : [];
      qs.forEach((q) => questions.push({ bank: item, q }));
    });
    shuffle(questions);
    if (questionQuota !== "all" && questions.length > questionQuota) {
      questions = questions.slice(0, questionQuota);
    }
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /* ---------- 開始 / 下一題 ---------- */
  function startQuiz() {
    if (selectedLessons.size === 0) {
      alert("請先點選要練習的課次喔！");
      return;
    }
    buildQuestions();
    if (questions.length === 0) {
      alert("這個課次還沒有題目，請老師先在後台輸入課文和題目。");
      return;
    }
    correctCount = 0;
    wrongCount = 0;
    wrongItems = [];
    currentIndex = 0;
    passageVisible = !hidePassage;
    $("setup-screen").classList.add("hidden");
    $("result-screen").classList.add("hidden");
    $("quiz-screen").classList.remove("hidden");
    renderQuestion();
  }

  function nextQuestion() {
    $("feedback-area").classList.add("hidden");
    $("next-btn").classList.add("hidden");
    $("finish-btn").classList.add("hidden");
    currentIndex++;
    renderQuestion();
  }

  /* ---------- 課文顯示 / 隱藏 ---------- */
  function updatePassageBox() {
    const box = $("passage-box");
    const btn = $("passage-toggle");
    if (passageVisible) {
      box.classList.remove("hidden");
      btn.textContent = "🙈 藏起來，再想想";
    } else {
      box.classList.add("hidden");
      btn.textContent = "📖 顯示課文";
    }
  }

  function togglePassage() {
    passageVisible = !passageVisible;
    updatePassageBox();
  }

  /* ---------- 渲染題目 ---------- */
  function renderQuestion() {
    if (currentIndex >= questions.length) {
      showResult();
      return;
    }
    currentQuestion = questions[currentIndex];
    answered = false;

    const item = currentQuestion.bank;
    $("quiz-lesson").textContent = `📖 ${item.lesson} ・ ${item.title}`;
    $("passage-text").textContent = item.passage;
    updatePassageBox();

    updateProgress();
    updateScore();
    renderQuestionArea();
  }

  function renderQuestionArea() {
    const area = $("question-area");
    area.innerHTML = "";

    const q = currentQuestion.q;
    if (!Array.isArray(q.options) || q.options.length < 4) {
      area.innerHTML = "<p class='hint'>這一題的選項好像不完整，請老師檢查一下。</p>";
      return;
    }

    const tag = document.createElement("div");
    tag.className = "type-tag";
    tag.textContent = typeLabel(q.type);

    const text = document.createElement("div");
    text.className = "question-text";
    text.textContent = q.q;

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "options-col";
    q.options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.className = "option-text";
      const letter = document.createElement("span");
      letter.className = "opt-letter";
      letter.textContent = `${LETTERS[i]}．`;
      b.appendChild(letter);
      b.appendChild(document.createTextNode(opt));
      b.addEventListener("click", () => answer(i));
      optionsWrap.appendChild(b);
    });

    area.appendChild(tag);
    area.appendChild(text);
    area.appendChild(optionsWrap);
  }

  function typeLabel(t) {
    const map = { "主旨": "📌 主旨", "文意": "💡 文意", "細節": "🔍 細節", "詞句": "🔤 詞句" };
    return map[t] || "💡 文意";
  }

  function updateProgress() {
    $("progress-text").textContent = `第 ${currentIndex + 1} / ${questions.length} 題`;
    $("progress-fill").style.width = `${((currentIndex) / questions.length) * 100}%`;
  }

  function updateScore() {
    $("correct-count").textContent = `✅ 對：${correctCount}`;
    $("wrong-count").textContent = `❌ 錯：${wrongCount}`;
  }

  /* ---------- 作答判斷 ---------- */
  function answer(idx) {
    if (answered) return;
    answered = true;

    const q = currentQuestion.q;
    const correctIndex = parseInt(q.answer, 10);
    const optionBtns = document.querySelectorAll(".option-text");
    const isCorrect = idx === correctIndex;

    optionBtns.forEach((btn, i) => {
      btn.disabled = true;
      if (i === correctIndex) btn.classList.add("correct-show");
    });
    if (!isCorrect) {
      optionBtns[idx].classList.add("selected-wrong");
    } else {
      optionBtns[idx].classList.add("selected-correct");
    }

    const box = $("feedback-box");
    if (isCorrect) {
      correctCount++;
      box.className = "feedback ok";
      box.innerHTML = "🎉 答對了！你真會讀文章！";
    } else {
      wrongCount++;
      wrongItems.push({
        lesson: currentQuestion.bank.lesson,
        title: currentQuestion.bank.title,
        q: q.q,
        correct: `${LETTERS[correctIndex]}．${q.options[correctIndex]}`,
        explain: q.explain || ""
      });
      box.className = "feedback no";
      box.innerHTML = `💡 正確答案是「<b>${LETTERS[correctIndex]}．${q.options[correctIndex]}</b>」` +
        (q.explain ? `<br><span class="explain-line">💬 ${q.explain}</span>` : "");
    }

    $("feedback-area").classList.remove("hidden");
    const isLast = currentIndex === questions.length - 1;
    $("next-btn").classList.toggle("hidden", isLast);
    $("finish-btn").classList.toggle("hidden", !isLast);
    updateScore();
  }

  /* ---------- 結算 ---------- */
  function showResult() {
    $("quiz-screen").classList.add("hidden");
    $("result-screen").classList.remove("hidden");

    const total = questions.length;
    const ratio = correctCount / total;

    let anim, title, stars;
    if (ratio === 1) {
      anim = "🏆"; title = "太厲害了，全部讀懂！"; stars = buildStars(5);
    } else if (ratio >= 0.8) {
      anim = "🎉"; title = "好棒，差一點就全對！"; stars = buildStars(4);
    } else if (ratio >= 0.6) {
      anim = "😊"; title = "不錯喔，再讀一遍課文！"; stars = buildStars(3);
    } else if (ratio >= 0.4) {
      anim = "💪"; title = "還不太懂，多練習幾次！"; stars = buildStars(2);
    } else {
      anim = "🌱"; title = "沒關係，慢慢讀會進步！"; stars = buildStars(1);
    }

    $("result-anim").textContent = anim;
    $("result-title").textContent = title;
    $("stars-row").textContent = stars;
    $("result-score").textContent = `答對 ${correctCount} 題，共 ${total} 題`;

    if (wrongItems.length > 0) {
      const ul = $("wrong-list-items");
      ul.innerHTML = "";
      wrongItems.forEach((w) => {
        const li = document.createElement("li");
        li.innerHTML =
          `<div class="wrong-q">${w.lesson} ・ ${w.q}</div>
           <div class="spelling">✅ 正確答案：${w.correct}</div>` +
          (w.explain ? `<div class="spelling">💬 ${w.explain}</div>` : "");
        ul.appendChild(li);
      });
      $("wrong-list").classList.remove("hidden");
    } else {
      $("wrong-list").classList.add("hidden");
    }
  }

  function buildStars(n) {
    return "⭐".repeat(n);
  }

  /* ---------- 其他 ---------- */
  function resetQuiz() {
    correctCount = 0;
    wrongCount = 0;
    wrongItems = [];
    currentIndex = 0;
    $("feedback-area").classList.add("hidden");
    $("next-btn").classList.add("hidden");
    $("finish-btn").classList.add("hidden");
    buildQuestions();
    $("result-screen").classList.add("hidden");
    $("quiz-screen").classList.remove("hidden");
    renderQuestion();
  }

  function backToSetup() {
    $("quiz-screen").classList.add("hidden");
    $("result-screen").classList.add("hidden");
    $("setup-screen").classList.remove("hidden");
  }

  window.resetQuiz = resetQuiz;

  /* ---------- 作答上雲（首頁已處理登入） ---------- */
  function initAttemptUpload() {
    if (window.ExamCloud && window.ExamCloud.studentLoggedIn()) {
      syncWrongBook();
    }
  }
  async function syncWrongBook() {
    if (!window.ExamCloud || !window.ExamCloud.studentLoggedIn()) return;
    try { wrongItems = await window.ExamCloud.mergeWrongCloud(wrongItems); } catch (e) { console.warn("錯題本同步失敗：", e.message); }
  }
  async function uploadAttempt(item) {
    if (!window.ExamCloud || !window.ExamCloud.studentLoggedIn()) return;
    try { await window.ExamCloud.pushAttempt(item); } catch (e) { console.warn("作答上傳失敗：", e.message); }
  }
  window.backToSetup = backToSetup;

  function boot() {
    if (window.ExamCloud && window.ExamCloud.enabled()) {
      /* 題庫唯一來源是 D1：先讀回來，再畫面。讀不到就當作沒有題目。 */
      loadBank().then(() => {
        initAttemptUpload();
        if (window.ExamCloud) window.ExamCloud.renderStudentBar();
        init();
      });
    } else {
      if (window.ExamCloud) window.ExamCloud.renderStudentBar();
      initAttemptUpload(); init();
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();