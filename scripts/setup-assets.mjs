// 準備執行時需要的靜態資源（全部放在 public/，執行時不需任何認證或外部服務）
// - pdf.js 的 cMaps / 標準字型 / wasm（顯示中日韓 PDF 必要）
// - tesseract.js 的 worker 與 core（OCR 引擎，本機執行）
// - OCR 語言資料（繁中/簡中/英/日）
// - 思源黑體 Noto Sans TC（編輯/新增中文字並嵌入 PDF）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const nm = path.join(root, 'node_modules');

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(s).size) fs.copyFileSync(s, d);
  }
}

function copyFiles(srcDir, dstDir, filter) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    if (filter && !filter(f)) continue;
    const s = path.join(srcDir, f);
    const d = path.join(dstDir, f);
    if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(s).size) fs.copyFileSync(s, d);
  }
}

async function download(url, dst) {
  if (fs.existsSync(dst) && fs.statSync(dst).size > 1000) return true;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    process.stdout.write(`下載 ${path.basename(dst)} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dst + '.part', buf);
    fs.renameSync(dst + '.part', dst);
    console.log(`完成 (${(buf.length / 1048576).toFixed(1)} MB)`);
    return true;
  } catch (e) {
    console.log(`失敗：${e.message}（稍後可重新執行 npm run setup）`);
    return false;
  }
}

// pdf.js
copyDir(path.join(nm, 'pdfjs-dist', 'cmaps'), path.join(pub, 'pdfjs', 'cmaps'));
copyDir(path.join(nm, 'pdfjs-dist', 'standard_fonts'), path.join(pub, 'pdfjs', 'standard_fonts'));
copyDir(path.join(nm, 'pdfjs-dist', 'wasm'), path.join(pub, 'pdfjs', 'wasm'));
copyDir(path.join(nm, 'pdfjs-dist', 'iccs'), path.join(pub, 'pdfjs', 'iccs'));

// tesseract.js
copyFiles(path.join(nm, 'tesseract.js', 'dist'), path.join(pub, 'tesseract'), (f) => f === 'worker.min.js');
copyFiles(path.join(nm, 'tesseract.js-core'), path.join(pub, 'tesseract', 'core'), (f) => f.startsWith('tesseract-core'));

// OCR 語言資料
for (const lang of ['eng', 'chi_tra', 'chi_sim', 'jpn']) {
  await download(
    `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,
    path.join(pub, 'tessdata', `${lang}.traineddata.gz`),
  );
}

// 字型（SIL Open Font License）
const fontBase = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-tc@0.4.4';
await download(`${fontBase}/400Regular/NotoSansTC_400Regular.ttf`, path.join(pub, 'fonts', 'NotoSansTC-Regular.ttf'));
await download(`${fontBase}/700Bold/NotoSansTC_700Bold.ttf`, path.join(pub, 'fonts', 'NotoSansTC-Bold.ttf'));

console.log('資源準備完成。');
