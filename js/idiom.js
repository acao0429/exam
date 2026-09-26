/* ============================================================
   成語練習 邏輯
   四種玩法：
   1. idiom2mean ：看成語 → 選出正確的意思
   2. mean2idiom ：看意思 → 選出正確的成語
   3. missing    ：缺字填空（看成語少了一個字 → 選出正確的字）
   4. relation   ：近義反義（看成語 → 選出意思相近或相反的成語）
   ============================================================ */

(function () {
  "use strict";

  /* 題庫：唯一來源是 D1（透過 js/cloud.js 的 ExamCloud.getBank） */
  let BANK = [];

  function getBank() { return BANK; }
  async function loadBank() {
    if (!window.ExamCloud || !window.ExamCloud.enabled()) return;
    try {
      BANK = await window.ExamCloud.getBank("idioms");
    } catch (e) {
      BANK = [];
      if (window.console) console.error("題庫載入失敗：", e.message);
    }
  }

  let selectedLessons = new Set();
  let selectedModes = new Set();
  let questions = [];
  let currentIndex = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let wrongItems = [];
  let currentQuestion = null;
  let answered = false;

  const $ = (id) => document.getElementById(id);

  /* ---------- 初始化 ---------- */
  function init() {
    buildLessonChips();
    initModeChips();
    $("start-btn").addEventListener("click", startQuiz);
    $("next-btn").addEventListener("click", nextQuestion);
    $("finish-btn").addEventListener("click", showResult);
  }

  function buildLessonChips() {
    const container = $("lesson-chips");
    container.innerHTML = "";
    const lessons = [...new Set(getBank().map((w) => w.lesson))];
    if (lessons.length === 0) {
      container.innerHTML = "<p class='hint'>題庫還是空的喔！請先到 js/data-idioms.js 填入成語。</p>";
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

  function initModeChips() {
    const modeBtns = document.querySelectorAll("#mode-chips .chip");
    modeBtns.forEach((btn) => {
      btn.classList.remove("selected");
      btn.addEventListener("click", () => toggleMode(btn, btn.dataset.mode));
    });
  }

  function toggleMode(btn, mode) {
    if (selectedModes.has(mode)) {
      selectedModes.delete(mode);
      btn.classList.remove("selected");
    } else {
      selectedModes.add(mode);
      btn.classList.add("selected");
    }
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /* ---------- 出題 ---------- */
  function buildQuestions() {
    const pool = getBank().filter((w) => selectedLessons.has(w.lesson));
    const modeArray = [...selectedModes].length > 0 ? [...selectedModes] : ["idiom2mean"];
    questions = [];
    pool.forEach((e) => {
      modeArray.forEach((mode) => {
        if (mode === "idiom2mean" || mode === "mean2idiom") {
          questions.push({ e, mode });
        } else if (mode === "missing") {
          if (e.idiom.length >= 2) {
            questions.push({ e, mode, pos: Math.floor(Math.random() * e.idiom.length) });
          }
        } else if (mode === "relation") {
          if (e.synonym || e.antonym) {
            questions.push({ e, mode, rel: e.synonym ? "近義" : "反義", correct: e.synonym || e.antonym });
          }
        }
      });
    });
    shuffle(questions);
  }

  /* 挑干擾選項；直接回傳不足 4 個就用幾個（出題時再判斷夠不夠） */
  function pickDistractors(current, pool, field) {
    const distractors = pool
      .filter((w) => w !== current && w[field] && w[field] !== current[field])
      .map((w) => w[field]);
    const unique = [...new Set(distractors)];
    shuffle(unique);
    return unique;
  }

  /* 缺字填空：從其他成語的字集裡挑 3 個，不會洩漏答案 */
  function pickCharDistractors(current, pool, correctChar) {
    const chars = [];
    pool.forEach((w) => {
      if (w === current) return;
      [...new Set([...w.idiom])].forEach((c) => {
        if (c !== correctChar) chars.push(c);
      });
    });
    const unique = [...new Set(chars)];
    shuffle(unique);
    return unique.slice(0, 3);
  }

  /* 近義反義：用其他成語的成語名/近義/反義當干擾 */
  function pickRelDistractors(current, pool, correct) {
    const cands = [];
    pool.forEach((w) => {
      if (w === current) return;
      [w.idiom, w.synonym, w.antonym].forEach((s) => {
        if (s && s !== correct) cands.push(s);
      });
    });
    const unique = [...new Set(cands)];
    shuffle(unique);
    return unique;
  }

  /* ---------- 開始 / 下一題 ---------- */
  function startQuiz() {
    if (selectedLessons.size === 0) {
      alert("請先點選要練習的課次喔！");
      return;
    }
    buildQuestions();
    if (questions.length === 0) {
      const pool = getBank().filter((w) => selectedLessons.has(w.lesson));
      if ([...selectedModes].length === 0 || ([...selectedModes].includes("relation") && !pool.some((e) => e.synonym || e.antonym))) {
        alert("你選的玩法需要「近義/反義」資料，但這些課次的成語還沒有填。請老師到後台按「🔍 批次查釋義」或「🤖 AI 補齊」。");
      } else {
        alert("這個課次還沒有成語，請老師先在後台輸入。");
      }
      return;
    }
    correctCount = 0;
    wrongCount = 0;
    wrongItems = [];
    currentIndex = 0;
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

  /* ---------- 渲染題目 ---------- */
  function renderQuestion() {
    if (currentIndex >= questions.length) {
      showResult();
      return;
    }
    currentQuestion = questions[currentIndex];
    answered = false;

    const pool = getBank().filter((w) => selectedLessons.has(w.lesson));
    const q = currentQuestion;
    const area = $("question-area");
    area.innerHTML = "";

    updateProgress();
    updateScore();

    if (q.mode === "idiom2mean") {
      const display = document.createElement("div");
      display.className = "big-display";
      display.textContent = q.e.idiom;
      area.appendChild(display);
      const bo = document.createElement("div");
      bo.className = "bo-line";
      bo.textContent = q.e.bo || "";
      area.appendChild(bo);
      const prompt = document.createElement("div");
      prompt.className = "question-text";
      prompt.textContent = "「" + q.e.idiom + "」的意思，是下面哪一個？";
      area.appendChild(prompt);
      const options = pickDistractors(q.e, pool, "meaning").filter((m) => m);
      buildOptions(area, options, q.e.meaning);
    } else if (q.mode === "mean2idiom") {
      const display = document.createElement("div");
      display.className = "big-display display-def";
      display.textContent = q.e.meaning;
      area.appendChild(display);
      const prompt = document.createElement("div");
      prompt.className = "question-text";
      prompt.textContent = "這個意思，是哪一個成語？";
      area.appendChild(prompt);
      const options = pickDistractors(q.e, pool, "idiom").filter((m) => m);
      buildOptions(area, options, q.e.idiom);
    } else if (q.mode === "missing") {
      const display = document.createElement("div");
      display.className = "big-display";
      buildMissingDisplay(display, q.e.idiom, q.pos);
      area.appendChild(display);
      const prompt = document.createElement("div");
      prompt.className = "question-text";
      prompt.textContent = "「」裡少了哪一個字？";
      area.appendChild(prompt);
      const correctChar = q.e.idiom[q.pos];
      const options = pickCharDistractors(q.e, pool, correctChar);
      buildOptions(area, options, correctChar);
    } else if (q.mode === "relation") {
      const display = document.createElement("div");
      display.className = "big-display";
      display.textContent = q.e.idiom;
      area.appendChild(display);
      const bo = document.createElement("div");
      bo.className = "bo-line";
      bo.textContent = q.e.bo || "";
      area.appendChild(bo);
      const prompt = document.createElement("div");
      prompt.className = "question-text";
      prompt.textContent = "「" + q.e.idiom + "」的" + (q.rel === "近義" ? "近義" : "反義") + "成語是哪一個？";
      area.appendChild(prompt);
      const options = pickRelDistractors(q.e, pool, q.correct);
      buildOptions(area, options, q.correct);
    }
  }

  function buildMissingDisplay(display, idiom, pos) {
    [...idiom].forEach((c, i) => {
      const span = document.createElement("span");
      if (i === pos) {
        span.className = "missing-blank";
        span.textContent = "＿";
        span.setAttribute("aria-label", "空格");
      } else {
        span.textContent = c;
      }
      display.appendChild(span);
    });
  }

  function buildOptions(area, options, correct) {
    const opts = options.concat(correct);
    const unique = [...new Set(opts)];
    if (unique.length < 2) {
      area.innerHTML += "<p class='hint'>這一課還沒有足夠的成語可以出題，請老師再多加幾筆。</p>";
      return;
    }
    shuffle(unique);
    const optionsWrap = document.createElement("div");
    optionsWrap.className = "options";
    unique.forEach((opt) => {
      const b = document.createElement("button");
      b.className = "option" + (opt.length > 8 ? " option-sm" : "");
      b.textContent = opt;
      b.addEventListener("click", () => answer(b, opt));
      optionsWrap.appendChild(b);
    });
    area.appendChild(optionsWrap);
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
  function answer(btn, chosen) {
    if (answered) return;
    answered = true;

    const q = currentQuestion;
    const optionBtns = document.querySelectorAll(".option");
    let correctText;
    if (q.mode === "idiom2mean") correctText = q.e.meaning;
    else if (q.mode === "mean2idiom") correctText = q.e.idiom;
    else if (q.mode === "missing") correctText = q.e.idiom[q.pos];
    else correctText = q.correct;
    const isCorrect = chosen === correctText;

    optionBtns.forEach((btn2) => {
      btn2.disabled = true;
      if (btn2.textContent === correctText) btn2.classList.add("correct-show");
    });
    if (!isCorrect) {
      btn.classList.add("selected-wrong");
    } else {
      btn.classList.add("selected-correct");
    }

    const box = $("feedback-box");
    if (isCorrect) {
      correctCount++;
      box.className = "feedback ok";
      box.innerHTML = "🎉 好棒！答對了！";
    } else {
      wrongCount++;
      wrongItems.push({ idiom: q.e.idiom, bo: q.e.bo, meaning: q.e.meaning });
      box.className = "feedback no";
      let review = `<b>${q.e.idiom}</b>（${q.e.bo}）＝ ${q.e.meaning}`;
      if (q.mode === "relation") {
        review = `<b>${q.e.idiom}</b>（${q.e.bo}）＝ ${q.e.meaning}<br>${q.rel}成語：${correctText}`;
      }
      box.innerHTML = `💪 沒關係！再複習一次：${review}`;
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
      anim = "🏆"; title = "太厲害了，全部答對！"; stars = buildStars(5);
    } else if (ratio >= 0.8) {
      anim = "🎉"; title = "好棒，只差一點點！"; stars = buildStars(4);
    } else if (ratio >= 0.6) {
      anim = "😊"; title = "不錯喔，再加油！"; stars = buildStars(3);
    } else if (ratio >= 0.4) {
      anim = "💪"; title = "還不熟練，多練幾次！"; stars = buildStars(2);
    } else {
      anim = "🌱"; title = "沒關係，慢慢來會進步！"; stars = buildStars(1);
    }

    $("result-anim").textContent = anim;
    $("result-title").textContent = title;
    $("stars-row").textContent = stars;
    $("result-score").textContent = `答對 ${correctCount} 題，共 ${total} 題`;

    if (wrongItems.length > 0) {
      const seen = new Set();
      const ul = $("wrong-list-items");
      ul.innerHTML = "";
      wrongItems.forEach((w) => {
        if (seen.has(w.idiom)) return;
        seen.add(w.idiom);
        const li = document.createElement("li");
        li.innerHTML = `<span>${w.idiom}</span><span class="spelling">（${w.bo}）</span><span class="def">${w.meaning}</span>`;
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