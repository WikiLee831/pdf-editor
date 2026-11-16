// 本機靜態伺服器（無需任何認證）：node server.mjs [port]
// 只綁定 127.0.0.1，僅供本機使用；所有 PDF 處理都在瀏覽器內完成。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 4173);

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('找不到 dist/，請先執行：npm run build');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ttf': 'font/ttf',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.gz': 'application/octet-stream', // OCR 語言資料由 tesseract 自行解壓，不能加 Content-Encoding
  '.icc': 'application/octet-stream',
};

const openBrowser = (url) => {
  if (process.argv.includes('--no-open')) return;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
  exec(cmd);
};

const server = http
  .createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': /\/assets\//.test(p) ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
  })
;

let tryPort = port;
server.on('listening', () => {
  const url = `http://localhost:${tryPort}/`;
  console.log(`PDF Editor 已啟動：${url}`);
  console.log('使用期間請保持此視窗開啟；關閉視窗或按 Ctrl+C 即結束程式。');
  openBrowser(url);
});
server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  // 連接埠被占用：若是 PDF Editor 已在執行，直接開啟；否則改用下一個連接埠
  try {
    const html = await (await fetch(`http://127.0.0.1:${tryPort}/`)).text();
    if (html.includes('PDF Editor')) {
      console.log(`PDF Editor 已經在 http://localhost:${tryPort}/ 執行中，直接開啟瀏覽器。`);
      openBrowser(`http://localhost:${tryPort}/`);
      process.exit(0);
    }
  } catch {
    /* 不是 HTTP 服務 */
  }
  if (tryPort - port >= 20) throw err;
  tryPort++;
  server.listen(tryPort, '127.0.0.1');
});
server.listen(tryPort, '127.0.0.1');
