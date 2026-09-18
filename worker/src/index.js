/* ============================================================
   exam-api：國語月考複習樂園 題庫 API（Cloudflare Worker + D1）

   讀取（公開，學生端用）：
     GET /api/health
     GET /api/banks          → { app, savedAt, words, content, idioms }
     GET /api/words          → [{ lesson, char, zhuyin, def }]
     GET /api/content        → [{ lesson, title, passage, questions:[...] }]
     GET /api/idioms         → [{ lesson, idiom, bo, meaning, synonym, antonym }]

   寫入（需 admin token，後台用）：
     PUT /api/banks          body 同 /api/banks GET 的格式
     PUT /api/words /api/content /api/idioms

   驗證：Authorization: Bearer <ADMIN_TOKEN> 或 X-Admin-Token: <ADMIN_TOKEN>
   ============================================================ */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-admin-token",
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

function requireAuth(request, env) {
  if (!env.ADMIN_TOKEN) throw httpError(500, "伺服器尚未設定 ADMIN_TOKEN");
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const token = bearer || (request.headers.get("x-admin-token") || "").trim();
  if (!token || token !== env.ADMIN_TOKEN) {
    throw httpError(401, "未授權：admin token 不正確");
  }
}

/* ---------------- 讀取 ---------------- */

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
    words,
    content,
    idioms
  };
}

/* ---------------- 寫入（整批覆蓋） ---------------- */

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
      if (path === "/api/health" && method === "GET") {
        return json({ ok: true, service: "exam-api" });
      }

      if (path === "/api/banks" && method === "GET") return json(await getAll(env));
      if (path === "/api/words" && method === "GET") return json(await getWords(env));
      if (path === "/api/content" && method === "GET") return json(await getContent(env));
      if (path === "/api/idioms" && method === "GET") return json(await getIdioms(env));

      if (path === "/api/banks" && method === "PUT") {
        requireAuth(request, env);
        await replaceAll(env, await request.json());
        return json({ ok: true, savedAt: new Date().toISOString() });
      }
      if (path === "/api/words" && method === "PUT") {
        requireAuth(request, env);
        await replaceWords(env, await request.json());
        return json({ ok: true });
      }
      if (path === "/api/content" && method === "PUT") {
        requireAuth(request, env);
        await replaceContent(env, await request.json());
        return json({ ok: true });
      }
      if (path === "/api/idioms" && method === "PUT") {
        requireAuth(request, env);
        await replaceIdioms(env, await request.json());
        return json({ ok: true });
      }

      return json({ error: "not_found", path }, 404);
    } catch (e) {
      return json({ error: (e && e.message) || String(e) }, (e && e.status) || 500);
    }
  }
};
