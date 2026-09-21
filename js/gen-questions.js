/* ============================================================
   文意測驗 自動出題引擎
   兩種來源：
   1. aiGenerate：AI 出題（需要 API 金鑰，金鑰只存在老師這台電腦）
   2. ruleGenerate：教育部辭典（moedict）規則式出題（免費、不需金鑰，但需要連網）

   兩種都沒辦法用時，回傳空陣列；出題結果請老師檢查後再儲存。
   ============================================================ */

(function () {
  "use strict";

  function cleanDef(s) {
    return String(s).replace(/[`~]/g, "").replace(/\s+/g, " ").slice(0, 40);
  }

  function getDef(data) {
    if (!data) return "";
    // 語詞（/a/）：h[0].d[0].f
    if (Array.isArray(data.h)) {
      for (const entry of data.h) {
        if (Array.isArray(entry.d) && entry.d.length && entry.d[0].f) {
          return cleanDef(entry.d[0].f);
        }
      }
    }
    // 單字（/uni/）：heteronyms[0].definitions[0].def
    if (Array.isArray(data.heteronyms)) {
      for (const h of data.heteronyms) {
        if (Array.isArray(h.definitions) && h.definitions.length && h.definitions[0].def) {
          return cleanDef(h.definitions[0].def);
        }
      }
    }
    return "";
  }

  function fetchWithTimeout(url, ms, options) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      fetch(url, options || {}).then(
        (r) => { clearTimeout(timer); resolve(r); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* 把「正確答案」混進選項，回傳 { options, answer } */
  function buildChoice(correct, distractors, optionCount) {
    const notSame = distractors.filter((d) => d && d !== correct);
    const pool = [correct].concat(shuffle(notSame).slice(0, optionCount - 1));
    if (pool.length < optionCount) return null;
    const order = shuffle(pool.map((t, i) => ({ t, i })));
    const answerIdx = order.findIndex((o) => o.i === 0);
    if (answerIdx === -1) return null;
    return { options: order.map((o) => o.t), answer: answerIdx };
  }

  /* ---------- 句子處理 ---------- */
  function splitSentences(passage) {
    return passage
      .split(/[。！？!?；;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4);
  }

  /* ---------- 規則式出題（教育部辭典，需連網） ----------
     題型：
     1. 主旨（挑出正確標題）
     2. 細節（哪一句是課文裡的／哪一句不屬於課文）
     3. 詞句（課文某詞的意思，用教育部辭典解釋當選項） */
  async function ruleGenerate(item, allLessons) {
    const out = [];
    const others = allLessons.filter((l) => l.lesson !== item.lesson);

    /* 1. 主旨：標題選擇題（需要至少 4 個不同標題） */
    const titles = allLessons.map((l) => (l.title || "").trim()).filter((t) => t);
    const ownTitle = (item.title || "").trim();
    if (ownTitle && new Set(titles).size >= 4) {
      const choice = buildChoice(ownTitle, titles.filter((t) => t !== ownTitle), 4);
      if (choice) {
        out.push({
          type: "主旨",
          q: "這篇文章的標題，最適合選哪一個？",
          options: choice.options,
          answer: choice.answer
        });
      }
    }

    /* 2. 細節：以課文的句子當選項（與其他課的句子混在一起） */
    const ownS = splitSentences(item.passage || "");
    const otherS = [];
    others.forEach((l) => {
      splitSentences(l.passage || "").forEach((s) => otherS.push(s));
    });
    const uniqueOwn = [...new Set(ownS)];
    const uniqueOther = [...new Set(otherS)];

    if (uniqueOwn.length >= 1 && uniqueOther.length >= 3) {
      const c = uniqueOwn[Math.floor(Math.random() * uniqueOwn.length)];
      const choice = buildChoice(c, uniqueOther, 4);
      if (choice) {
        out.push({
          type: "細節",
          q: "課文裡有哪一句話，是下面這個樣子？（字完全一樣才算）",
          options: choice.options,
          answer: choice.answer
        });
      }
    }

    if (uniqueOwn.length >= 3 && uniqueOther.length >= 1) {
      const foreign = uniqueOther[Math.floor(Math.random() * uniqueOther.length)];
      const choice = buildChoice(foreign, uniqueOwn, 4);
      if (choice) {
        out.push({
          type: "細節",
          q: "下列哪一句「沒有」出現在這篇課文裡？",
          options: choice.options,
          answer: choice.answer
        });
      }
    }

    /* 3. 詞句：從課文找真實字詞，用教育部辭典解釋出題 */
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      try {
        const words = await findRealWords(item.passage || "");
        if (words.length >= 4) {
          const selected = shuffle(words).slice(0, 6);
          selected.forEach((w) => {
            const distractors = words.filter((x) => x.w !== w.w).map((x) => x.def);
            const choice = buildChoice(w.def, distractors, 4);
            if (choice) {
              out.push({
                type: "詞句",
                q: `課文中「${w.w}」的意思，比較接近哪一個？`,
                options: choice.options,
                answer: choice.answer
              });
            }
          });
        }
      } catch (e) { /* 辭典連線失敗就少出詞句題 */ }
    }

    return out.slice(0, 10);
  }

  /* 掃描課文找真實詞彙（優先取 3 字詞，其次 2 字詞），回傳 [{w, def}] */
  async function findRealWords(passage, maxWords, maxFetch) {
    const words = [];
    const seen = new Set();
    const text = (passage || "").replace(/\s+/g, "");
    const capWords = maxWords || 8;
    const capFetch = maxFetch || 26;
    let fetches = 0;

    async function tryAt(s) {
      if (s.length < 2 || seen.has(s)) return false;
      seen.add(s);
      fetches++;
      try {
        const resp = await fetchWithTimeout(
          `https://www.moedict.tw/a/${encodeURIComponent(s)}.json`, 6000
        );
        if (!resp.ok) return false;
        const data = await resp.json();
        const def = getDef(data);
        if (def) {
          words.push({ w: s, def });
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    }

    let i = 0;
    while (i < text.length && words.length < capWords && fetches < capFetch) {
      const win3 = text.substr(i, 3);
      const win2 = text.substr(i, 2);
      if (win3.length === 3 && (await tryAt(win3))) { i += 3; continue; }
      if (win2.length === 2 && (await tryAt(win2))) { i += 2; continue; }
      i += 1;
    }
    return words;
  }

  /* ---------- AI 出題 ---------- */
  /* 2026 年確認有效的預設模型（官方文件），失敗時會自動輪流試 */
  const AI_PROVIDERS = {
    gemini: { label: "Gemini", style: "gemini", base: "", models: ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.7-flash"] },
    groq: { label: "Groq", style: "openai", base: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b", "groq/compound-mini"] },
    openai: { label: "OpenAI", style: "openai", base: "https://api.openai.com/v1", models: ["gpt-4o-mini", "gpt-4o"] },
    nvidia: { label: "NVIDIA NIM", style: "openai", base: "https://integrate.api.nvidia.com/v1", models: ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-8b-instruct"] },
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

  /* 伺服器端代理：金鑰在 D1，由 Worker 呼叫 AI，前端不持有金鑰 */
  async function proxyChat(provider, model, prompt, temperature) {
    const text = await window.ExamCloud.aiChat(provider, model || "", prompt, AI_SYSTEM, temperature);
    return text;
  }

  async function aiGenerate(item, cfg) {
    if (!cfg || !cfg.provider) return [];
    const prov = AI_PROVIDERS[cfg.provider];
    if (!prov) return [];
    const users = cfg.model ? [cfg.model] : [];
    const prompt = buildPrompt(item);

    /* 伺服器端代理優先（金鑰在 D1） */
    if (cfg.hasCloud && window.ExamCloud && window.ExamCloud.aiProxyEnabled && window.ExamCloud.aiProxyEnabled()) {
      return tryModels(users.concat(prov.models), async (m) => {
        const text = await proxyChat(cfg.provider, m, prompt, 0.7);
        return normalizeAI(extractJsonArray(text || ""));
      });
    }

    /* 沒有雲端（本機只有金鑰）時，沿用舊的直接呼叫 */
    if (cfg.key && prov.style === "gemini") {
      return tryModels(users.concat(prov.models), (m) => aiGemini(prov, m, cfg, prompt));
    }
    if (cfg.key) {
      return tryModels(users.concat(prov.models), (m) => aiOpenAICompat(prov.base, m, cfg, prompt));
    }
    return [];
  }

  function buildPrompt(item) {
    return [
      "你是國小老師，請依據下面的課文出「文意測驗」選擇題。",
      "要求：",
      "1. 出 10 題，題型平均涵蓋：主旨、文意、細節、詞句。",
      "2. 題目用字要簡單，適合小學生。",
      "3. 每題 4 個選項（A~D），只有一個正確。",
      "4. 正確答案的選項文字不要太長，避免一眼看出。",
      "5. 輸出一段 JSON，格式：",
      '[{"type":"主旨|文意|細節|詞句","q":"題目","options":["選項1","選項2","選項3","選項4"],"answer":0,"explain":"簡單說明為什麼"}]',
      "6. answer 是正確答案在 options 的編號（0~3）。",
      "7. 只輸出 JSON，不要其他文字。",
      "",
      "課文：",
      item.passage
    ].join("\n");
  }

  function extractJsonArray(text) {
    const s = text.indexOf("[");
    const e = text.lastIndexOf("]");
    if (s === -1 || e === -1 || e <= s) throw new Error("找不到 JSON");
    return JSON.parse(text.slice(s, e + 1));
  }

  function normalizeAI(arr) {
    if (!Array.isArray(arr)) throw new Error("格式錯誤");
    const types = ["主旨", "文意", "細節", "詞句"];
    return arr
      .filter((q) => q && q.q && Array.isArray(q.options) && q.options.length === 4)
      .map((q) => ({
        type: types.indexOf(q.type) >= 0 ? q.type : "文意",
        q: String(q.q),
        options: q.options.map((o) => String(o)),
        answer: parseInt(q.answer, 10) || 0,
        explain: q.explain ? String(q.explain) : ""
      }));
  }

  /* 把伺服器的錯誤訊息轉成人話 */
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

  /* 測試連線：給後台「測試連線」按鈕用 */
  async function testConnection(cfg) {
    if (!cfg || !cfg.provider) return { ok: false, message: "還沒選 AI 提供者。" };
    const prov = AI_PROVIDERS[cfg.provider];
    if (!prov) return { ok: false, message: "不支援的提供者。" };

    /* 伺服器端代理測試（金鑰在 D1，不落地瀏覽器） */
    if (cfg.hasCloud && window.ExamCloud && window.ExamCloud.aiProxyEnabled && window.ExamCloud.aiProxyEnabled()) {
      try {
        const r = await window.ExamCloud.aiTest(cfg.provider, cfg.model || "");
        return { ok: true, message: "連線成功！金鑰有效（伺服器回應正常）" + (r.model ? `，模型：${r.model}` : "") + "。" };
      } catch (e) {
        const m = (e && e.message) || e;
        return { ok: false, message: /找不到模型/.test(m) ? m : "測試失敗：" + m };
      }
    }

    if (!cfg.key) return { ok: false, message: "還沒貼上 API 金鑰。" };
    try {
      if (prov.style === "openai") {
        const resp = await fetchWithTimeout(`${prov.base}/models`, 15000, {
          headers: { "Authorization": `Bearer ${cfg.key}` }
        });
        if (resp.ok) return { ok: true, message: "連線成功！金鑰有效（伺服器回應正常）。" };
        return { ok: false, message: await parseHttpErr(resp) };
      }
      /* gemini：列出模型清單測試 */
      const resp = await fetchWithTimeout("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(cfg.key), 15000, {
        headers: { "x-goog-api-key": cfg.key }
      });
      if (resp.ok) return { ok: true, message: "連線成功！金鑰有效（伺服器回應正常）。" };
      return { ok: false, message: await parseHttpErr(resp) };
    } catch (e) {
      return { ok: false, message: "完全連不上 API：" + (e.message || e) + "（請檢查有沒有連網，或學校網路／防火牆是否擋住 https）" };
    }
  }

  /* Groq / OpenAI / NVIDIA / Agnes（同一格式） */
  async function aiOpenAICompat(baseURL, model, cfg, prompt) {
    const resp = await fetchWithTimeout(`${baseURL}/chat/completions`, 30000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.key}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: AI_SYSTEM },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      })
    });
    if (!resp.ok) throw new Error(await parseHttpErr(resp));
    const data = await resp.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return normalizeAI(extractJsonArray(text || ""));
  }

  /* Gemini */
  async function aiGemini(prov, model, cfg, prompt) {
    const url = `${prov.base}/models/${encodeURIComponent(model)}:generateContent`;
    const resp = await fetchWithTimeout(url, 60000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": cfg.key
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: AI_SYSTEM }] },
        generationConfig: { temperature: 0.7 }
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
    return normalizeAI(extractJsonArray(text || ""));
  }

  /* ---------- AI 批次補詞義（國字注音用） ---------- */
  function buildDefPrompt(words) {
    return [
      "你是國小老師，以下是國語課的生字／語詞，請幫每個都寫一句「小學生看得懂的簡單解釋」（10~25 字，用國小用語）。",
      '輸出 JSON 物件，格式：{"語詞":"解釋", ...}',
      "只輸出 JSON，不要其他文字。",
      "",
      "語詞：",
      words.join("、")
    ].join("\n");
  }

  function extractJsonObject(text) {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s === -1 || e === -1 || e <= s) throw new Error("找不到 JSON 物件");
    return JSON.parse(text.slice(s, e + 1));
  }

  function normalizeDefs(map, words) {
    const out = {};
    words.forEach((w) => {
      const v = map && map[w];
      if (v && String(v).trim()) out[w] = String(v).trim().slice(0, 40);
    });
    return out;
  }

  async function aiDefsOpenAICompat(baseURL, model, words, cfg) {
    const resp = await fetchWithTimeout(`${baseURL}/chat/completions`, 60000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.key}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: AI_SYSTEM },
          { role: "user", content: buildDefPrompt(words) }
        ],
        temperature: 0.5
      })
    });
    if (!resp.ok) throw new Error(await parseHttpErr(resp));
    const data = await resp.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return normalizeDefs(extractJsonObject(text || "{}"), words);
  }

  async function aiDefsGemini(prov, model, words, cfg) {
    const url = `${prov.base}/models/${encodeURIComponent(model)}:generateContent`;
    const resp = await fetchWithTimeout(url, 60000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": cfg.key
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildDefPrompt(words) }] }],
        systemInstruction: { parts: [{ text: AI_SYSTEM }] },
        generationConfig: { temperature: 0.5 }
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
    return normalizeDefs(extractJsonObject(text || "{}"), words);
  }

  /* 回傳 { 語詞: 短解釋 }；沒金鑰/沒雲端回傳 {} */
  async function aiFillDefs(words, cfg) {
    if (!cfg || !cfg.provider) return {};
    const prov = AI_PROVIDERS[cfg.provider];
    if (!prov) return {};
    const unique = [...new Set(words.map((w) => String(w).trim()).filter(Boolean))];
    if (unique.length === 0) return {};
    const users = cfg.model ? [cfg.model] : [];

    if (cfg.hasCloud && window.ExamCloud && window.ExamCloud.aiProxyEnabled && window.ExamCloud.aiProxyEnabled()) {
      return tryModels(users.concat(prov.models), async (m) => {
        const text = await proxyChat(cfg.provider, m, buildDefPrompt(unique), 0.5);
        return normalizeDefs(extractJsonObject(text || "{}"), unique);
      });
    }
    if (cfg.key && prov.style === "gemini") {
      return tryModels(users.concat(prov.models), (m) => aiDefsGemini(prov, m, unique, cfg));
    }
    if (cfg.key) {
      return tryModels(users.concat(prov.models), (m) => aiDefsOpenAICompat(prov.base, m, unique, cfg));
    }
    return {};
  }

  window.GenQuestions = { aiGenerate, ruleGenerate, testConnection, aiFillDefs };
})();