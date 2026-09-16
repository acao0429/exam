// 一次性工具：批次查詢萌典 API，建立離線注音表 js/offline-zhuyin.js
// 用法：node tools/build_offline_zhuyin.js < 輸入檔(每行一個字)
const fs = require("fs");
const path = require("path");

const SRC = process.argv[2];
const OUT = path.join(__dirname, "..", "js", "offline-zhuyin.js");
const CONCURRENCY = 20;

function readChars(file) {
  const txt = fs.readFileSync(file, "utf8");
  return [...new Set(txt.replace(/\r/g, "").split("\n").map((s) => s.trim()).filter((s) => s.length === 1))];
}

async function fetchZhuyin(char) {
  const url = `https://www.moedict.tw/uni/${encodeURIComponent(char)}.json`;
  const resp = await fetch(url);
  if (!resp.ok) return { char, zhuyin: null, error: resp.status };
  const data = await resp.json();
  const h = data.heteronyms && data.heteronyms[0];
  const z = h && h.bopomofo;
  return { char, zhuyin: z, error: null };
}

async function run() {
  const chars = readChars(SRC);
  console.log(`total unique chars: ${chars.length}`);
  const results = [];
  let idx = 0;
  while (idx < chars.length) {
    const batch = chars.slice(idx, idx + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(fetchZhuyin));
    settled.forEach((r) => {
      if (r.status === "fulfilled" && r.value.zhuyin) {
        results.push(r.value);
      }
    });
    idx += CONCURRENCY;
    if (idx % 400 === 0) console.log(`processed ${idx}`);
  }
  console.log(`got ${results.length} zhuyin`);
  const lines = [];
  lines.push("/* 離線注音表：由教育部4808常用字 + 萌典(教育部國語辭典)自動產生。 */");
  lines.push("");
  lines.push("const OFFLINE_ZHUYIN = {");
  const entries = results.map((r) => `  ${JSON.stringify(r.char)}: ${JSON.stringify(r.zhuyin)}`);
  lines.push(entries.join(",\n"));
  lines.push("};");
  lines.push("");
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`written to ${OUT}`);
}

run().catch((e) => { console.error(e); process.exit(1); });