/* 後台冒煙測試：用 stub DOM 載入 admin.html 的所有 script，
   觸發 DOMContentLoaded 與各分頁 render，確認拆分後
   沒有漏元素、漏事件或未定義參考。
   執行：node tools/smoke-admin.js */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);

const problems = [];

function makeEl(id) {
  const el = {
    id,
    tagName: "DIV",
    value: "",
    textContent: "",
    _html: "",
    disabled: false,
    style: new Proxy({}, { set: () => true, get: () => "" }),
    dataset: {},
    children: [],
    options: [],
    selectedOptions: [{ textContent: "x" }],
    files: [],
    className: "",
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, force) { force ? this._s.add(c) : this._s.delete(c); }
    },
    addEventListener(type, fn) {
      (this._h ||= {});
      (this._h[type] ||= []).push(fn);
    },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { return c; },
    set innerHTML(v) { this._html = v; if (v === "") this.children = []; },
    get innerHTML() { return this._html; },
    querySelectorAll() { return []; },
    querySelector() { return makeEl("q"); },
    closest() { return null; },
    get firstChild() { return null; },
    setAttribute() {}, getAttribute() { return null; },
    setSelectionRange() {}, focus() {}, click() {}
  };
  return el;
}

const elMap = new Map(htmlIds.map(id => [id, makeEl(id)]));
const unknown = [];

const document = {
  getElementById(id) {
    if (!elMap.has(id)) {
      unknown.push(id);
      const el = makeEl(id);
      elMap.set(id, el);
      return el;
    }
    return elMap.get(id);
  },
  createElement(tag) { const e = makeEl("new-" + tag); e.tagName = tag.toUpperCase(); return e; },
  querySelectorAll(sel) {
    if (sel === ".tabbar .chip") {
      return ["manual", "batch", "content", "idiom", "students", "ai-settings"].map(t => {
        const c = makeEl("chip-" + t);
        c.dataset.tab = t;
        return c;
      });
    }
    if (sel === ".student-check:checked") return [];
    return [];
  },
  querySelector(sel) {
    const m = /\[data-tab="(.+)"\]/.exec(sel);
    if (m) { const c = makeEl("chip-" + m[1]); c.classList.add("selected"); return c; }
    return null;
  },
  addEventListener(type, fn) { (this._h ||= {})[type] = fn; },
  body: makeEl("body")
};

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
store.set("exam_teacher_token", "test-token");
store.set("exam_teacher_info", JSON.stringify({ className: "三年甲班" }));

const sandbox = {
  console,
  document,
  localStorage,
  navigator: { onLine: false },
  location: { replace: () => {} },
  alert: (m) => problems.push("alert: " + m),
  confirm: () => true,
  prompt: () => "pw",
  fetch: () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
  setTimeout, clearTimeout, Blob: class {}, URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  FileReader: class { readAsText() {} readAsArrayBuffer() {} },
  XLSX: undefined,
  JSON, Date, Math, RegExp, Promise, Object, Array, String, Number, Set, Map, Error, Boolean
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
  .filter(s => !s.startsWith("http"));

for (const src of scripts) {
  const file = path.join(root, src);
  if (!fs.existsSync(file)) { problems.push("找不到檔案: " + src); continue; }
  try {
    vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: src });
  } catch (e) {
    problems.push(`載入 ${src} 失敗: ${e.message}`);
  }
}

// 觸發 DOMContentLoaded（等同老師開頁面）
try {
  document._h["DOMContentLoaded"]();
} catch (e) {
  problems.push("DOMContentLoaded 失敗: " + e.message);
}

(async () => {
  await new Promise(r => setTimeout(r, 300));
  // 實際觸發幾個 render，確認執行期也沒錯
  try {
    sandbox.Admin.main.switchTab("ai-settings");
    sandbox.Admin.main.switchTab("idiom");
    sandbox.Admin.words.addLesson();
    sandbox.Admin.transfer.buildAllDataJSON();
    sandbox.Admin.zhuyinBatch.renderBatchPreview();
    sandbox.Admin.idiomBatch.renderIdiomBatchPreview();
    sandbox.Admin.content.renderQuestionEditors();
    sandbox.Admin.ai.getPriority();
    sandbox.Admin.students.renderStudents([{ seat: 1, name: "王小明", total: 3, correct: 2 }]);
  } catch (e) {
    problems.push("操作測試失敗: " + e.message);
  }

  const realUnknown = [...new Set(unknown)].filter(id => !id.startsWith("ai-") && !id.startsWith("new-"));
  console.log("載入的 script:", scripts.length, "個");
  console.log("HTML 元素:", htmlIds.length, "個");
  if (realUnknown.length) console.log("⚠️ 程式用到但 HTML 沒有的 id:", realUnknown);
  if (problems.length) { console.log("❌ 問題:"); problems.forEach(p => console.log("  -", p)); process.exit(1); }
  console.log("✅ 冒煙測試通過：所有模組載入、DOMContentLoaded、各分頁 render 都正常");
  if (realUnknown.length) process.exit(1);
})();
