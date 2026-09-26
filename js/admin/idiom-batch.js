/* ============================================================
   老師後台 分頁：🎯 成語練習 — 批次查詢（js/admin/idiom-batch.js）
   ------------------------------------------------------------
   貼上一整批成語，自動查注音、釋義、近反義（線上萌典優先，內建庫備援），
   預覽確認後加入成語課次。成語表格編輯在 idiom-bank.js。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;
  const S = A.state;

  /* 解析貼上的成語：換行、頓號、逗號、分號、空白、全形逗號、句點都可分開 */
  function splitIdiomText(raw) {
    return [...new Set(
      raw.split(/[\n、，,；;。.、\s·・]+/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 8)
    )];
  }

  /* 線上：萌典成語辭典 */
  async function lookupIdiomOnline(text) {
    const url = `https://www.moedict.tw/a/${encodeURIComponent(text)}.json`;
    const resp = await A.net.fetchWithTimeout(url, 8000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const h = data.h && data.h[0];
    if (!h) return null;
    const d = h.d && h.d[0];
    return {
      bo: h.b || "",
      meaning: d && d.f ? d.f.replace(/`|~/g, "") : "",
      synonym: d && d.s ? d.s.replace(/`/g, "").replace(/~/g, "、") : "",
      antonym: d && d.a ? d.a.replace(/`/g, "").replace(/~/g, "、") : ""
    };
  }

  /* 單一成語：線上優先，失敗用內建庫 */
  async function lookupIdiomData(text) {
    let src = null;
    let from = "none";
    // 先查線上
    if (navigator.onLine !== false) {
      try {
        src = await lookupIdiomOnline(text);
        if (src) from = "online";
      } catch (e) { /* 忽略 */ }
    }
    // 線上沒有就查離線庫
    if (!src && typeof OFFLINE_IDIOMS !== "undefined") {
      src = OFFLINE_IDIOMS[text] || null;
      if (src) from = "offline";
    }
    return {
      idiom: text,
      bo: src ? src.bo : "",
      meaning: src ? src.meaning : "",
      synonym: src ? src.synonym : "",
      antonym: src ? src.antonym : "",
      from: from
    };
  }

  async function runIdiomBatch() {
    const raw = $("idiom-batch-text").value;
    const idioms = splitIdiomText(raw);
    if (idioms.length === 0) {
      $("idiom-batch-status").textContent = "⚠️ 沒讀到成語，請先貼上成語。";
      return;
    }
    $("idiom-batch-run-btn").disabled = true;
    $("idiom-batch-run-btn").textContent = "✨ 查詢中…";
    $("idiom-batch-status").textContent = "⏳ 正在自動查詢成語資料，請稍候…";

    S.batchIdiomRows = [];
    for (const idiom of idioms) {
      S.batchIdiomRows.push(await lookupIdiomData(idiom));
      renderIdiomBatchPreview();
    }

    const miss = S.batchIdiomRows.filter((r) => r.from === "none").length;
    $("idiom-batch-run-btn").disabled = false;
    $("idiom-batch-run-btn").textContent = "✨ 批次查成語";
    $("idiom-batch-status").textContent = miss
      ? `✅ 共 ${idioms.length} 筆；有 ${miss} 筆查不到，請手填或按下方「🤖 AI 補齊」。`
      : `✅ 共 ${idioms.length} 筆，全部查詢成功！`;
  }

  function renderIdiomBatchPreview() {
    const tbody = $("idiom-batch-tbody");
    tbody.innerHTML = "";
    S.batchIdiomRows.forEach((r, idx) => {
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
          S.batchIdiomRows[idx][c.key] = e.target.value.trim();
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
    if (!lesson || !S.iBank[lesson]) {
      alert("請先在下方選好要加入的課次（或先新增課次）。");
      return;
    }
    const valid = S.batchIdiomRows.filter((r) => r.idiom && r.bo && r.meaning);
    if (valid.length === 0) {
      alert("沒有可以加入的資料，每個成語請填好注音與釋義。");
      return;
    }
    const existing = new Set(S.iBank[lesson].map((x) => x.idiom));
    const added = valid.filter((r) => !existing.has(r.idiom));
    if (added.length === 0) {
      $("idiom-batch-status").textContent = "⚠️ 這些成語這個課次裡都有了。";
      return;
    }
    added.forEach((r) => {
      S.iBank[lesson].push({
        idiom: r.idiom,
        bo: r.bo,
        meaning: r.meaning,
        synonym: r.synonym,
        antonym: r.antonym
      });
    });
    A.store.quiet(A.store.persistIBank());
    A.idiom.renderIdiomLessonSelect();
    A.idiom.renderIdiomRows();
    $("save-msg").textContent = `✅ 已把 ${added.length} 筆成語加入「${lesson}」。請檢查後記得按「儲存此課」或「存到這台電腦」。`;
    $("idiom-batch-text").value = "";
    $("idiom-batch-status").textContent = "";
    $("idiom-batch-preview-wrap").classList.add("hidden");
  }

  A.idiomBatch = {
    splitIdiomText,
    lookupIdiomOnline,
    lookupIdiomData,
    runIdiomBatch,
    renderIdiomBatchPreview,
    addIdiomBatchToLesson
  };

})();
