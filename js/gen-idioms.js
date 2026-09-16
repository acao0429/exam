/* ============================================================
   成語練習 自動補全引擎
   功能：
   1. aiFillIdioms  ：針對「填了成語但缺釋義/注音/近反義」的成語，AI 一次補齊
   2. aiSuggest     ：給一個主題（例如課名），AI 建議一批適合國小的成語

   跟文意測驗共用同一套金鑰設定（localStorage：exam_ai_provider /
   exam_ai_key_<provider> / exam_ai_model_<provider>）。
   金鑰只存在老師這台電腦，任何匯出都不含金鑰。
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
  const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.7-flash"];
  const GROQ_MODELS = ["llama-3.3-70b-versatile", "openai/gpt-oss-20b", "groq/compound-mini"];
  const OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o"];

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

  function aiProvider(cfg, gemini, openaiCompat) {
    if (cfg.provider === "groq") return tryModels((cfg.model ? [cfg.model] : []).concat(GROQ_MODELS), (m) => openaiCompat("https://api.groq.com/openai/v1", m, cfg));
    if (cfg.provider === "openai") return tryModels((cfg.model ? [cfg.model] : []).concat(OPENAI_MODELS), (m) => openaiCompat("https://api.openai.com/v1", m, cfg));
    return tryModels((cfg.model ? [cfg.model] : []).concat(GEMINI_MODELS), (m) => gemini(m, cfg));
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

  async function aiOpenAICompat(baseURL, model, cfg, payload) {
    const resp = await fetchWithTimeout(`${baseURL}/chat/completions`, 60000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.key}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你是一位國小國語老師。" },
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

  async function aiGemini(model, cfg, payload) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const resp = await fetchWithTimeout(url, 60000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": cfg.key
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: payload }] }],
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
    if (!cfg || !cfg.key) return Promise.resolve([]);
    const list = items.map((it) => (typeof it === "string" ? it : it.idiom)).filter(Boolean);
    const unique = [...new Set(list)];
    if (unique.length === 0) return Promise.resolve([]);
    const payload = buildPrompt(
      "以下是成語清單，請為每一個成語補齊資料：\n" + unique.join("、"),
      "請依照成語清單逐條輸出 JSON 陣列，不要把清單裡沒有的成語混進去。"
    );
    return aiProvider(
      cfg,
      (m) => aiGemini(m, cfg, payload),
      (base, m) => aiOpenAICompat(base, m, cfg, payload)
    );
  }

  /* 給主題（課名/關鍵字），AI 建議一批成語（可用於「AI 依課名補成語」） */
  function aiSuggest(topic, cfg) {
    if (!cfg || !cfg.key) return Promise.resolve([]);
    const payload = buildPrompt(
      `主題：${topic}\n請建議 6 個適合國小學生的常見四字成語，要和「${topic}」的意思或情境相關。`,
      "請選常見、適合國小的成語，釋義要簡短好懂。"
    );
    return aiProvider(
      cfg,
      (m) => aiGemini(m, cfg, payload),
      (base, m) => aiOpenAICompat(base, m, cfg, payload)
    );
  }

  window.GenIdioms = { aiFillIdioms, aiSuggest };
})();