/* ============================================================
   國字注音 練習邏輯
   ============================================================ */

(function () {
  "use strict";

  /* 題庫：優先使用老師後台存到這台電腦的版本 */
  const STORE_KEY = "exam_word_bank_v1";
  let BANK = WORD_BANK;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) BANK = JSON.parse(saved);
  } catch (e) { /* 忽略 */ }

  function getBank() {
    /* 老師後台存過（即使存的是空的），就完全以它為準，不要再回退到內建範例 */
    if (localStorage.getItem("exam_word_bank_saved") === "1") return BANK;
    if (BANK.length > 0) return BANK;
    return WORD_BANK;
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
      container.innerHTML = "<p class='hint'>題庫還是空的喔！請先到 js/data.js 填入生字。</p>";
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

  /* ---------- 出題 ---------- */
  function buildQuestions() {
    const pool = getBank().filter((w) => selectedLessons.has(w.lesson));
    const modeArray = [...selectedModes].length > 0 ? [...selectedModes] : ["char2zhuyin"];
    questions = [];
    pool.forEach((w) => {
      const hasDef = !!(w.def && String(w.def).trim());
      modeArray.forEach((mode) => {
        if (mode === "word2meaning" || mode === "meaning2word") {
          if (hasDef) questions.push({ word: w, mode });
        } else {
          questions.push({ word: w, mode });
        }
      });
    });
    shuffle(questions);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function pickDistractors(current, pool, field) {
    const distractors = pool
      .filter((w) => w !== current && w[field] && w[field] !== current[field])
      .map((w) => w[field]);
    const unique = [...new Set(distractors)];
    shuffle(unique);
    return unique.slice(0, 3);
  }

  /* ---------- 開始 / 下一題 ---------- */
  function startQuiz() {
    if (selectedLessons.size === 0) {
      alert("請先點選要練習的課次喔！");
      return;
    }
    buildQuestions();
    if (questions.length === 0) {
      const modeArray = [...selectedModes].length > 0 ? [...selectedModes] : ["char2zhuyin"];
      const meaningMode = modeArray.some((m) => m === "word2meaning" || m === "meaning2word");
      const pool = getBank().filter((w) => selectedLessons.has(w.lesson));
      if (meaningMode && !pool.some((w) => w.def && String(w.def).trim())) {
        alert("你選了「詞義」玩法，但這些課次的生字還沒有詞義。請老師到後台按「🔍 批次查詞義」填入。");
      } else {
        alert("這個課次還沒有題目，請老師先在後台輸入生字。");
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

    const display = document.createElement("div");
    const options = [];

    if (q.mode === "char2zhuyin") {
      display.className = "big-display";
      display.textContent = q.word.char;
      options.push(...pickDistractors(q.word, pool, "zhuyin"), q.word.zhuyin);
    } else if (q.mode === "zhuyin2char") {
      display.className = "big-display";
      display.textContent = q.word.zhuyin;
      options.push(...pickDistractors(q.word, pool, "char"), q.word.char);
    } else if (q.mode === "listen") {
      const soundBtn = document.createElement("button");
      soundBtn.className = "sound-btn";
      soundBtn.textContent = "🔊 聽發音";
      soundBtn.addEventListener("click", () => speak(q.word.char));
      area.appendChild(soundBtn);
      options.push(...pickDistractors(q.word, pool, "char"), q.word.char);
    } else if (q.mode === "word2meaning") {
      display.className = "big-display";
      display.textContent = q.word.char;
      options.push(...pickDistractors(q.word, pool, "def"), q.word.def);
    } else if (q.mode === "meaning2word") {
      display.className = "big-display display-def";
      display.textContent = q.word.def;
      options.push(...pickDistractors(q.word, pool, "char"), q.word.char);
    }
    area.appendChild(display);

    shuffle(options);
    const optionsWrap = document.createElement("div");
    optionsWrap.className = "options";
    options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.className = "option";
      b.textContent = opt;
      b.addEventListener("click", () => answer(i, opt));
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
  function answer(idx, chosen) {
    if (answered) return;
    answered = true;

    const q = currentQuestion;
    const optionBtns = document.querySelectorAll(".option");
    const correctText = q.mode === "char2zhuyin" ? q.word.zhuyin
      : q.mode === "zhuyin2char" ? q.word.char
      : q.mode === "listen" ? q.word.char
      : q.mode === "word2meaning" ? q.word.def
      : q.word.char;
    const isCorrect = chosen === correctText;

    optionBtns.forEach((btn) => {
      btn.disabled = true;
      if (btn.textContent === correctText) btn.classList.add("correct-show");
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
      box.innerHTML = "🎉 好棒！答對了！";
    } else {
      wrongCount++;
      wrongItems.push({ char: q.word.char, zhuyin: q.word.zhuyin, def: q.word.def });
      box.className = "feedback no";
      if (q.mode === "word2meaning" || q.mode === "meaning2word") {
        box.innerHTML = `💪 沒關係！再複習一次：<b>${q.word.char}</b>（${q.word.zhuyin}）＝ ${q.word.def}`;
      } else {
        box.innerHTML = `💪 沒關係！再複習一次：<b>${q.word.char}</b>（${q.word.zhuyin}）`;
      }
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
      const ul = $("wrong-list-items");
      ul.innerHTML = "";
      [...new Set(wrongItems.map((w) => `${w.char}`))]
        .forEach((c) => {
          const w = wrongItems.find((i) => i.char === c);
          const li = document.createElement("li");
          const defText = (w.def && String(w.def).trim()) ? `<span class="def">${w.def}</span>` : "";
          li.innerHTML = `<span>${w.char}</span><span class="spelling">（${w.zhuyin}）</span>${defText}`;
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

  /* ---------- 發音 ---------- */
  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-TW";
    u.rate = 0.7;
    window.speechSynthesis.speak(u);
  }

  window.resetQuiz = resetQuiz;
  window.backToSetup = backToSetup;

  document.addEventListener("DOMContentLoaded", init);
})();