/* ============================================================
   exam-api：國語月考複習樂園 題庫 API（Cloudflare Worker + D1）

   讀取（公開，學生端用）：
     GET /api/health
     GET /api/banks          → { app, savedAt, words, content, idioms }
     GET /api/words          → [{ lesson, char, zhuyin, def }]
     GET /api/content        → [{ lesson, title, passage, questions:[...] }]
     GET /api/idioms         → [{ lesson, idiom, bo, meaning, synonym, antonym }]
     GET /api/ranking        → 本班排名（需登入；學生看自己班、老師看自己班）

   老師驗證（teacher session token）：
     POST /api/teacher/login       → { token, teacher:{id,username,name,className} }
     POST /api/teacher/logout
     GET  /api/teacher/me          → 目前登入老師
     POST /api/teacher/password    → 改密碼
     PUT  /api/teacher/class       → 改自己的班級名稱（可一併搬移現有學生）
     GET  /api/teachers            → 全部老師（學生管理指定「所屬老師」用）
     GET  /api/ai/settings         → AI 設定（provider / hasKey / model）
     POST /api/ai/settings         → 存某家 AI 提供者的金鑰 / model
     POST /api/ai/test             → 伺服器端測試 AI 連線
     POST /api/ai/chat             → 伺服器端代理：傳 prompt → AI 回文字
     PUT  /api/banks               → 整批覆蓋題庫
     GET  /api/students            → 只看自己班的學生
     POST /api/students            → 建學生（附帶班級）
     POST /api/students/password   → 重設密碼
     POST /api/students/claim      → 把「未分班」學生移入我的班級
     POST /api/students/assign-teacher → 指定學生所屬老師（標記用）
     DELETE /api/students          → 刪學生
     GET  /api/stats               → 只看自己班的統計

   班級規則：班級名稱相同的多位老師會看到同一份學生名單與排名。
   students.teacher_id 只是「這位學生由哪位老師管理」的標記欄位，
   不影響名單與排名的篩選（篩選以 class_name 為準）。

   學生驗證（student session token）：
     POST /api/student/login
     POST /api/student/logout
     GET  /api/student/me
     POST /api/student/password
     POST /api/attempts
     GET  /api/attempts/me
   ============================================================ */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-teacher-token, x-student-token",
  "access-control-max-age": "86400"
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, CORS)
  });
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ---------------- 通用雜項 ---------------- */

function sha256Hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashPassword(password, salt) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + password))
    .then(sha256Hex);
}

/* ---------------- AI 提供者設定（伺服器端代理用） ---------------- */

const AI_PROVIDERS = {
  gemini: {
    label: "Gemini",
    base: "https://generativelanguage.googleapis.com/v1beta",
    style: "gemini",
    models: ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.7-flash"]
  },
  groq: {
    label: "Groq",
    base: "https://api.groq.com/openai/v1",
    style: "openai",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b", "groq/compound-mini"]
  },
  openai: {
    label: "OpenAI",
    base: "https://api.openai.com/v1",
    style: "openai",
    models: ["gpt-4o-mini", "gpt-4o"]
  },
  nvidia: {
    label: "NVIDIA NIM",
    base: "https://integrate.api.nvidia.com/v1",
    style: "openai",
    models: ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-8b-instruct"]
  },
  agnes: {
    label: "Agnes AI",
    base: "https://apihub.agnes-ai.com/v1",
    style: "openai",
    models: ["agnes-2.5-flash", "agnes-2.0-flash", "agnes-1.5-flash"]
  }
};

function isValidAISettingsShape(body) {
  return typeof body === "object" && body !== null;
}

