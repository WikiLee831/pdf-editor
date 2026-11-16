// 一鍵啟動：必要時安裝套件、建置，然後啟動本機伺服器（由「啟動 PDF Studio.bat」呼叫）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

function run(label, args) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync('npm', args, { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\n${label}失敗，請檢查上方訊息（需要網路連線以下載套件）。`);
    process.exit(1);
  }
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`Node.js 版本過舊（目前 ${process.versions.node}），請安裝 18 以上版本：https://nodejs.org/`);
  process.exit(1);
}

if (!fs.existsSync(path.join(root, 'node_modules'))) run('第一次執行：安裝套件中', ['install']);
// 沒有建置結果，或原始碼比建置結果新時，重新建置
function newestMtime(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(0, ...fs.readdirSync(p).map((f) => newestMtime(path.join(p, f))));
}
const built = path.join(root, 'dist', 'index.html');
const srcTime = Math.max(newestMtime(path.join(root, 'src')), newestMtime(path.join(root, 'index.html')), newestMtime(path.join(root, 'package.json')));
if (!fs.existsSync(built) || fs.statSync(built).mtimeMs < srcTime) run('建置中', ['run', 'build']);

await import(pathToFileURL(path.join(root, 'server.mjs')).href);
