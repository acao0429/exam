/* ============================================================
   雲端題庫共用邏輯（學生端與老師後台共用）
   - 讀取：GET {apiBase}/api/banks        （公開，不需 token）
   - 寫入：PUT {apiBase}/api/banks        （需 admin token）
   - 學生端：hybrid 先抓雲端並快取到 localStorage，失敗就用本機
   - 老師後台：pushAll() 把三份題庫整批覆蓋上雲端

   apiBase 來自 js/app-config.js 的 window.APP_CONFIG.apiBase。
   留空時所有雲端功能自動停用，行為與原本相同。
   ============================================================ */

(function () {
  "use strict";

  const TOKEN_KEY = "exam_admin_token";
  const WORD_KEY = "exam_word_bank_v1";
  const CONTENT_KEY = "exam_passage_bank_v1";
  const IDIOM_KEY = "exam_idiom_bank_v1";

  function base() {
    const cfg = (typeof window !== "undefined" && window.APP_CONFIG) || {};
    return String(cfg.apiBase || "").replace(/\/+$/, "");
  }

  function enabled() { return base() !== ""; }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 忽略 */ }
  }

  function saveLocal(key, arr, savedKey) {
    if (!Array.isArray(arr)) return;
    localStorage.setItem(key, JSON.stringify(arr));
    localStorage.setItem(savedKey, "1");
  }

  async function fetchBanks() {
    if (!enabled()) return null;
    const res = await fetch(base() + "/api/banks", {
      headers: { accept: "application/json" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  /* 學生端：把雲端題庫寫進本機快取。成功回傳 true，失敗/未啟用回傳 false。 */
  async function hydrateLocalFromCloud() {
    try {
      const data = await fetchBanks();
      if (!data) return false;
      saveLocal(WORD_KEY, data.words, "exam_word_bank_saved");
      saveLocal(CONTENT_KEY, data.content, "exam_passage_bank_saved");
      saveLocal(IDIOM_KEY, data.idioms, "exam_idiom_bank_saved");
      return true;
    } catch (e) {
      if (window.console) console.warn("雲端題庫載入失敗，改用本機題庫：", e.message);
      return false;
    }
  }

  /* 老師後台：整批覆蓋雲端題庫。data 需含 words / content / idioms。 */
  async function pushAll(data) {
    if (!enabled()) throw new Error("尚未設定 API 網址（js/app-config.js 的 apiBase）");
    const token = getToken();
    if (!token) throw new Error("請先輸入並儲存 admin token");
    const res = await fetch(base() + "/api/banks", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error || ""; } catch (e) { /* 忽略 */ }
      throw new Error("HTTP " + res.status + (msg ? "：" + msg : ""));
    }
    return res.json();
  }

  window.ExamCloud = {
    enabled,
    apiBase: base,
    getToken,
    setToken,
    fetchBanks,
    hydrateLocalFromCloud,
    pushAll
  };
})();