/* 把伺服器的錯誤訊息轉成人話（與前端 gen-questions.js 一致） */
function aiFriendlyError(status, bodyText) {
  if (/key.*invalid|api.?key|invalid key|apikey/i.test(bodyText || "")) {
    return "API 金鑰無效，請在後台重新複製貼上金鑰。";
  }
  if (/not found|notfound|model/i.test(bodyText || "")) {
    return "「找不到模型」，會自動換下一個模型試試。原始： " + String(bodyText || "").replace(/[\n\r"{}]/g, " ").trim().slice(0, 120);
  }
  if (status === 401 || status === 403) return "權限被拒（金鑰無效或沒權限）。";
  if (status === 429) return "免費額度用完或太頻繁（429），稍等一下再試。";
  return String(bodyText || "").replace(/[\n\r"{}]/g, " ").trim().slice(0, 160);
}

/* 統一接送：prompt（老師側做好的完整題目文字）＋ system（提示詞）
   provider 決定呼叫格式（gemini / openai 相容）。回傳 assistant 文字。 */
async function aiChat(env, teacherId, provider, model, prompt, system, temperature) {
  const info = AI_PROVIDERS[provider];
  if (!info) throw httpError(400, "不支援的 AI 提供者：" + provider);

  const row = await env.DB.prepare(
    "SELECT api_key, model FROM ai_settings WHERE teacher_id = ? AND provider = ?"
  ).bind(teacherId, provider).first();
  if (!row || !row.api_key) throw httpError(400, `尚未儲存 ${info.label} 的 API 金鑰，請先在後台貼上金鑰並按「存金鑰」。`);

  const apiKey = row.api_key;
  const modelName = model || row.model || info.models[0];
  const temp = typeof temperature === "number" ? temperature : 0.7;

  if (info.style === "gemini") {
    return aiChatGemini(info.base, modelName, apiKey, prompt, system, temp);
  }
  return aiChatOpenAI(info.base, modelName, apiKey, prompt, system, temp);
}

async function aiChatOpenAI(base, model, apiKey, prompt, system, temperature) {
  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system || "你是一位國小國語老師。" },
        { role: "user", content: prompt }
      ],
      temperature,
      max_tokens: 4096
    })
  });
  const text = await resp.text();
  if (!resp.ok) throw httpError(502, "AI 連線失敗（HTTP " + resp.status + "）：" + aiFriendlyError(resp.status, text));
  let data = null;
  try { data = JSON.parse(text); } catch (e) { throw httpError(502, "AI 回傳格式錯誤"); }
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== "string") throw httpError(502, "AI 沒有回傳內容");
  return content;
}

async function aiChatGemini(base, model, apiKey, prompt, system, temperature) {
  const resp = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: { temperature, maxOutputTokens: 4096 }
    })
  });
  const text = await resp.text();
  if (!resp.ok) throw httpError(502, "AI 連線失敗（HTTP " + resp.status + "）：" + aiFriendlyError(resp.status, text));
  let data = null;
  try { data = JSON.parse(text); } catch (e) { throw httpError(502, "AI 回傳格式錯誤"); }
  const content = data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;
  if (typeof content !== "string") throw httpError(502, "AI 沒有回傳內容");
  return content;
}

/* ---------------- 老師身分驗證 ---------------- */

async function requireTeacher(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
    || (request.headers.get("x-teacher-token") || "").trim();
  if (!token) throw httpError(401, "未登入：請先登入老師帳號");
  const row = await env.DB.prepare(
    "SELECT t.id, t.username, t.name, t.class_name, ts.token " +
    "FROM teacher_sessions ts JOIN teachers t ON t.id = ts.teacher_id " +
    "WHERE ts.token = ? AND ts.expires_at > datetime('now')"
  ).bind(token).first();
  if (!row) throw httpError(401, "登入已過期，請重新登入");
  return {
    teacher: { id: row.id, username: row.username, name: row.name, className: row.class_name },
    token: row.token
  };
}

/* ---------------- 學生身分驗證 ---------------- */

async function requireStudent(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
    || (request.headers.get("x-student-token") || "").trim();
  if (!token) throw httpError(401, "學生尚未登入");
  const row = await env.DB.prepare(
    "SELECT s.id, s.seat, s.name, s.class_name AS className FROM sessions ss JOIN students s ON s.id = ss.student_id " +
    "WHERE ss.token = ? AND ss.expires_at > datetime('now')"
  ).bind(token).first();
  if (!row) throw httpError(401, "登入已過期，請重新登入");
  return { student: row, token };
}

/* ---------------- 讀取題庫 ---------------- */

async function getWords(env) {
  const { results } = await env.DB.prepare(
    "SELECT lesson, word, zhuyin, def FROM words ORDER BY sort_order, id"
  ).all();
  return (results || []).map((r) => ({
    lesson: r.lesson, char: r.word, zhuyin: r.zhuyin, def: r.def
  }));
}

