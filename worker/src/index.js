/* ============================================================
   exam-api：國語月考複習樂園 API（Cloudflare Worker + D1）

   ── 權限分級 ──────────────────────────────────────────────
   teacher：讀寫題庫、用 AI 生成題庫、管理「自己班」的學生
   admin  ：teacher 的全部能力，另外可跨班管理學生、
            建立／停用老師帳號、維護班級、匯出與還原備份

   ── 公開端點（學生端用）──────────────────────────────────
   GET  /api/health
   GET  /api/banks        → { app, savedAt, words, content, idioms }
   GET  /api/words        → [{ lesson, char, zhuyin, def }]
   GET  /api/content      → [{ lesson, title, passage, questions:[...] }]
   GET  /api/idioms       → [{ lesson, idiom, bo, meaning, synonym, antonym }]

   ── 雙身分（依 token 判斷）───────────────────────────────
   GET  /api/ranking      → 本班排名（學生看自己班、老師看自己班；
                            admin 可用 ?classId= 或 ?all=1 看全部）

   ── 老師端點（teacher token）────────────────────────────
   POST /api/teacher/login | /logout | /password
   GET  /api/teacher/me
   PUT  /api/teacher/class          → 改自己的班級
   GET  /api/teachers               → 老師清單（admin 看得到帳號與角色）
   GET  /api/classes                → 班級清單
   PUT  /api/words | /content | /idioms | /banks   → 覆蓋題庫
   GET  /api/students               → 學生（?classId= / ?all=1 需 admin）
   POST /api/students               → 建檔／更新
   POST /api/students/password      → 重設密碼（跨班需 admin）
   POST /api/students/claim         → 認領未分班學生
   POST /api/students/assign-teacher→ 指定學生所屬老師
   DELETE /api/students             → 刪學生
   GET  /api/stats                  → 本班作答統計
   POST /api/ai/chat | /ai/test     → 伺服器端 AI 代理（用共用金鑰）

   ── 僅 admin ─────────────────────────────────────────────
   GET  /api/ai/settings            → AI 共用設定
   POST /api/ai/settings            → 存 AI 共用金鑰
   POST /api/teachers               → 建立老師帳號
   PUT  /api/teachers/:id           → 改姓名／班級／角色／停用
   POST /api/teachers/:id/password  → 直接重設老師密碼
   DELETE /api/teachers/:id         → 停用帳號並清除其登入
   POST /api/classes                → 新增班級
   PUT  /api/classes/:id            → 改班級名稱
   DELETE /api/classes/:id          → 刪除空班級
   GET  /api/backup                 → 匯出完整備份（單一備份出口）
   POST /api/backup/restore         → 由備份還原

   ── 學生端點（student token）─────────────────────────────
   POST /api/student/login | /logout | /password
   GET  /api/student/me
   POST /api/attempts
   GET  /api/attempts/me
   ============================================================ */

/* ---------------- CORS：只開放實際使用的來源 ---------------- */

const ALLOWED_ORIGINS = [
  "https://exam-egg.pages.dev",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];

