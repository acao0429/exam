/* ============================================================
   國字注音 練習邏輯
   ============================================================ */

(function () {
  "use strict";

  /* 題庫：優先使用老師後台存到這台電腦的版本 */
  const STORE_KEY = "exam_word_bank_v1";
  let BANK = WORD_BANK;

  function loadBank() {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) BANK = JSON.parse(saved);
    } catch (e) { /* 忽略 */ }
  }

  loadBank();

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
      // 作答上雲（答對也記錄）
      uploadAttempt({
        bank: "zhuyin",
        lesson: q.word.lesson || "",
        mode: q.mode,
        itemKey: q.word.char,
        prompt: q.word.char,
        chosen: chosen,
        correct: true
      });
    } else {
      wrongCount++;
      wrongItems.push({ char: q.word.char, zhuyin: q.word.zhuyin, def: q.word.def });
      box.className = "feedback no";
      // 作答上雲
      uploadAttempt({
        bank: "zhuyin",
        lesson: q.word.lesson || "",
        mode: q.mode,
        itemKey: q.word.char,
        prompt: q.word.char,
        chosen: chosen,
        correct: isCorrect
      });
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

  /* ---------- 學生登入與作答上雲 ---------- */
  function initStudentLogin() {
    if (!window.ExamCloud || !window.ExamCloud.enabled()) return;
    const loginSec = $("student-login-section");
    const welcome = $("student-welcome");
    const loginMsg = $("student-login-msg");
    const loginBtn = $("student-login-btn");
    const logoutBtn = $("student-logout-btn");

    // 檢查是否已登入
    if (window.ExamCloud.studentLoggedIn()) {
      const info = window.ExamCloud.getStudentInfo();
      loginSec.classList.remove("hidden");
      welcome.textContent = "👋 歡迎，" + (info && info.name || info && info.seat);
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";
      // 登入時整包合併錯題本
      syncWrongBook();
    } else {
      loginSec.classList.remove("hidden");
    }

    // 登入按鈕
    loginBtn.addEventListener("click", async () => {
      const seat = $("student-seat").value.trim();
      const password = $("student-password").value;
      if (!seat || !password) { loginMsg.textContent = "請輸入座號與密碼"; return; }
      try {
        const data = await window.ExamCloud.studentLogin(seat, password);
        loginMsg.textContent = "登入成功！歡迎 " + (data.student && data.student.name || seat);
        welcome.textContent = "👋 歡迎，" + (data.student && data.student.name || seat);
        loginBtn.style.display = "none";
        logoutBtn.style.display = "inline-block";
        syncWrongBook();
      } catch (e) {
        loginMsg.textContent = "登入失敗：" + e.message;
      }
    });

    // 登出按鈕
    logoutBtn.addEventListener("click", async () => {
      await window.ExamCloud.studentLogout();
      loginSec.classList.add("hidden");
      welcome.textContent = "";
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
      loginMsg.textContent = "已登出";
    });

    // 修改密碼按鈕
    const changePwdBtn = $("change-password-btn");
    const changePwdPanel = $("change-password-panel");
    const cancelChangeBtn = $("cancel-change-btn");
    const changePwdMsg = $("change-password-msg");
    if (changePwdBtn) {
      changePwdBtn.addEventListener("click", () => {
        changePwdPanel.classList.toggle("hidden");
        changePwdMsg.textContent = "";
        $("old-password").value = "";
        $("new-password").value = "";
        $("confirm-password").value = "";
      });
    }
    if (cancelChangeBtn) {
      cancelChangeBtn.addEventListener("click", () => {
        changePwdPanel.classList.add("hidden");
        changePwdMsg.textContent = "";
      });
    }
    const submitChangeBtn = $("submit-change-btn");
    if (submitChangeBtn) {
      submitChangeBtn.addEventListener("click", async () => {
        const oldPwd = $("old-password").value;
        const newPwd = $("new-password").value;
        const confirmPwd = $("confirm-password").value;
        if (!oldPwd || !newPwd || !confirmPwd) {
          changePwdMsg.textContent = "請填寫所有欄位";
          return;
        }
        if (newPwd !== confirmPwd) {
          changePwdMsg.textContent = "新密碼與確認密碼不一致";
          return;
        }
        if (newPwd.length < 4) {
          changePwdMsg.textContent = "密碼至少 4 個字元";
          return;
        }
        try {
          await window.ExamCloud.studentChangePassword(oldPwd, newPwd);
          changePwdMsg.textContent = "✅ 密碼已修改，請重新登入";
          changePwdPanel.classList.add("hidden");
          // 登出讓學生重新登入
          await window.ExamCloud.studentLogout();
          loginSec.classList.add("hidden");
          loginBtn.style.display = "inline-block";
          logoutBtn.style.display = "none";
          welcome.textContent = "";
        } catch (e) {
          changePwdMsg.textContent = "❌ " + e.message;
        }
      });
    }
  }

  // 登入時整包合併錯題本
  async function syncWrongBook() {
    if (!window.ExamCloud || !window.ExamCloud.studentLoggedIn()) return;
    try {
      // 合併後更新本機 wrongItems
      const merged = await window.ExamCloud.mergeWrongCloud(wrongItems);
      wrongItems = merged;
      console.log("錯題本已與雲端同步，共 " + merged.length + " 題");
    } catch (e) {
      console.warn("錯題本同步失敗：", e.message);
    }
  }

  function initAttemptUpload() {
    if (window.ExamCloud && window.ExamCloud.studentLoggedIn()) {
      syncWrongBook();
    }
  }

  // 作答後上傳到雲端
  async function uploadAttempt(item) {
    if (!window.ExamCloud || !window.ExamCloud.studentLoggedIn()) return;
    try {
      await window.ExamCloud.pushAttempt(item);
    } catch (e) {
      console.warn("作答上傳失敗：", e.message);
    }
  }

  function boot() {
    if (window.ExamCloud && window.ExamCloud.enabled()) {
      /* 雲端優先：抓取雲端題庫寫進本機快取，再重新載入 BANK；失敗就用本機。 */
      window.ExamCloud.hydrateLocalFromCloud()
        .then(() => { loadBank(); })
        .catch(() => { loadBank(); })
        .finally(() => { initAttemptUpload(); window.ExamCloud.renderStudentBar(); init(); });
    } else { initAttemptUpload(); window.ExamCloud.renderStudentBar();
      init();
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();