async function getContent(env) {
  const p = await env.DB.prepare(
    "SELECT id, lesson, title, passage FROM passages ORDER BY sort_order, id"
  ).all();
  const passages = p.results || [];
  if (passages.length === 0) return [];
  const q = await env.DB.prepare(
    "SELECT passage_id, type, q, options, answer, explain FROM questions ORDER BY sort_order, id"
  ).all();
  const byPassage = {};
  (q.results || []).forEach((r) => {
    let options = [];
    try { options = JSON.parse(r.options || "[]"); } catch (e) { options = []; }
    (byPassage[r.passage_id] = byPassage[r.passage_id] || []).push({
      type: r.type || "文意",
      q: r.q,
      options,
      answer: r.answer,
      explain: r.explain || ""
    });
  });
  return passages.map((it) => ({
    lesson: it.lesson,
    title: it.title,
    passage: it.passage,
    questions: byPassage[it.id] || []
  }));
}

async function getIdioms(env) {
  const { results } = await env.DB.prepare(
    "SELECT lesson, idiom, bo, meaning, synonym, antonym FROM idioms ORDER BY sort_order, id"
  ).all();
  return (results || []).map((r) => ({
    lesson: r.lesson,
    idiom: r.idiom,
    bo: r.bo,
    meaning: r.meaning,
    synonym: r.synonym || "",
    antonym: r.antonym || ""
  }));
}

async function getAll(env) {
  const [words, content, idioms] = await Promise.all([
    getWords(env), getContent(env), getIdioms(env)
  ]);
  return {
    app: "國語月考複習樂園",
    savedAt: new Date().toISOString(),
    words, content, idioms
  };
}

/* ---------------- 寫入題庫 ---------------- */

async function replaceWords(env, words) {
  const stmts = [env.DB.prepare("DELETE FROM words")];
  (Array.isArray(words) ? words : []).forEach((w, i) => {
    stmts.push(env.DB.prepare(
      "INSERT INTO words (lesson, word, zhuyin, def, sort_order) VALUES (?, ?, ?, ?, ?)"
    ).bind(
      String(w.lesson || ""), String(w.char || w.word || ""),
      String(w.zhuyin || ""), String(w.def || ""), i
    ));
  });
  await env.DB.batch(stmts);
}

async function replaceIdioms(env, idioms) {
  const stmts = [env.DB.prepare("DELETE FROM idioms")];
  (Array.isArray(idioms) ? idioms : []).forEach((it, i) => {
    stmts.push(env.DB.prepare(
      "INSERT INTO idioms (lesson, idiom, bo, meaning, synonym, antonym, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      String(it.lesson || ""), String(it.idiom || ""), String(it.bo || ""),
      String(it.meaning || ""), String(it.synonym || ""), String(it.antonym || ""), i
    ));
  });
  await env.DB.batch(stmts);
}

async function replaceContent(env, content) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM questions"),
    env.DB.prepare("DELETE FROM passages")
  ]);
  const arr = Array.isArray(content) ? content : [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const res = await env.DB.prepare(
      "INSERT INTO passages (lesson, title, passage, sort_order) VALUES (?, ?, ?, ?)"
    ).bind(
      String(item.lesson || ""), String(item.title || ""), String(item.passage || ""), i
    ).run();
    const pid = res.meta && res.meta.last_row_id;
    const qs = Array.isArray(item.questions) ? item.questions : [];
    if (qs.length && pid) {
      await env.DB.batch(qs.map((qq, qi) => env.DB.prepare(
        "INSERT INTO questions (passage_id, type, q, options, answer, explain, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        pid, String(qq.type || "文意"), String(qq.q || ""),
        JSON.stringify(Array.isArray(qq.options) ? qq.options : []),
        Number(qq.answer) || 0, String(qq.explain || ""), qi
      )));
    }
  }
}

async function replaceAll(env, body) {
  if (!body || typeof body !== "object") throw httpError(400, "內容格式錯誤");
  if ("words" in body) await replaceWords(env, body.words);
  if ("content" in body) await replaceContent(env, body.content);
  if ("idioms" in body) await replaceIdioms(env, body.idioms);
}

