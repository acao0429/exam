/* ============================================================
   成語練習 自動補全引擎
   功能：
   1. aiFillIdioms  ：針對「填了成語但缺釋義/注音/近反義」的成語，AI 一次補齊
   2. aiSuggest     ：給一個主題（例如課名），AI 建議一批適合國小的成語

   跟文意測驗共用同一套 AI 設定（provider / model 一致）。
   2026/9 起改為「伺服器端代理」：金鑰存在 D1，由 Worker 呼叫 AI，
   瀏覽器不持有金鑰；雲端未啟用時退回本機金鑰直連。
   ============================================================ */

(function () {
  "use strict";

  function fetchWithTimeout(url, ms, options) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      fetch(url, options || {}).then(
        (r) => { clearTimeout(timer); resolve(r); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  /* 2026 年確認有效的預設模型（與 gen-questions.js 相同） */
  const AI_PROVIDERS = {
    gemini: { label: "Gemini", style: "gemini", base: "https://generativelanguage.googleapis.com/v1beta", models: ["gemini-2.5-flash"] },
    groq: { label: "Groq", style: "openai", base: "https://api.groq.com/openai/v1", models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'] },
    openai: { label: "OpenAI", style: "openai", base: "https://api.openai.com/v1", models: ["gpt-4o-mini", "gpt-4o"] },
    nvidia: { label: "NVIDIA NIM", style: "openai", base: "https://integrate.api.nvidia.com/v1", models: ["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b", "openai/gpt-oss-20b", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"] },
    agnes: { label: "Agnes AI", style: "openai", base: "https://apihub.agnes-ai.com/v1", models: ["agnes-2.5-flash", "agnes-2.0-flash", "agnes-1.5-flash"] }
  };

  const AI_SYSTEM = "你是一位國小國語老師。";

  async function tryModels(models, fn) {
    let lastErr = null;
    for (const m of models) {
      try {
        return await fn(m);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  function aiProvider(cfg, fn) {
    if (!cfg || !cfg.provider) return Promise.resolve([]);
    const prov = AI_PROVIDERS[cfg.provider];
    if (!prov) return Promise.resolve([]);
    const users = cfg.model ? [cfg.model] : [];

    /* 伺服器端代理優先（金鑰在 D1） */
    if (cfg.hasCloud && window.ExamCloud && window.ExamCloud.aiProxyEnabled && window.ExamCloud.aiProxyEnabled()) {
      return tryModels(users.concat(prov.models), (m) => fn("proxy", m, prov));
    }
    if (cfg.key && prov.style === "gemini") return tryModels(users.concat(prov.models), (m) => fn("gemini", m, prov));
    if (cfg.key) return tryModels(users.concat(prov.models), (m) => fn("openai", m, prov));
    return Promise.resolve([]);
  }

  function buildPrompt(items, task) {
    return [
      "你是國小老師，會用小朋友看得懂的話教成語。",
      task,
      "輸出需求：",
      "1. 只輸出 JSON，不要任何其他文字。",
      '2. 格式：{"idiom":"成語","bo":"逐字注音，字與字之間空一格，例如 ㄕㄡˇ ㄓㄨ ㄉㄞˋ ㄊㄨˋ","meaning":"簡單解釋(10~30字)","synonym":"近義成語，沒有就空字串","antonym":"反義成語，沒有就空字串"}',
      "",
      "內容：",
      items
    ].join("\n");
  }

  function extractJsonArray(text) {
    const s = text.indexOf("[");
    const e = text.lastIndexOf("]");
    if (s === -1 || e === -1 || e <= s) throw new Error("找不到 JSON");
    return JSON.parse(text.slice(s, e + 1));
  }

  function normalizeIdioms(arr) {
    if (!Array.isArray(arr)) throw new Error("格式錯誤");
    const out = [];
    arr.forEach((it) => {
      if (!it || !it.idiom) return;
      const idiom = String(it.idiom).trim().replace(/\s+/g, "");
      if (idiom.length < 2 || idiom.length > 8) return;
      if (out.some((x) => x.idiom === idiom)) return;
      out.push({
        idiom,
        bo: (it.bo ? String(it.bo).trim() : "").slice(0, 40),
        meaning: (it.meaning ? String(it.meaning).trim() : "").slice(0, 60),
        synonym: (it.synonym ? String(it.synonym).trim() : "").slice(0, 12),
        antonym: (it.antonym ? String(it.antonym).trim() : "").slice(0, 12)
      });
    });
    return out;
  }

  async function aiOpenAICompat(prov, model, cfg, payload) {
    const resp = await fetchWithTimeout(`${prov.base}/chat/completions`, 60000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.key}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: AI_SYSTEM },
          { role: "user", content: payload }
        ],
        temperature: 0.6
      })
    });
    if (!resp.ok) throw new Error(await parseHttpErr(resp));
    const data = await resp.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return normalizeIdioms(extractJsonArray(text || ""));
  }

  async function aiGemini(prov, model, cfg, payload) {
    const url = `${prov.base}/models/${encodeURIComponent(model)}:generateContent`;
    const resp = await fetchWithTimeout(url, 60000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": cfg.key
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: payload }] }],
        systemInstruction: { parts: [{ text: AI_SYSTEM }] },
        generationConfig: { temperature: 0.6 }
      })
    });
    if (!resp.ok) throw new Error(await parseHttpErr(resp));
    const data = await resp.json();
    const text =
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
    return normalizeIdioms(extractJsonArray(text || ""));
  }

  async function parseHttpErr(resp) {
    let body = "";
    try { body = (await resp.text()).slice(0, 300); } catch (e) {}
    let msg = body.replace(/[\n\r"{}]/g, " ").trim().slice(0, 160) || resp.statusText;
    if (/key.*invalid|api.?key|invalid key|apikey/i.test(body)) msg = "API 金鑰無效，請在後台重新複製貼上金鑰。";
    else if (/not found|notfound|model/i.test(body)) msg = "「找不到模型」，會自動換下一個模型試試。原始： " + msg;
    else if (resp.status === 401 || resp.status === 403) msg = "權限被拒（金鑰無效或沒權限）。";
    else if (resp.status === 429) msg = "免費額度用完或太頻繁（429），稍等一下再試。";
    return `連線失敗（HTTP ${resp.status}）：${msg}`;
  }

  /* 針對一批「只填了成語」的詞條，AI 補釋義/注音/近反義 */
  function aiFillIdioms(items, cfg) {
    if (!cfg || !cfg.provider) return Promise.resolve([]);
    const list = items.map((it) => (typeof it === "string" ? it : it.idiom)).filter(Boolean);
    const unique = [...new Set(list)];
    if (unique.length === 0) return Promise.resolve([]);
    const payload = buildPrompt(
      "以下是成語清單，請為每一個成語補齊資料：\n" + unique.join("、"),
      "請依照成語清單逐條輸出 JSON 陣列，不要把清單裡沒有的成語混進去。"
    );
    return aiProvider(cfg, async (mode, m, prov) => {
      if (mode === "proxy") {
        const text = await window.ExamCloud.aiChat(cfg.provider, m || "", payload, AI_SYSTEM, 0.6);
        return normalizeIdioms(extractJsonArray(text || ""));
      }
      if (mode === "gemini") return aiGemini(prov, m, cfg, payload);
      return aiOpenAICompat(prov, m, cfg, payload);
    });
  }

  /* 給主題（課名/關鍵字），AI 建議一批成語（可用於「AI 依課名補成語」） */
  function aiSuggest(topic, cfg) {
    if (!cfg || !cfg.provider) return Promise.resolve([]);
    const payload = buildPrompt(
      `主題：${topic}\n請建議 6 個適合國小學生的常見四字成語，要和「${topic}」的意思或情境相關。`,
      "請選常見、適合國小的成語，釋義要簡短好懂。"
    );
    return aiProvider(cfg, async (mode, m, prov) => {
      if (mode === "proxy") {
        const text = await window.ExamCloud.aiChat(cfg.provider, m || "", payload, AI_SYSTEM, 0.6);
        return normalizeIdioms(extractJsonArray(text || ""));
      }
      if (mode === "gemini") return aiGemini(prov, m, cfg, payload);
      return aiOpenAICompat(prov, m, cfg, payload);
    });
  }

  window.GenIdioms = { aiFillIdioms, aiSuggest };
})();