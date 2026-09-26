/* ============================================================
   老師後台：✨ 自動出題（js/admin/ai-generate.js）
   ------------------------------------------------------------
   依「AI 設定」裡的優先順序逐一嘗試各家 AI，都失敗才用教育部辭典免費出題。
   題目寫回文意測驗的題庫（見 content.js）。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;
  const S = A.state;

  async function autoGenerateQuestions() {
    const item = A.content.currentContent();
    if (!item) { alert("請先新增課次。"); return; }
    if (!item.passage || !item.passage.trim()) { alert("請先填上課文內容，才能自動出題喔。"); return; }

    $("gen-btn").disabled = true;
    $("gen-btn").textContent = "✨ 出題中…";
    $("gen-status").textContent = "⏳ 嘗試用 AI 出題…";

    /* 依優先順序逐一嘗試各家 AI，最後才用教育部 */
    const aiPriority = A.ai.readyPriority();

    let qs = [];
    let triedMsg = [];
    for (const provKey of aiPriority) {
      const provCfg = A.ai.loadAIForProvider(provKey);
      const provLabel = A.AI_PROVIDERS[provKey] ? A.AI_PROVIDERS[provKey].label : provKey;
      $("gen-status").textContent = "⏳ 用 AI（" + provLabel + "）出題中…";
      try {
        qs = await GenQuestions.aiGenerate(item, provCfg);
        if (qs && qs.length > 0) {
          $("gen-status").textContent = `✨ 已用 ${provLabel} 出 ${qs.length} 題！`;
          break;
        }
      } catch (e) {
        triedMsg.push(provKey + "（" + (e.message || "失敗") + "）");
        qs = [];
      }
    }

    if (!qs || qs.length === 0) {
      $("gen-status").textContent = triedMsg.length ? "⏳ " + triedMsg.join(" → ") + "，改用教育部辭典…" : "⏳ 沒有 AI 金鑰，用教育部辭典免費出題…";
      try { qs = await GenQuestions.ruleGenerate(item, Object.keys(S.cBank).map((n) => S.cBank[n])); }
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
    A.content.renderQuestionEditors();
    $("gen-status").textContent = `✨ 已加入 ${qs.length} 題，請檢查後再儲存！`;
  }

  A.aiGenerate = { autoGenerateQuestions };

})();