/* ---------------- 路由 ---------------- */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    try {
      /* ========== 公開端點 ========== */

      if (path === "/api/health" && method === "GET") {
        return json({ ok: true, service: "exam-api" });
      }

      if (path === "/api/banks" && method === "GET") return json(await getAll(env));
      if (path === "/api/words" && method === "GET") return json(await getWords(env));
      if (path === "/api/content" && method === "GET") return json(await getContent(env));
      if (path === "/api/idioms" && method === "GET") return json(await getIdioms(env));

      if (path === "/api/ranking" && method === "GET") {
        const teacherToken = (request.headers.get("x-teacher-token") || "").trim();
        const studentToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
          || (request.headers.get("x-student-token") || "").trim();
        let className = null;
        if (teacherToken) {
          const ctx = await requireTeacher(request, env);
          className = ctx.teacher.className;
        } else if (studentToken) {
          const ctx = await requireStudent(request, env);
          className = ctx.student.className;
        } else {
          throw httpError(401, "未登入：請先登入後查看排名");
        }
        let queryStr = "SELECT s.seat, s.class_name, COUNT(a.id) AS total, SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END) AS correct FROM students s LEFT JOIN attempts a ON a.student_id = s.id WHERE 1=1";
        const params = [];
        if (className && String(className).trim() !== "") {
          queryStr += " AND LOWER(TRIM(s.class_name)) = LOWER(TRIM(?))";
          params.push(String(className).trim());
        }
        queryStr += " GROUP BY s.id, s.seat, s.class_name ORDER BY correct DESC, CAST(s.seat AS INTEGER) ASC";
        const rows = await env.DB.prepare(queryStr).bind(...params).all();
        return json({ ranking: rows.results || [] });
      }

      /* ========== 老師寫入端點 ========== */

      if (path === "/api/banks" && method === "PUT") {
        const ctx = await requireTeacher(request, env);
        await replaceAll(env, await request.json());
        return json({ ok: true, savedAt: new Date().toISOString() });
      }
      if (path === "/api/words" && method === "PUT") {
        await requireTeacher(request, env);
        await replaceWords(env, await request.json());
        return json({ ok: true });
      }
      if (path === "/api/content" && method === "PUT") {
        await requireTeacher(request, env);
        await replaceContent(env, await request.json());
        return json({ ok: true });
      }
      if (path === "/api/idioms" && method === "PUT") {
        await requireTeacher(request, env);
        await replaceIdioms(env, await request.json());
        return json({ ok: true });
      }

      /* ========== 老師認證 ========== */

      if (path === "/api/teacher/login" && method === "POST") {
        const b = await request.json();
        const username = String((b && b.username) || "").trim();
        const password = String((b && b.password) || "");
        if (!username || !password) throw httpError(400, "請輸入帳號與密碼");
        const t = await env.DB.prepare(
          "SELECT id, username, name, class_name, password_salt, password_hash FROM teachers WHERE username = ?"
        ).bind(username).first();
        if (!t || t.password_hash === "") throw httpError(401, "帳號或密碼錯誤");
        const hash = await hashPassword(password, t.password_salt);
        if (hash !== t.password_hash) throw httpError(401, "帳號或密碼錯誤");
        const token = randomHex(24);
        await env.DB.prepare(
          "INSERT INTO teacher_sessions (token, teacher_id, created_at, expires_at) VALUES (?, ?, datetime('now'), datetime('now', '+30 days'))"
        ).bind(token, t.id).run();
        return json({ token, teacher: { id: t.id, username: t.username, name: t.name, className: t.class_name } });
      }
      if (path === "/api/teacher/login" && method === "GET") {
        return json({ ok: true, message: "請使用 POST 登入" });
      }

      /* ========== AI 設定與伺服器端代理 ========== */

      if (path === "/api/ai/settings" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        const { results } = await env.DB.prepare(
          "SELECT provider, api_key, model, updated_at FROM ai_settings WHERE teacher_id = ? ORDER BY provider"
        ).bind(ctx.teacher.id).all();
        return json({
          settings: (results || []).map((r) => ({
            provider: r.provider,
            hasKey: !!r.api_key,
            model: r.model,
            updatedAt: r.updated_at
          }))
        });
      }
      if (path === "/api/ai/settings" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const provider = String((b && b.provider) || "").trim();
        const apiKey = String((b && b.apiKey) || "").trim();
        const model = String((b && b.model) || "").trim();
        if (!AI_PROVIDERS[provider]) throw httpError(400, "不支援的 AI 提供者：" + provider);
        if (!apiKey) throw httpError(400, "請貼上 API 金鑰");
        if (!isValidAISettingsShape(b)) throw httpError(400, "內容格式錯誤");
        await env.DB.prepare(
          "INSERT INTO ai_settings (teacher_id, provider, api_key, model, updated_at) VALUES (?, ?, ?, ?, datetime('now')) " +
          "ON CONFLICT(teacher_id, provider) DO UPDATE SET api_key = excluded.api_key, model = excluded.model, updated_at = datetime('now')"
        ).bind(ctx.teacher.id, provider, apiKey, model).run();
        return json({ ok: true, provider });
      }
      if (path === "/api/ai/test" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const provider = String((b && b.provider) || "").trim();
        const model = String((b && b.model) || "").trim();
        if (!AI_PROVIDERS[provider]) throw httpError(400, "不支援的 AI 提供者：" + provider);
        /* 用一句話測連線，避免燒太多額度 */
        const reply = await aiChat(env, ctx.teacher.id, provider, model, "請回覆兩個字：成功", "你是一位國小國語老師。", 0);
        return json({ ok: true, model: model || null, peek: String(reply || "").slice(0, 20) });
      }
      if (path === "/api/ai/chat" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const provider = String((b && b.provider) || "").trim();
        const model = String((b && b.model) || "").trim();
        const prompt = String((b && b.prompt) || "").trim();
        const system = String((b && b.system) || "");
        if (!prompt) throw httpError(400, "缺少題目內容");
        const text = await aiChat(env, ctx.teacher.id, provider, model, prompt, system || undefined, b && b.temperature);
        return json({ ok: true, text });
      }

      if (path === "/api/teacher/logout" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        await env.DB.prepare("DELETE FROM teacher_sessions WHERE token = ?").bind(ctx.token).run();
        return json({ ok: true });
      }
      if (path === "/api/teacher/me" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        return json({ teacher: ctx.teacher });
      }
      if (path === "/api/teacher/class" && method === "PUT") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const className = String((b && b.className) || "").trim();
        if (!className) throw httpError(400, "班級名稱不能為空");
        const oldName = ctx.teacher.className;
        const moveStudents = !!(b && b.moveStudents) && oldName !== className;
        const stmts = [
          env.DB.prepare("UPDATE teachers SET class_name = ? WHERE id = ?").bind(className, ctx.teacher.id)
        ];
        if (moveStudents) {
          stmts.push(
            env.DB.prepare("UPDATE students SET class_name = ? WHERE class_name = ?").bind(className, oldName)
          );
        }
        await env.DB.batch(stmts);
        return json({ ok: true, className, previousClassName: oldName, movedStudents: moveStudents });
      }
      if (path === "/api/teachers" && method === "GET") {
        await requireTeacher(request, env);
        const rows = await env.DB.prepare(
          "SELECT id, username, name, class_name FROM teachers ORDER BY id"
        ).all();
        return json({
          teachers: (rows.results || []).map((t) => ({
            id: t.id, username: t.username, name: t.name, className: t.class_name
          }))
        });
      }
      if (path === "/api/teacher/password" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const oldPwd = String((b && b.oldPassword) || "");
        const newPwd = String((b && b.password) || "");
        if (!oldPwd || !newPwd) throw httpError(400, "請輸入舊密碼與新密碼");
        const t = await env.DB.prepare(
          "SELECT password_salt, password_hash FROM teachers WHERE id = ?"
        ).bind(ctx.teacher.id).first();
        if (!t) throw httpError(404, "老師不存在");
        const oldHash = await hashPassword(oldPwd, t.password_salt);
        if (oldHash !== t.password_hash) throw httpError(401, "舊密碼錯誤");
        const newSalt = randomHex(16);
        await env.DB.prepare(
          "UPDATE teachers SET password_salt = ?, password_hash = ? WHERE id = ?"
        ).bind(newSalt, await hashPassword(newPwd, newSalt), ctx.teacher.id).run();
        return json({ ok: true });
      }

      /* ========== 學生認證 ========== */

      if (path === "/api/student/login" && method === "POST") {
        const b = await request.json();
        const seat = String((b && b.seat) || "").trim();
        const password = String((b && b.password) || "");
        if (!seat || !password) throw httpError(400, "請輸入座號與密碼");
        const s = await env.DB.prepare(
          "SELECT id, seat, name, password_salt, password_hash FROM students WHERE seat = ?"
        ).bind(seat).first();
        if (!s) throw httpError(401, "座號或密碼錯誤");
        const hash = await hashPassword(password, s.password_salt);
        if (hash !== s.password_hash) throw httpError(401, "座號或密碼錯誤");
        const token = randomHex(24);
        await env.DB.prepare(
          "INSERT INTO sessions (token, student_id, created_at, expires_at) VALUES (?, ?, datetime('now'), datetime('now', '+30 days'))"
        ).bind(token, s.id).run();
        return json({ token, student: { id: s.id, seat: s.seat, name: s.name } });
      }
      if (path === "/api/student/login" && method === "GET") {
        return json({ ok: true, message: "請使用 POST 登入" });
      }
      if (path === "/api/student/logout" && method === "POST") {
        const ctx = await requireStudent(request, env);
        await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(ctx.token).run();
        return json({ ok: true });
      }
      if (path === "/api/student/password" && method === "POST") {
        const ctx = await requireStudent(request, env);
        const b = await request.json();
        const oldPwd = String((b && b.oldPassword) || "");
        const newPwd = String((b && b.password) || "");
        if (!oldPwd || !newPwd) throw httpError(400, "請輸入舊密碼與新密碼");
        const s = await env.DB.prepare(
          "SELECT password_salt, password_hash FROM students WHERE id = ?"
        ).bind(ctx.student.id).first();
        if (!s) throw httpError(404, "學生不存在");
        const oldHash = await hashPassword(oldPwd, s.password_salt);
        if (oldHash !== s.password_hash) throw httpError(401, "舊密碼錯誤");
        const newSalt = randomHex(16);
        await env.DB.prepare(
          "UPDATE students SET password_salt = ?, password_hash = ? WHERE id = ?"
        ).bind(newSalt, await hashPassword(newPwd, newSalt), ctx.student.id).run();
        return json({ ok: true });
      }
      if (path === "/api/student/me" && method === "GET") {
        const ctx = await requireStudent(request, env);
        return json({ student: ctx.student });
      }

      /* ========== 學生作答 ========== */

      if (path === "/api/attempts" && method === "POST") {
        const ctx = await requireStudent(request, env);
        const b = await request.json();
        await env.DB.prepare(
          "INSERT INTO attempts (student_id, bank, lesson, mode, item_key, prompt, chosen, correct) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          ctx.student.id,
          String((b && b.bank) || ""), String((b && b.lesson) || ""), String((b && b.mode) || ""),
          String((b && b.item_key) || b.itemKey || ""), String((b && b.prompt) || ""), String((b && b.chosen) || ""),
          (b && b.correct) ? 1 : 0
        ).run();
        return json({ ok: true });
      }
      if (path === "/api/attempts/me" && method === "GET") {
        const ctx = await requireStudent(request, env);
        const q = new URL(request.url);
        const wrongOnly = q.searchParams.get("wrong") === "1";
        const rows = await env.DB.prepare(
          "SELECT bank, lesson, mode, item_key, prompt, chosen, correct, answered_at " +
          "FROM attempts WHERE student_id = ?" + (wrongOnly ? " AND correct = 0" : "") +
          " ORDER BY answered_at DESC"
        ).bind(ctx.student.id).all();
        return json({ attempts: rows.results || [] });
      }

      /* ========== 學生管理（老師權限，過濾班級） ========== */

      if (path === "/api/students" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        const rows = await env.DB.prepare(
          "SELECT s.id, s.seat, s.name, s.class_name, s.teacher_id, " +
          "t.name AS teacher_name, t.username AS teacher_username, " +
          "s.created_at AS createdAt, " +
          "(SELECT COUNT(*) FROM attempts a WHERE a.student_id = s.id) AS total, " +
          "(SELECT SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END) FROM attempts a WHERE a.student_id = s.id) AS correct " +
          "FROM students s LEFT JOIN teachers t ON t.id = s.teacher_id " +
          "WHERE s.class_name = ? ORDER BY CAST(s.seat AS INTEGER), s.seat"
        ).bind(ctx.teacher.className).all();
        return json({ students: rows.results || [] });
      }
      if (path === "/api/students" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const defaultPassword = String((b && b.defaultPassword) || "");
        const arr = Array.isArray(b && b.students) ? b.students : (Array.isArray(b && b.list) ? b.list : []);
        const stmts = [];
        for (const it of arr) {
          const seat = String((it && it.seat) || "").trim();
          const name = String((it && it.name) || "");
          const pass = String((it && it.password) || defaultPassword);
          if (!seat || !pass) continue;
          const teacherId = it && it.teacherId ? Number(it.teacherId) : ctx.teacher.id;
          const salt = randomHex(16);
          stmts.push(env.DB.prepare(
            "INSERT INTO students (seat, name, password_salt, password_hash, class_name, teacher_id) VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(seat) DO UPDATE SET name = excluded.name, password_salt = excluded.password_salt, " +
            "password_hash = excluded.password_hash, class_name = excluded.class_name, teacher_id = excluded.teacher_id"
          ).bind(seat, name, salt, await hashPassword(pass, salt), ctx.teacher.className, teacherId));
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true, imported: stmts.length });
      }
      if (path === "/api/students/password" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const seat = String((b && b.seat) || "").trim();
        const pass = String((b && b.password) || "");
        if (!seat || !pass) throw httpError(400, "請提供座號與新密碼");
        // 確認該學生屬於本班
        const s = await env.DB.prepare(
          "SELECT id FROM students WHERE seat = ? AND class_name = ?"
        ).bind(seat, ctx.teacher.className).first();
        if (!s) throw httpError(403, "該學生不屬於您的班級");
        const salt = randomHex(16);
        await env.DB.prepare(
          "UPDATE students SET password_salt = ?, password_hash = ? WHERE seat = ?"
        ).bind(salt, await hashPassword(pass, salt), seat).run();
        return json({ ok: true });
      }
      if (path === "/api/students/claim" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const res = await env.DB.prepare(
          "UPDATE students SET class_name = ?, teacher_id = COALESCE(teacher_id, ?) " +
          "WHERE class_name IS NULL OR TRIM(class_name) = ''"
        ).bind(ctx.teacher.className, ctx.teacher.id).run();
        return json({ ok: true, claimed: (res.meta && res.meta.changes) || 0, className: ctx.teacher.className });
      }
      if (path === "/api/students/assign-teacher" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const seats = (Array.isArray(b && b.seats) ? b.seats : []).map(String).filter(Boolean);
        const teacherId = Number(b && b.teacherId) || 0;
        if (!seats.length) throw httpError(400, "請先勾選學生");
        if (!teacherId) throw httpError(400, "請選擇要指定的老師");
        const t = await env.DB.prepare("SELECT id FROM teachers WHERE id = ?").bind(teacherId).first();
        if (!t) throw httpError(404, "找不到該老師");
        const qs = seats.map(() => "?").join(",");
        const res = await env.DB.prepare(
          "UPDATE students SET teacher_id = ? WHERE seat IN (" + qs + ") AND class_name = ?"
        ).bind(teacherId, ...seats, ctx.teacher.className).run();
        return json({ ok: true, updated: (res.meta && res.meta.changes) || 0 });
      }
      if (path === "/api/students" && method === "DELETE") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const seats = (Array.isArray(b && b.seats) ? b.seats : []).map(String).filter(Boolean);
        if (seats.length) {
          const qs = seats.map(() => "?").join(",");
          await env.DB.prepare(
            "DELETE FROM students WHERE seat IN (" + qs + ") AND class_name = ?"
          ).bind(...seats, ctx.teacher.className).run();
        }
        return json({ ok: true });
      }

      /* ========== 統計（老師權限，過濾班級） ========== */

      if (path === "/api/stats" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        const rows = await env.DB.prepare(
          "SELECT a.bank, a.lesson, a.mode, COUNT(*) AS total, " +
          "SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END) AS correct " +
          "FROM attempts a JOIN students s ON s.id = a.student_id " +
          "WHERE s.class_name = ? GROUP BY a.bank, a.lesson, a.mode ORDER BY a.bank, a.lesson"
        ).bind(ctx.teacher.className).all();
        return json({ stats: rows.results || [] });
      }

      return json({ error: "not_found", path }, 404);
    } catch (e) {
      return json({ error: (e && e.message) || String(e) }, (e && e.status) || 500);
    }
  }
};
