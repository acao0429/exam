/* ============================================================
   老師後台 分頁：🤖 AI 設定（js/admin/ai-settings.js）
   ------------------------------------------------------------
   2026/9 起金鑰存雲端 D1，瀏覽器不留金鑰。
   這裡負責：讀寫各家服務商的金鑰與模型、優先順序、連線測試。
   服務商對照表放在 core.js（A.AI_PROVIDERS）。
   ============================================================ */

(function () {
  "use strict";

  const A = window.Admin;
  const $ = A.$;
  const AI_PROXY = A.state.AI_PROXY; // { enabled, settings }
  const AI_PROVIDERS = A.AI_PROVIDERS;

  const DEFAULT_PRIORITY = ["gemini", "groq", "agnes", "nvidia", "openai"];

  /* 舊版（2026/9 前）金鑰只存一格，自動搬移到 Gemini */
  function migrateLegaAI() {
    if (!localStorage.getItem("exam_ai_key_gemini") && localStorage.getItem("exam_ai_key")) {
      localStorage.setItem("exam_ai_key_gemini", localStorage.getItem("exam_ai_key"));
      localStorage.setItem("exam_ai_model_gemini", localStorage.getItem("exam_ai_model") || "");
      localStorage.removeItem("exam_ai_key");
      localStorage.removeItem("exam_ai_model");
    }
  }

  /* 從雲端抓取這學期老師的 AI 設定快取（只含 hasKey/model，不含金鑰本身） */
  async function refreshAISettings() {
    AI_PROXY.enabled = !!(window.ExamCloud && window.ExamCloud.aiProxyEnabled && window.ExamCloud.aiProxyEnabled());
    AI_PROXY.settings = {};
    if (!AI_PROXY.enabled) {
      /* 雲端沒開：沿用舊有的本機金鑰（僅供離線直連） */
      DEFAULT_PRIORITY.forEach((p) => {
        if (localStorage.getItem("exam_ai_key_" + p)) {
          AI_PROXY.settings[p] = { hasKey: true, model: localStorage.getItem("exam_ai_model_" + p) || "" };
        }
      });
      return;
    }
    try {
      const data = await window.ExamCloud.aiSettingsGet();
      (data.settings || []).forEach((s) => {
        AI_PROXY.settings[s.provider] = { hasKey: !!s.hasKey, model: s.model || "" };
      });
    } catch (e) {
      if (window.console) console.warn("AI 設定載入失敗：", e.message);
    }
  }

  /* 讀出目前選用的服務商設定
     cfg = { provider, model, hasCloud, hasKey, key（離線用） } */
  function loadAI() {
    migrateLegaAI();
    const provider = localStorage.getItem("exam_ai_provider") || "gemini";
    const st = AI_PROXY.settings[provider] || {};
    const hasCloud = AI_PROXY.enabled;
    return {
      provider,
      model: st.model || localStorage.getItem("exam_ai_model_" + provider) || "",
      hasKey: hasCloud ? !!st.hasKey : !!localStorage.getItem("exam_ai_key_" + provider),
      hasCloud,
      key: hasCloud ? "" : (localStorage.getItem("exam_ai_key_" + provider) || "")
    };
  }

  function cfgHasKey(cfg) { return !!(cfg && (cfg.key || cfg.hasKey)); }

  function loadAIForProvider(provider) {
    const st = AI_PROXY.settings[provider] || {};
    const localKey = localStorage.getItem("exam_ai_key_" + provider) || "";
    const localModel = localStorage.getItem("exam_ai_model_" + provider) || "";
    const hasCloud = AI_PROXY.enabled;
    return {
      provider,
      model: st.model || localModel || (AI_PROVIDERS[provider] ? AI_PROVIDERS[provider].models[0] : "") || "",
      hasKey: hasCloud ? !!st.hasKey : !!localKey,
      hasCloud,
      key: hasCloud ? "" : localKey
    };
  }

  /* 讀出目前優先順序（出題時依序嘗試） */
  function getPriority() {
    const priorityStr = localStorage.getItem("exam_ai_priority") || JSON.stringify(DEFAULT_PRIORITY);
    let aiPriority = [];
    try { aiPriority = JSON.parse(priorityStr); } catch (e) { aiPriority = DEFAULT_PRIORITY.slice(); }
    return aiPriority;
  }

  /* 已經有金鑰的服務商（依優先順序） */
  function readyPriority() {
    return getPriority().filter((k) => AI_PROVIDERS[k] &&
      (AI_PROXY.settings[k] ? AI_PROXY.settings[k].hasKey : !!localStorage.getItem("exam_ai_key_" + k)));
  }

  /* ---------- AI 設定頁面渲染 ---------- */
  function renderAISettings() {
    const container = $("ai-settings-container");
    if (!container) return;
    container.innerHTML = "";

    // 優先順序設定
    let aiPriority = getPriority();
    Object.keys(AI_PROVIDERS).forEach(k => { if (!aiPriority.includes(k)) aiPriority.push(k); });
    aiPriority = aiPriority.filter(k => AI_PROVIDERS[k]);

    const priorityNote = document.createElement("p");
    priorityNote.className = "hint";
    priorityNote.style.marginBottom = "16px";
    priorityNote.innerHTML = "💡 <b>API 優先順序</b>：出題時依此順序嘗試，免費提供者優先。按住 Ctrl/Cmd 多選後按⬆⬇調整。";
    container.appendChild(priorityNote);

    const priorityPanel = document.createElement("div");
    priorityPanel.className = "panel";
    priorityPanel.style.marginBottom = "16px";
    priorityPanel.style.padding = "16px";
    priorityPanel.innerHTML = `
      <div class="form-row" style="align-items:center">
        <label style="min-width:100px">🔄 API 優先順序</label>
        <select id="ai-priority-order" multiple style="flex:1; height:120px">
          ${aiPriority.map(k => `<option value="${k}" selected>${AI_PROVIDERS[k].icon} ${AI_PROVIDERS[k].label}${AI_PROVIDERS[k].free ? "（免費）" : ""}</option>`).join('')}
        </select>
        <div class="inline-row" style="margin-left:8px">
          <button class="btn btn-sm btn-gray" id="ai-priority-up">⬆</button>
          <button class="btn btn-sm btn-gray" id="ai-priority-down">⬇</button>
          <button class="btn btn-sm btn-gray" id="ai-priority-reset">↺ 預設</button>
        </div>
      </div>
    `;
    container.appendChild(priorityPanel);

    // 各提供者卡片
    Object.entries(AI_PROVIDERS).forEach(([key, prov]) => {
      const st = AI_PROXY.settings[key] || {};
      const localKey = localStorage.getItem("exam_ai_key_" + key) || "";
      const localModel = localStorage.getItem("exam_ai_model_" + key) || "";
      const hasKey = (st.hasKey && AI_PROXY.enabled) || !!localKey;
      const currentModel = st.model || localModel || prov.models[0] || "";
      const priorityIdx = aiPriority.indexOf(key);

      const card = document.createElement("div");
      card.className = "panel";
      card.style.marginBottom = "12px";
      card.style.padding = "16px";
      card.innerHTML = `
        <div class="form-row" style="align-items:center; margin-bottom:12px">
          <span style="font-size:18px; font-weight:bold; margin-right:12px">${prov.icon} ${prov.label}</span>
          <span class="hint" style="margin-right:auto">優先 #${priorityIdx + 1}${prov.free ? " 🆓" : ""}${hasKey ? " ✅ 已設金鑰" : " ⚪ 尚未設定"}</span>
        </div>
        <div class="form-row">
          <label>模型</label>
          <select id="ai-model-${key}" class="admin-input" style="flex:1">
            ${prov.models.map(m => `<option value="${m}" ${m === currentModel ? 'selected' : ''}>${m}</option>`).join('')}
            <option value="">（自訂模型）</option>
          </select>
          <input type="text" id="ai-model-custom-${key}" class="admin-input" placeholder="輸入模型名稱"
            value="${!prov.models.includes(currentModel) ? currentModel : ''}" style="flex:1; display:${prov.models.includes(currentModel) ? 'none' : ''}">
        </div>
        <div class="form-row">
          <label>API 金鑰</label>
          <input type="password" id="ai-key-${key}" class="admin-input" placeholder="貼上 API 金鑰"
            value="${hasKey && !AI_PROXY.enabled ? localKey : ''}" style="flex:1">
        </div>
        <div class="center" style="margin-top:12px">
          <button class="btn btn-blue btn-sm" data-action="save" data-provider="${key}">💾 存金鑰</button>
          <button class="btn btn-gray btn-sm" data-action="test" data-provider="${key}" style="margin-left:8px">🔌 測試連線</button>
          <span id="ai-status-${key}" class="hint" style="margin-left:12px"></span>
        </div>
      `;
      container.appendChild(card);
    });

    // 綁定事件
    $("ai-priority-up").addEventListener("click", () => movePriority(-1));
    $("ai-priority-down").addEventListener("click", () => movePriority(1));
    $("ai-priority-reset").addEventListener("click", resetPriority);
    // Debug: 容器點擊用事件委派，只綁一次（避免重複渲染造成多重監聽）
    if (!container.dataset.listenerAttached) {
      container.dataset.listenerAttached = "true";
      container.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        const provider = btn.dataset.provider;
        if (action === "save") saveAIProvider(provider);
        else if (action === "test") testAIProvider(provider);
      });
    }
    // 模型下拉 change：每次渲染都要重新綁定（元素每次重建）
    Object.keys(AI_PROVIDERS).forEach(key => {
      $(`ai-model-${key}`)?.addEventListener("change", (e) => {
        $(`ai-model-custom-${key}`).style.display = e.target.value === "" ? "" : "none";
      });
    });
  }

  function movePriority(dir) {
    const sel = $("ai-priority-order");
    const options = Array.from(sel.options);
    const selectedIdx = options.findIndex(o => o.selected);
    if (selectedIdx === -1) return;
    const newIdx = selectedIdx + dir;
    if (newIdx < 0 || newIdx >= options.length) return;
    [options[selectedIdx], options[newIdx]] = [options[newIdx], options[selectedIdx]];
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    options.forEach(o => sel.appendChild(o));
    localStorage.setItem("exam_ai_priority", JSON.stringify(Array.from(sel.options).map(o => o.value)));
  }

  function resetPriority() {
    localStorage.setItem("exam_ai_priority", JSON.stringify(DEFAULT_PRIORITY));
    renderAISettings();
  }

  async function saveAIProvider(provider) {
    const keyInput = $(`ai-key-${provider}`);
    const modelSelect = $(`ai-model-${provider}`);
    const customModelInput = $(`ai-model-custom-${provider}`);
    const statusSpan = $(`ai-status-${provider}`);
    const apiKey = keyInput.value.trim();
    const model = modelSelect.value === "" ? (customModelInput.value.trim() || "") : modelSelect.value;

    if (AI_PROXY.enabled) {
      if (!apiKey) { statusSpan.textContent = "⚠️ 請貼上 API 金鑰"; statusSpan.style.color = "orange"; return; }
      try {
        await window.ExamCloud.aiSettingsSet(provider, apiKey, model);
        AI_PROXY.settings[provider] = { hasKey: true, model };
        localStorage.setItem("exam_ai_provider", provider);
        statusSpan.textContent = "✅ 已存到雲端！"; statusSpan.style.color = "green";
        keyInput.value = ""; keyInput.placeholder = "金鑰已存雲端（留空不變）";
      } catch (e) { statusSpan.textContent = "❌ 儲存失敗：" + e.message; statusSpan.style.color = "red"; }
    } else {
      localStorage.setItem("exam_ai_key_" + provider, apiKey || "");
      localStorage.setItem("exam_ai_model_" + provider, model || "");
      if (!localStorage.getItem("exam_ai_provider")) localStorage.setItem("exam_ai_provider", provider);
      statusSpan.textContent = "✅ 已存到本機！"; statusSpan.style.color = "green";
    }
  }

  async function testAIProvider(provider) {
    const statusSpan = $(`ai-status-${provider}`);
    const keyInput = $(`ai-key-${provider}`);
    const modelSelect = $(`ai-model-${provider}`);
    const customModelInput = $(`ai-model-custom-${provider}`);
    const apiKey = keyInput.value.trim() || (localStorage.getItem("exam_ai_key_" + provider) || "");
    const model = modelSelect.value === "" ? (customModelInput.value.trim() || "") : modelSelect.value;

    if (!apiKey) { statusSpan.textContent = "⚠️ 請先貼上金鑰"; statusSpan.style.color = "orange"; return; }
    statusSpan.textContent = "⏳ 測試中…"; statusSpan.style.color = "";
    const cfg = { provider, model, key: apiKey, hasCloud: AI_PROXY.enabled };
    try {
      /* 雲端模式：先把你「現在貼的這把新金鑰」存到 D1，測試才會用新金鑰（避免測到舊的） */
      if (AI_PROXY.enabled && apiKey && keyInput.value.trim()) {
        try { await window.ExamCloud.aiSettingsSet(provider, apiKey, model); }
        catch (e) { /* 存失敗不擋走純測試路徑 */ }
      }
      const r = await GenQuestions.testConnection(cfg);
      statusSpan.textContent = (r.ok ? "✅ " : "❌ ") + r.message;
      statusSpan.style.color = r.ok ? "green" : "red";
    } catch (e) { statusSpan.textContent = "❌ 測試失敗：" + (e.message || e); statusSpan.style.color = "red"; }
  }

  A.ai = {
    AI_PROVIDERS,
    DEFAULT_PRIORITY,
    migrateLegaAI,
    refreshAISettings,
    loadAI,
    cfgHasKey,
    loadAIForProvider,
    getPriority,
    readyPriority,
    renderAISettings,
    movePriority,
    resetPriority,
    saveAIProvider,
    testAIProvider
  };

})();
