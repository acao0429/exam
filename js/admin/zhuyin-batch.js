/* ============================================================
   老師後台 分頁：⚡ 批次輸入（js/admin/zhuyin-batch.js）
   ------------------------------------------------------------
   貼上一整批生字／語詞，自動配注音（線上萌典優先，離線表備援），
   預覽確認後加入「逐字輸入」裡的課次。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;
  const S = A.state;

  /* 線上：萌典（教育部國語辭典）
     - 單字查 uni/字.json -> heteronyms[0].bopomofo
     - 語詞查 a/詞.json -> h[0].b */
  async function lookupOnline(text) {
    const url = text.length === 1
      ? `https://www.moedict.tw/uni/${encodeURIComponent(text)}.json`
      : `https://www.moedict.tw/a/${encodeURIComponent(text)}.json`;
    const resp = await A.net.fetchWithTimeout(url, 8000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (text.length === 1) {
      return (data.heteronyms && data.heteronyms[0] && data.heteronyms[0].bopomofo) || null;
    }
    return (data.h && data.h[0] && data.h[0].b) || null;
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
    S.batchRows = texts.map((t) => ({ char: t, zhuyin: "", from: "none" }));

    $("batch-run-btn").disabled = true;
    $("batch-run-btn").textContent = "✨ 配注音中…";
    $("batch-status").textContent = "⏳ 正在自動配注音，請稍候…";

    renderBatchPreview();

    (async () => {
      for (let i = 0; i < S.batchRows.length; i++) {
        const r = await lookupZhuyin(S.batchRows[i].char);
        r.from = r.from || "none";
        S.batchRows[i].zhuyin = r.zhuyin;
        renderBatchPreview(); // 逐筆更新，看到即時結果
      }
      const miss = S.batchRows.filter((r) => !r.zhuyin).length;
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
    S.batchRows.forEach((r, idx) => {
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
        S.batchRows[parseInt(e.target.dataset.idx, 10)].zhuyin = e.target.value.trim();
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
    if (!lesson || !S.bank[lesson]) {
      alert("請先新增課次，或選擇要加入的課次。");
      return;
    }
    const valid = S.batchRows.filter((r) => r.char && r.zhuyin);
    if (valid.length === 0) {
      alert("沒有可以加入的資料，請先配好注音。");
      return;
    }
    valid.forEach((r) => S.bank[lesson].push({ char: r.char, zhuyin: r.zhuyin }));
    A.store.persistWordBank().then(() => {
      A.words.renderLessonSelect();
      A.words.renderBatchLessonSelect();
      $("batch-status").textContent = `🎉 已把 ${valid.length} 筆加入「${lesson}」！可以繼續貼下一批，或用「逐字輸入」檢查。`;
      $("batch-preview-wrap").classList.add("hidden");
      $("batch-text").value = "";
      S.batchRows = [];
    }).catch((e) => {
      $("batch-status").textContent = "⚠️ 儲存失敗：" + e.message;
    });
  }

  A.zhuyinBatch = {
    lookupOnline,
    lookupOffline,
    lookupZhuyin,
    runBatch,
    renderBatchPreview,
    addBatchToBank
  };

})();
