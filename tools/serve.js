#!/usr/bin/env node
/* ============================================================
   本地預覽伺服器（no-cache 版）
   ------------------------------------------------------------
   用法：node tools/serve.js [port=8000]

   為什麼不用 python3 -m http.server：
     它只送 Last-Modified、不送 Cache-Control，瀏覽器會啟發式
     快取，改完檔案常常仍看到舊畫面（本次 teacher.html 的問題）。
     本檔強制 no-store，每次請求都拿到最新內容。
   ============================================================ */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2]) || 8000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wasm": "application/wasm"
};

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache"
};

function send(res, status, body) {
  res.writeHead(status, Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, NO_CACHE));
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname || "/");
  } catch (e) {
    return send(res, 400, "400 Bad Request");
  }
  if (pathname.endsWith("/")) pathname += "index.html";

  // 防止路徑穿越（../ 跳出專案目錄）
  const filePath = path.join(ROOT, path.normalize(pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return send(res, 403, "403 Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, "404 Not Found: " + pathname);
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, Object.assign({
      "Content-Type": type,
      "Content-Length": stat.size
    }, NO_CACHE));
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log("📁 服務根目錄: " + ROOT);
  console.log("🌐 http://localhost:" + PORT + "/");
  console.log("   （已關閉快取：改完檔案重新整理就會看到最新內容）");
});