function corsHeaders(request) {
  const origin = (request.headers.get("origin") || "").trim();
  const allow = ALLOWED_ORIGINS.indexOf(origin) >= 0 ? origin : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-teacher-token, x-student-token",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function json(request, data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, corsHeaders(request))
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

const MIN_PWD = 6;

function checkNewPassword(pwd) {
  if (!pwd || String(pwd).length < MIN_PWD) {
    throw httpError(400, "密碼至少要 " + MIN_PWD + " 個字");
  }
  return String(pwd);
}

/* ---------------- AI 提供者設定（全站共用） ---------------- */

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

/* 共用金鑰：所有老師共用同一份 ai_settings */
async function aiChat(env, provider, model, prompt, system, temperature) {
  const info = AI_PROVIDERS[provider];
  if (!info) throw httpError(400, "不支援的 AI 提供者：" + provider);

  const row = await env.DB.prepare(
    "SELECT api_key, model FROM ai_settings WHERE provider = ?"
  ).bind(provider).first();
  if (!row || !row.api_key) {
    throw httpError(400, `尚未設定 ${info.label} 的 API 金鑰，請聯絡管理員在「🤖 AI 設定」貼上金鑰。`);
  }

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

/* ---------------- 身分驗證 ---------------- */

function bearerOf(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

async function requireTeacher(request, env) {
  const token = bearerOf(request) || (request.headers.get("x-teacher-token") || "").trim();
  if (!token) throw httpError(401, "未登入：請先登入老師帳號");
  const row = await env.DB.prepare(
    "SELECT t.id, t.username, t.name, t.class_name, t.class_id, t.role, t.is_active, ts.token " +
    "FROM teacher_sessions ts JOIN teachers t ON t.id = ts.teacher_id " +
    "WHERE ts.token = ? AND ts.expires_at > datetime('now')"
  ).bind(token).first();
  if (!row) throw httpError(401, "登入已過期，請重新登入");
  if (!row.is_active) throw httpError(403, "此帳號已被停用，請聯絡管理員");
  return {
    teacher: {
      id: row.id,
      username: row.username,
      name: row.name,
      classId: row.class_id,
      className: row.class_name,
      role: row.role || "teacher",
      isAdmin: row.role === "admin"
    },
    token: row.token
  };
}

function requireAdmin(ctx) {
  if (!ctx || !ctx.teacher || !ctx.teacher.isAdmin) {
    throw httpError(403, "此功能只有管理員（admin）可以使用");
  }
}

async function requireStudent(request, env) {
  const token = bearerOf(request) || (request.headers.get("x-student-token") || "").trim();
  if (!token) throw httpError(401, "學生尚未登入");
  const row = await env.DB.prepare(
    "SELECT s.id, s.seat, s.name, s.class_name AS className, s.class_id AS classId " +
    "FROM sessions ss JOIN students s ON s.id = ss.student_id " +
    "WHERE ss.token = ? AND ss.expires_at > datetime('now')"
  ).bind(token).first();
  if (!row) throw httpError(401, "登入已過期，請重新登入");
  return { student: row, token };
}

/* ---------------- 班級 ---------------- */

/* 建立老師時決定班級：優先 classId，其次 className，都沒有就沿用建立者自己的班 */
async function resolveNewTeacherClassId(env, body, creatorCtx) {
  if (body && body.classId) {
    const id = Number(body.classId);
    const row = await env.DB.prepare("SELECT id FROM classes WHERE id = ?").bind(id).first();
    if (!row) throw httpError(400, "找不到指定的班級");
    return id;
  }
  if (body && body.className) return await ensureClassId(env, body.className);
  return creatorCtx.teacher.classId;
}

/* 解析「要看哪一班」：admin 可用 ?classId=N 或 ?all=1；其他人只能看自己班 */
function resolveClassScope(ctx, url) {
  const q = url.searchParams;
  if (q.get("all") === "1") {
    requireAdmin(ctx);
    return { all: true, classId: null };
  }
  const raw = q.get("classId");
  if (raw !== null && raw !== "") {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, "班級代碼不正確");
    if (!ctx.teacher.isAdmin && id !== ctx.teacher.classId) {
      throw httpError(403, "無權查看其他班級");
    }
    return { all: false, classId: id };
  }
  return { all: false, classId: ctx.teacher.classId };
}

/* 撈班級 id，不存在就自動建立（trigger 也會做，但顯式處理回傳值） */
async function ensureClassId(env, className) {
  const name = String(className || "").trim();
  if (!name) return null;
  await env.DB.prepare("INSERT OR IGNORE INTO classes (name) VALUES (?)").bind(name).run();
  const row = await env.DB.prepare("SELECT id FROM classes WHERE name = ?").bind(name).first();
  return row ? row.id : null;
}

async function classNameOf(env, classId) {
  if (!classId) return "";
  const row = await env.DB.prepare("SELECT name FROM classes WHERE id = ?").bind(classId).first();
  return row ? row.name : "";
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

/* ---------------- 備份 / 還原 ---------------- */

async function buildBackup(env, actor) {
  const [classes, teachers, students, words, content, idioms, counts] = await Promise.all([
    env.DB.prepare("SELECT id, name, created_at FROM classes ORDER BY id").all(),
    env.DB.prepare(
      "SELECT id, username, name, password_salt, password_hash, role, class_id, is_active, created_at " +
      "FROM teachers ORDER BY id"
    ).all(),
    env.DB.prepare(
      "SELECT id, seat, name, password_salt, password_hash, class_id, teacher_id, created_at " +
      "FROM students ORDER BY CAST(seat AS INTEGER), seat"
    ).all(),
    getWords(env),
    getContent(env),
    getIdioms(env),
    env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM students) students, (SELECT COUNT(*) FROM teachers) teachers, " +
      "(SELECT COUNT(*) FROM words) words, (SELECT COUNT(*) FROM idioms) idioms, " +
      "(SELECT COUNT(*) FROM passages) passages, (SELECT COUNT(*) FROM questions) questions, " +
      "(SELECT COUNT(*) FROM attempts) attempts"
    ).first()
  ]);

  await env.DB.prepare(
    "INSERT INTO backup_log (action, actor_id, actor_name, detail) VALUES ('export', ?, ?, ?)"
  ).bind(actor ? actor.id : null, actor ? actor.name : "", JSON.stringify(counts || {})).run();

  return {
    app: "國語月考複習樂園",
    kind: "full-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    exportedBy: actor ? actor.name : "",
    counts: counts || {},
    classes: classes.results || [],
    teachers: teachers.results || [],
    students: students.results || [],
    words,
    content,
    idioms
    /* 注意：attempts（作答紀錄）不納入備份，體量大且可重新累積 */
  };
}

async function restoreBackup(env, body, actor) {
  if (!body || typeof body !== "object") throw httpError(400, "備份檔格式錯誤");
  const hasAccounts = Array.isArray(body.teachers) || Array.isArray(body.students);
  if (!Array.isArray(body.words) && !Array.isArray(body.idioms) && !Array.isArray(body.content) && !hasAccounts) {
    throw httpError(400, "備份檔看起來不是有效的備份（找不到任何資料）");
  }

  const summary = {};

  if (Array.isArray(body.classes) && body.classes.length) {
    await env.DB.batch(body.classes.map((c) =>
      env.DB.prepare("INSERT OR IGNORE INTO classes (name) VALUES (?)").bind(String(c.name || "").trim())
    ));
    summary.classes = body.classes.length;
  }

  /* 帳號：先清 teacher_sessions 再重建 teachers，避免 FK 與重複 id */
  if (Array.isArray(body.teachers) && body.teachers.length) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM teacher_sessions"),
      env.DB.prepare("DELETE FROM teachers")
    ]);
    for (const t of body.teachers) {
      const classId = await resolveBackupClassId(env, t);
      await env.DB.prepare(
        "INSERT INTO teachers (id, username, name, password_salt, password_hash, role, class_id, is_active, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))"
      ).bind(
        Number(t.id) || null,
        String(t.username || "").trim(),
        String(t.name || ""),
        String(t.password_salt || ""),
        String(t.password_hash || ""),
        t.role === "admin" ? "admin" : "teacher",
        classId,
        t.is_active === 0 || t.is_active === false ? 0 : 1,
        t.created_at || null
      ).run();
    }
    summary.teachers = body.teachers.length;
  }

  if (Array.isArray(body.students) && body.students.length) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions"),
      env.DB.prepare("DELETE FROM students")
    ]);
    for (const s of body.students) {
      const classId = await resolveBackupClassId(env, s);
      await env.DB.prepare(
        "INSERT INTO students (id, seat, name, password_salt, password_hash, class_id, teacher_id, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))"
      ).bind(
        Number(s.id) || null,
        String(s.seat || "").trim(),
        String(s.name || ""),
        String(s.password_salt || ""),
        String(s.password_hash || ""),
        classId,
        s.teacher_id ? Number(s.teacher_id) : null,
        s.created_at || null
      ).run();
    }
    summary.students = body.students.length;
  }

  if (Array.isArray(body.words)) { await replaceWords(env, body.words); summary.words = body.words.length; }
  if (Array.isArray(body.idioms)) { await replaceIdioms(env, body.idioms); summary.idioms = body.idioms.length; }
  if (Array.isArray(body.content)) { await replaceContent(env, body.content); summary.passages = body.content.length; }

  await env.DB.prepare(
    "INSERT INTO backup_log (action, actor_id, actor_name, detail) VALUES ('restore', ?, ?, ?)"
  ).bind(actor ? actor.id : null, actor ? actor.name : "", JSON.stringify(summary)).run();

  return summary;
}

/* 備份檔可能是新版（有 class_id）也可能是舊版（只有 class_name） */
async function resolveBackupClassId(env, row) {
  if (row.class_id) return Number(row.class_id);
  if (row.class_name) return await ensureClassId(env, row.class_name);
  return null;
}

/* ---------------- 路由 ---------------- */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    try {
      /* ========== 公開端點 ========== */

      if (path === "/api/health" && method === "GET") {
        return json(request, { ok: true, service: "exam-api" });
      }

      if (path === "/api/banks" && method === "GET") return json(request, await getAll(env));
      if (path === "/api/words" && method === "GET") return json(request, await getWords(env));
      if (path === "/api/content" && method === "GET") return json(request, await getContent(env));
      if (path === "/api/idioms" && method === "GET") return json(request, await getIdioms(env));

      if (path === "/api/ranking" && method === "GET") {
        const teacherToken = (request.headers.get("x-teacher-token") || "").trim();
        const studentToken = bearerOf(request) || (request.headers.get("x-student-token") || "").trim();
        let scope = null;
        if (teacherToken) {
          const ctx = await requireTeacher(request, env);
          scope = resolveClassScope(ctx, url);
        } else if (studentToken) {
          const ctx = await requireStudent(request, env);
          /* 學生只能看自己班，不接受 classId 參數 */
          scope = { all: false, classId: ctx.student.classId };
        } else {
          throw httpError(401, "未登入：請先登入後查看排名");
        }

        let queryStr = "SELECT s.seat, s.class_name, COUNT(a.id) AS total, " +
          "SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END) AS correct " +
          "FROM students s LEFT JOIN attempts a ON a.student_id = s.id WHERE 1=1";
        const params = [];
        const urlObj = new URL(request.url);
        const period = urlObj.searchParams.get("period") || "";
        if (["day", "week", "month", "year"].includes(period)) {
          let modifier = "-365 days";
          if (period === "day") modifier = "start of day";
          else if (period === "week") modifier = "-7 days";
          else if (period === "month") modifier = "-1 month";
          else if (period === "year") modifier = "-1 year";
          queryStr += " AND (a.answered_at IS NULL OR a.answered_at >= datetime('now', ?) )";
          params.push(modifier);
        }
        if (!scope.all && scope.classId) {
          queryStr += " AND s.class_id = ?";
          params.push(scope.classId);
        }
        queryStr += " GROUP BY s.id, s.seat, s.class_name ORDER BY correct DESC, CAST(s.seat AS INTEGER) ASC";
        const rows = await env.DB.prepare(queryStr).bind(...params).all();
        return json(request, { ranking: rows.results || [] });
      }

      /* ========== 老師題庫寫入（teacher 與 admin 都可以） ========== */

      if (path === "/api/banks" && method === "PUT") {
        await requireTeacher(request, env);
        await replaceAll(env, await request.json());
        return json(request, { ok: true, savedAt: new Date().toISOString() });
      }
      if (path === "/api/words" && method === "PUT") {
        await requireTeacher(request, env);
        await replaceWords(env, await request.json());
        return json(request, { ok: true });
      }
      if (path === "/api/content" && method === "PUT") {
        await requireTeacher(request, env);
        await replaceContent(env, await request.json());
        return json(request, { ok: true });
      }
      if (path === "/api/idioms" && method === "PUT") {
        await requireTeacher(request, env);
        await replaceIdioms(env, await request.json());
        return json(request, { ok: true });
      }

      /* ========== 老師認證 ========== */

      if (path === "/api/teacher/login" && method === "POST") {
        const b = await request.json();
        const username = String((b && b.username) || "").trim();
        const password = String((b && b.password) || "");
        if (!username || !password) throw httpError(400, "請輸入帳號與密碼");
        const t = await env.DB.prepare(
          "SELECT id, username, name, class_name, class_id, role, is_active, password_salt, password_hash " +
          "FROM teachers WHERE username = ?"
        ).bind(username).first();
        if (!t || t.password_hash === "") throw httpError(401, "帳號或密碼錯誤");
        const hash = await hashPassword(password, t.password_salt);
        if (hash !== t.password_hash) throw httpError(401, "帳號或密碼錯誤");
        if (!t.is_active) throw httpError(403, "此帳號已被停用，請聯絡管理員");
        const token = randomHex(24);
        await env.DB.prepare(
          "INSERT INTO teacher_sessions (token, teacher_id, created_at, expires_at) VALUES (?, ?, datetime('now'), datetime('now', '+30 days'))"
        ).bind(token, t.id).run();
        return json(request, {
          token,
          teacher: {
            id: t.id, username: t.username, name: t.name,
            classId: t.class_id, className: t.class_name,
            role: t.role || "teacher", isAdmin: t.role === "admin"
          }
        });
      }
      if (path === "/api/teacher/login" && method === "GET") {
        return json(request, { ok: true, message: "請使用 POST 登入" });
      }

      /* ========== AI 共用設定（寫入限 admin，代理全老師可用） ========== */

      if (path === "/api/ai/settings" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        /* 老師只需知道「有沒有設定好」，不需看到金鑰內容 */
        const { results } = await env.DB.prepare(
          "SELECT provider, api_key, model, updated_at FROM ai_settings ORDER BY provider"
        ).all();
        const settings = (results || []).map((r) => ({
          provider: r.provider,
          hasKey: !!r.api_key,
          model: r.model,
          updatedAt: r.updated_at
        }));
        return json(request, { settings, canEdit: ctx.teacher.isAdmin });
      }
      if (path === "/api/ai/settings" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        requireAdmin(ctx);
        const b = await request.json();
        const provider = String((b && b.provider) || "").trim();
        const apiKey = String((b && b.apiKey) || "").trim();
        const model = String((b && b.model) || "").trim();
        if (!AI_PROVIDERS[provider]) throw httpError(400, "不支援的 AI 提供者：" + provider);
        if (!apiKey) throw httpError(400, "請貼上 API 金鑰");
        await env.DB.prepare(
          "INSERT INTO ai_settings (provider, api_key, model, updated_at) VALUES (?, ?, ?, datetime('now')) " +
          "ON CONFLICT(provider) DO UPDATE SET api_key = excluded.api_key, model = excluded.model, updated_at = datetime('now')"
        ).bind(provider, apiKey, model).run();
        return json(request, { ok: true, provider });
      }
      if (path === "/api/ai/test" && method === "POST") {
        await requireTeacher(request, env);
        const b = await request.json();
        const provider = String((b && b.provider) || "").trim();
        const model = String((b && b.model) || "").trim();
        if (!AI_PROVIDERS[provider]) throw httpError(400, "不支援的 AI 提供者：" + provider);
        const reply = await aiChat(env, provider, model, "請回覆兩個字：成功", "你是一位國小國語老師。", 0);
        return json(request, { ok: true, model: model || null, peek: String(reply || "").slice(0, 20) });
      }
      if (path === "/api/ai/chat" && method === "POST") {
        await requireTeacher(request, env);
        const b = await request.json();
        const provider = String((b && b.provider) || "").trim();
        const model = String((b && b.model) || "").trim();
        const prompt = String((b && b.prompt) || "").trim();
        const system = String((b && b.system) || "");
        if (!prompt) throw httpError(400, "缺少題目內容");
        const text = await aiChat(env, provider, model, prompt, system || undefined, b && b.temperature);
        return json(request, { ok: true, text });
      }

      if (path === "/api/teacher/logout" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        await env.DB.prepare("DELETE FROM teacher_sessions WHERE token = ?").bind(ctx.token).run();
        return json(request, { ok: true });
      }
      if (path === "/api/teacher/me" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        return json(request, { teacher: ctx.teacher });
      }
      if (path === "/api/teacher/class" && method === "PUT") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const className = String((b && b.className) || "").trim();
        if (!className) throw httpError(400, "班級名稱不能為空");
        const oldId = ctx.teacher.classId;
        const oldName = ctx.teacher.className;
        const moveStudents = !!(b && b.moveStudents) && oldName !== className;
        const newId = await ensureClassId(env, className);
        const stmts = [env.DB.prepare("UPDATE teachers SET class_id = ? WHERE id = ?").bind(newId, ctx.teacher.id)];
        if (moveStudents && oldId) {
          stmts.push(env.DB.prepare("UPDATE students SET class_id = ? WHERE class_id = ?").bind(newId, oldId));
        }
        await env.DB.batch(stmts);
        return json(request, {
          ok: true, classId: newId, className,
          previousClassName: oldName, movedStudents: moveStudents
        });
      }
      if (path === "/api/teacher/password" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const oldPwd = String((b && b.oldPassword) || "");
        const newPwd = checkNewPassword((b && b.password) || "");
        if (!oldPwd) throw httpError(400, "請輸入舊密碼與新密碼");
        const t = await env.DB.prepare(
          "SELECT password_salt, password_hash FROM teachers WHERE id = ?"
        ).bind(ctx.teacher.id).first();
        if (!t) throw httpError(404, "老師不存在");
        const oldHash = await hashPassword(oldPwd, t.password_salt);
        if (oldHash !== t.password_hash) throw httpError(401, "舊密碼錯誤");
        const newSalt = randomHex(16);
        await env.DB.batch([
          env.DB.prepare("UPDATE teachers SET password_salt = ?, password_hash = ? WHERE id = ?")
            .bind(newSalt, await hashPassword(newPwd, newSalt), ctx.teacher.id),
          /* 改密碼後作廢其他裝置的登入，保留目前這一個 */
          env.DB.prepare("DELETE FROM teacher_sessions WHERE teacher_id = ? AND token <> ?")
            .bind(ctx.teacher.id, ctx.token)
        ]);
        return json(request, { ok: true });
      }

      /* ========== 班級（讀：全體老師；寫：僅 admin） ========== */

      if (path === "/api/classes" && method === "GET") {
        await requireTeacher(request, env);
        const rows = await env.DB.prepare(
          "SELECT c.id, c.name, c.created_at, " +
          "(SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS studentCount, " +
          "(SELECT COUNT(*) FROM teachers t WHERE t.class_id = c.id) AS teacherCount " +
          "FROM classes c ORDER BY c.id"
        ).all();
        return json(request, { classes: rows.results || [] });
      }
      if (path === "/api/classes" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        requireAdmin(ctx);
        const b = await request.json();
        const name = String((b && b.name) || "").trim();
        if (!name) throw httpError(400, "班級名稱不能為空");
        const dup = await env.DB.prepare("SELECT id FROM classes WHERE name = ?").bind(name).first();
        if (dup) throw httpError(409, "此班級已存在");
        const res = await env.DB.prepare("INSERT INTO classes (name) VALUES (?)").bind(name).run();
        return json(request, { ok: true, id: res.meta && res.meta.last_row_id, name });
      }
      {
        const m = path.match(/^\/api\/classes\/(\d+)$/);
        if (m && method === "PUT") {
          const ctx = await requireTeacher(request, env);
          requireAdmin(ctx);
          const id = Number(m[1]);
          const b = await request.json();
          const name = String((b && b.name) || "").trim();
          if (!name) throw httpError(400, "班級名稱不能為空");
          const cur = await env.DB.prepare("SELECT name FROM classes WHERE id = ?").bind(id).first();
          if (!cur) throw httpError(404, "找不到此班級");
          const dup = await env.DB.prepare("SELECT id FROM classes WHERE name = ? AND id <> ?").bind(name, id).first();
          if (dup) throw httpError(409, "已有同名班級");
          await env.DB.batch([
            env.DB.prepare("UPDATE classes SET name = ? WHERE id = ?").bind(name, id),
            /* class_name 由 trigger 同步，但 trigger 只在該列被 update 時觸發，
               這裡主動帶一次確保一致 */
            env.DB.prepare("UPDATE teachers SET class_name = ? WHERE class_id = ?").bind(name, id),
            env.DB.prepare("UPDATE students SET class_name = ? WHERE class_id = ?").bind(name, id)
          ]);
          return json(request, { ok: true, id, name, previousName: cur.name });
        }
        if (m && method === "DELETE") {
          const ctx = await requireTeacher(request, env);
          requireAdmin(ctx);
          const id = Number(m[1]);
          const used = await env.DB.prepare(
            "SELECT (SELECT COUNT(*) FROM students WHERE class_id = ?) + " +
            "(SELECT COUNT(*) FROM teachers WHERE class_id = ?) AS n"
          ).bind(id, id).first();
          if (used && used.n > 0) {
            throw httpError(409, "此班級還有學生或老師，請先把他們移到別的班級");
          }
          await env.DB.prepare("DELETE FROM classes WHERE id = ?").bind(id).run();
          return json(request, { ok: true, id });
        }
      }

      /* ========== 老師帳號管理（讀：全體；寫：僅 admin） ========== */

      if (path === "/api/teachers" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        const rows = await env.DB.prepare(
          "SELECT t.id, t.username, t.name, t.class_name, t.class_id, t.role, t.is_active, t.created_at " +
          "FROM teachers t ORDER BY t.id"
        ).all();
        const isAdmin = ctx.teacher.isAdmin;
        return json(request, {
          teachers: (rows.results || []).map((t) => {
            const base = { id: t.id, name: t.name, classId: t.class_id, className: t.class_name };
            /* 非管理員不需要看到別人的帳號與角色 */
            return isAdmin
              ? Object.assign(base, {
                  username: t.username, role: t.role, isActive: !!t.is_active, createdAt: t.created_at
                })
              : base;
          })
        });
      }
      if (path === "/api/teachers" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        requireAdmin(ctx);
        const b = await request.json();
        const username = String((b && b.username) || "").trim();
        const name = String((b && b.name) || "").trim();
        const password = checkNewPassword((b && b.password) || "");
        const role = (b && b.role) === "admin" ? "admin" : "teacher";
        if (!username) throw httpError(400, "請輸入登入帳號");
        if (!name) throw httpError(400, "請輸入老師姓名");
        if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username)) {
          throw httpError(400, "登入帳號只能用 2~32 個英數、底線、點或減號");
        }
        const dup = await env.DB.prepare("SELECT id FROM teachers WHERE username = ?").bind(username).first();
        if (dup) throw httpError(409, "此登入帳號已被使用");
        const classId = await resolveNewTeacherClassId(env, b, ctx);
        const salt = randomHex(16);
        const res = await env.DB.prepare(
          "INSERT INTO teachers (username, name, password_salt, password_hash, role, class_id, is_active) " +
          "VALUES (?, ?, ?, ?, ?, ?, 1)"
        ).bind(username, name, salt, await hashPassword(password, salt), role, classId).run();
        return json(request, { ok: true, id: res.meta && res.meta.last_row_id, username, role, classId });
      }
      {
        const mPw = path.match(/^\/api\/teachers\/(\d+)\/password$/);
        if (mPw && method === "POST") {
          const ctx = await requireTeacher(request, env);
          requireAdmin(ctx);
          const id = Number(mPw[1]);
          const b = await request.json();
          const password = checkNewPassword((b && b.password) || "");
          const t = await env.DB.prepare("SELECT id FROM teachers WHERE id = ?").bind(id).first();
          if (!t) throw httpError(404, "找不到這位老師");
          const salt = randomHex(16);
          await env.DB.batch([
            env.DB.prepare("UPDATE teachers SET password_salt = ?, password_hash = ? WHERE id = ?")
              .bind(salt, await hashPassword(password, salt), id),
            /* 重設密碼＝強制該老師所有裝置重新登入 */
            env.DB.prepare("DELETE FROM teacher_sessions WHERE teacher_id = ?").bind(id)
          ]);
          return json(request, { ok: true, id });
        }

        const m = path.match(/^\/api\/teachers\/(\d+)$/);
        if (m && method === "PUT") {
          const ctx = await requireTeacher(request, env);
          const id = Number(m[1]);
          const b = await request.json();
          /* 老師只能改自己的姓名；其他欄位限管理員 */
          const isSelf = id === ctx.teacher.id;
          if (!ctx.teacher.isAdmin && !isSelf) throw httpError(403, "無權修改其他老師的資料");
          const cur = await env.DB.prepare("SELECT * FROM teachers WHERE id = ?").bind(id).first();
          if (!cur) throw httpError(404, "找不到這位老師");

          const name = b && b.name !== undefined ? String(b.name).trim() : cur.name;
          if (!name) throw httpError(400, "姓名不能為空");

          let role = cur.role;
          let classId = cur.class_id;
          let isActive = cur.is_active;
          if (ctx.teacher.isAdmin) {
            if (b && b.role !== undefined) role = b.role === "admin" ? "admin" : "teacher";
            if (b && b.classId !== undefined) {
              classId = b.classId ? Number(b.classId) : await ensureClassId(env, b.className);
            } else if (b && b.className) {
              classId = await ensureClassId(env, b.className);
            }
            if (b && b.isActive !== undefined) isActive = b.isActive ? 1 : 0;
          }
          /* 避免把最後一位管理員降級或停用，否則沒有人管得動系統 */
          if (ctx.teacher.isAdmin && cur.role === "admin" && (role !== "admin" || !isActive)) {
            const n = await env.DB.prepare(
              "SELECT COUNT(*) AS n FROM teachers WHERE role = 'admin' AND is_active = 1 AND id <> ?"
            ).bind(id).first();
            if (!n || n.n === 0) throw httpError(400, "系統至少要保留一位啟用中的管理員");
          }

          const stmts = [
            env.DB.prepare("UPDATE teachers SET name = ?, role = ?, class_id = ?, is_active = ? WHERE id = ?")
              .bind(name, role, classId, isActive, id)
          ];
          /* 停用就立刻踢掉該老師所有登入；啟用中則不動 session */
          if (!isActive) {
            stmts.push(env.DB.prepare("DELETE FROM teacher_sessions WHERE teacher_id = ?").bind(id));
          }
          await env.DB.batch(stmts);
          return json(request, { ok: true, id, name, role, classId, isActive: !!isActive });
        }
        if (m && method === "DELETE") {
          const ctx = await requireTeacher(request, env);
          requireAdmin(ctx);
          const id = Number(m[1]);
          if (id === ctx.teacher.id) throw httpError(400, "不能停用自己的帳號");
          const t = await env.DB.prepare("SELECT id, role, is_active FROM teachers WHERE id = ?").bind(id).first();
          if (!t) throw httpError(404, "找不到這位老師");
          if (t.is_active) {
            const n = await env.DB.prepare(
              "SELECT COUNT(*) AS n FROM teachers WHERE role = 'admin' AND is_active = 1 AND id <> ?"
            ).bind(id).first();
            if (t.role === "admin" && (!n || n.n === 0)) {
              throw httpError(400, "系統至少要保留一位啟用中的管理員");
            }
          }
          /* 採「停用」而非刪除，保留學生的 teacher_id 關聯與歷史 */
          await env.DB.batch([
            env.DB.prepare("UPDATE teachers SET is_active = 0 WHERE id = ?").bind(id),
            env.DB.prepare("DELETE FROM teacher_sessions WHERE teacher_id = ?").bind(id)
          ]);
          return json(request, { ok: true, id, deactivated: true });
        }
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
        return json(request, { token, student: { id: s.id, seat: s.seat, name: s.name } });
      }
      if (path === "/api/student/login" && method === "GET") {
        return json(request, { ok: true, message: "請使用 POST 登入" });
      }
      if (path === "/api/student/logout" && method === "POST") {
        const ctx = await requireStudent(request, env);
        await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(ctx.token).run();
        return json(request, { ok: true });
      }
      if (path === "/api/student/password" && method === "POST") {
        const ctx = await requireStudent(request, env);
        const b = await request.json();
        const oldPwd = String((b && b.oldPassword) || "");
        const newPwd = checkNewPassword((b && b.password) || "");
        if (!oldPwd) throw httpError(400, "請輸入舊密碼與新密碼");
        const s = await env.DB.prepare(
          "SELECT password_salt, password_hash FROM students WHERE id = ?"
        ).bind(ctx.student.id).first();
        if (!s) throw httpError(404, "學生不存在");
        const oldHash = await hashPassword(oldPwd, s.password_salt);
        if (oldHash !== s.password_hash) throw httpError(401, "舊密碼錯誤");
        const newSalt = randomHex(16);
        await env.DB.batch([
          env.DB.prepare("UPDATE students SET password_salt = ?, password_hash = ? WHERE id = ?")
            .bind(newSalt, await hashPassword(newPwd, newSalt), ctx.student.id),
          env.DB.prepare("DELETE FROM sessions WHERE student_id = ? AND token <> ?")
            .bind(ctx.student.id, ctx.token)
        ]);
        return json(request, { ok: true });
      }
      if (path === "/api/student/me" && method === "GET") {
        const ctx = await requireStudent(request, env);
        return json(request, { student: ctx.student });
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
        return json(request, { ok: true });
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
        return json(request, { attempts: rows.results || [] });
      }

      /* ========== 學生管理（老師限自己班，admin 可跨班） ========== */

      if (path === "/api/students" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        const scope = resolveClassScope(ctx, url);
        const where = scope.all ? "" : " WHERE s.class_id = ?";
        const params = scope.all ? [] : [scope.classId];
        const rows = await env.DB.prepare(
          "SELECT s.id, s.seat, s.name, s.class_name, s.class_id, s.teacher_id, " +
          "t.name AS teacher_name, t.username AS teacher_username, " +
          "s.created_at AS createdAt, " +
          "(SELECT COUNT(*) FROM attempts a WHERE a.student_id = s.id) AS total, " +
          "(SELECT SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END) FROM attempts a WHERE a.student_id = s.id) AS correct " +
          "FROM students s LEFT JOIN teachers t ON t.id = s.teacher_id" + where +
          " ORDER BY s.class_name, CAST(s.seat AS INTEGER), s.seat"
        ).bind(...params).all();
        return json(request, { students: rows.results || [], scope: scope.all ? "all" : ctx.teacher.className });
      }
      if (path === "/api/students" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const defaultPassword = String((b && b.defaultPassword) || "");
        const arr = Array.isArray(b && b.students) ? b.students : (Array.isArray(b && b.list) ? b.list : []);
        if (!arr.length) throw httpError(400, "沒有要儲存的學生資料");

        /* 目標班級：老師只能寫進自己班；admin 可指定 */
        const wantsClass = b && (b.classId !== undefined || b.className);
        let targetClassId = ctx.teacher.classId;
        if (wantsClass) {
          requireAdmin(ctx);
          targetClassId = b.classId ? Number(b.classId) : await ensureClassId(env, b.className);
          const ok = await env.DB.prepare("SELECT id FROM classes WHERE id = ?").bind(targetClassId).first();
          if (!ok) throw httpError(400, "找不到指定的班級");
        }
        const targetClassName = await classNameOf(env, targetClassId);

        const stmts = [];
        const skipped = [];
        for (const it of arr) {
          const seat = String((it && it.seat) || "").trim();
          const name = String((it && it.name) || "");
          const pass = String((it && it.password) || defaultPassword);
          if (!seat) continue;
          if (!pass) { skipped.push(seat + "（缺密碼）"); continue; }

          /* 資安關鍵：座號已存在時，必須確認對方也在目標班，
             否則任何老師都能用 upsert 覆蓋別班學生的姓名與密碼 */
          const existing = await env.DB.prepare("SELECT id, class_id FROM students WHERE seat = ?").bind(seat).first();
          if (existing && existing.class_id !== targetClassId) {
            const owner = await classNameOf(env, existing.class_id);
            skipped.push(seat + "（已存在於「" + (owner || "未分班") + "」，請先轉班或請管理員處理）");
            continue;
          }

          const teacherId = it && it.teacherId ? Number(it.teacherId) : ctx.teacher.id;
          const salt = randomHex(16);
          stmts.push(env.DB.prepare(
            "INSERT INTO students (seat, name, password_salt, password_hash, class_id, teacher_id) VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(seat) DO UPDATE SET name = excluded.name, password_salt = excluded.password_salt, " +
            "password_hash = excluded.password_hash, class_id = excluded.class_id, teacher_id = excluded.teacher_id"
          ).bind(seat, name, salt, await hashPassword(pass, salt), targetClassId, teacherId));
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json(request, {
          ok: true, imported: stmts.length, skipped,
          className: targetClassName || ctx.teacher.className
        });
      }
      if (path === "/api/students/password" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const seat = String((b && b.seat) || "").trim();
        const pass = checkNewPassword((b && b.password) || "");
        if (!seat) throw httpError(400, "請提供座號與新密碼");
        const s = await env.DB.prepare("SELECT id, class_id FROM students WHERE seat = ?").bind(seat).first();
        if (!s) throw httpError(404, "找不到這位學生");
        /* 老師只能改自己班的；admin 不受限 */
        if (!ctx.teacher.isAdmin && s.class_id !== ctx.teacher.classId) {
          throw httpError(403, "該學生不屬於您的班級");
        }
        const salt = randomHex(16);
        await env.DB.batch([
          env.DB.prepare("UPDATE students SET password_salt = ?, password_hash = ? WHERE seat = ?")
            .bind(salt, await hashPassword(pass, salt), seat),
          /* 重設密碼後，該學生其他裝置需重新登入 */
          env.DB.prepare("DELETE FROM sessions WHERE student_id = ?").bind(s.id)
        ]);
        return json(request, { ok: true });
      }
      if (path === "/api/students/claim" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        if (!ctx.teacher.classId) throw httpError(400, "您的帳號尚未設定班級，請先請管理員指定");
        const res = await env.DB.prepare(
          "UPDATE students SET class_id = ?, teacher_id = COALESCE(teacher_id, ?) " +
          "WHERE class_id IS NULL OR TRIM(class_name) = ''"
        ).bind(ctx.teacher.classId, ctx.teacher.id).run();
        return json(request, {
          ok: true, claimed: (res.meta && res.meta.changes) || 0, className: ctx.teacher.className
        });
      }
      if (path === "/api/students/assign-teacher" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const seats = (Array.isArray(b && b.seats) ? b.seats : []).map(String).filter(Boolean);
        const teacherId = Number(b && b.teacherId) || 0;
        if (!seats.length) throw httpError(400, "請先勾選學生");
        if (!teacherId) throw httpError(400, "請選擇要指定的老師");
        const t = await env.DB.prepare("SELECT id, is_active FROM teachers WHERE id = ?").bind(teacherId).first();
        if (!t) throw httpError(404, "找不到該老師");
        if (!t.is_active) throw httpError(400, "該老師帳號已停用，無法指定");
        const qs = seats.map(() => "?").join(",");
        /* 老師只能指定自己班的學生；admin 可跨班 */
        const where = ctx.teacher.isAdmin ? "seat IN (" + qs + ")" : "seat IN (" + qs + ") AND class_id = ?";
        const params = ctx.teacher.isAdmin ? [teacherId, ...seats] : [teacherId, ...seats, ctx.teacher.classId];
        const res = await env.DB.prepare(
          "UPDATE students SET teacher_id = ? WHERE " + where
        ).bind(...params).run();
        return json(request, { ok: true, updated: (res.meta && res.meta.changes) || 0 });
      }
      if (path === "/api/students" && method === "DELETE") {
        const ctx = await requireTeacher(request, env);
        const b = await request.json();
        const seats = (Array.isArray(b && b.seats) ? b.seats : []).map(String).filter(Boolean);
        if (seats.length) {
          const qs = seats.map(() => "?").join(",");
          const where = ctx.teacher.isAdmin ? "seat IN (" + qs + ")" : "seat IN (" + qs + ") AND class_id = ?";
          const params = ctx.teacher.isAdmin ? [...seats] : [...seats, ctx.teacher.classId];
          await env.DB.prepare("DELETE FROM students WHERE " + where).bind(...params).run();
        }
        return json(request, { ok: true });
      }

      /* ========== 統計 ========== */

      if (path === "/api/stats" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        const scope = resolveClassScope(ctx, url);
        const where = scope.all ? "" : " WHERE s.class_id = ?";
        const params = scope.all ? [] : [scope.classId];
        const rows = await env.DB.prepare(
          "SELECT a.bank, a.lesson, a.mode, COUNT(*) AS total, " +
          "SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END) AS correct " +
          "FROM attempts a JOIN students s ON s.id = a.student_id" + where +
          " GROUP BY a.bank, a.lesson, a.mode ORDER BY a.bank, a.lesson"
        ).bind(...params).all();
        return json(request, { stats: rows.results || [] });
      }

      /* ========== 備份中心（僅 admin） ========== */

      if (path === "/api/backup" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        requireAdmin(ctx);
        return json(request, await buildBackup(env, ctx.teacher));
      }
      if (path === "/api/backup/restore" && method === "POST") {
        const ctx = await requireTeacher(request, env);
        requireAdmin(ctx);
        const summary = await restoreBackup(env, await request.json(), ctx.teacher);
        /* 還原會清掉所有 session（teachers 被整組重建，舊 session 已無效）。
           重新替執行還原的管理員發一組 token，讓他不必重新登入就看得到結果。 */
        const stillThere = await env.DB.prepare("SELECT id FROM teachers WHERE id = ?").bind(ctx.teacher.id).first();
        let token = null;
        if (stillThere) {
          token = randomHex(24);
          await env.DB.prepare(
            "INSERT INTO teacher_sessions (token, teacher_id, created_at, expires_at) VALUES (?, ?, datetime('now'), datetime('now', '+30 days'))"
          ).bind(token, ctx.teacher.id).run();
        }
        return json(request, { ok: true, restored: summary, token });
      }
      if (path === "/api/backup/log" && method === "GET") {
        const ctx = await requireTeacher(request, env);
        requireAdmin(ctx);
        const rows = await env.DB.prepare(
          "SELECT id, action, actor_name, detail, created_at FROM backup_log ORDER BY id DESC LIMIT 50"
        ).all();
        return json(request, { log: rows.results || [] });
      }

      return json(request, { error: "not_found", path }, 404);
    } catch (e) {
      return json(request, { error: (e && e.message) || String(e) }, (e && e.status) || 500);
    }
  }
};
