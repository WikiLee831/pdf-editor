import { createWorker, type Worker } from 'tesseract.js';
import { renderPageToCanvas } from './pdfjs';
import { uid } from '../store';
import type { OcrLine, OcrWord, PageRef } from '../types';

const base = new URL(import.meta.env.BASE_URL, location.href).href;

export const OCR_LANGS: { code: string; label: string }[] = [
  { code: 'chi_tra', label: '繁體中文' },
  { code: 'chi_sim', label: '簡體中文' },
  { code: 'eng', label: '英文' },
  { code: 'jpn', label: '日文' },
];

let worker: Worker | null = null;
let workerLangs = '';
let progressCb: ((p: number, status: string) => void) | null = null;

async function getWorker(langs: string[]) {
  const key = langs.join('+');
  if (worker && workerLangs === key) return worker;
  if (worker) await worker.terminate();
  worker = await createWorker(langs, 1, {
    // 全部使用本機檔案（npm run setup 已下載）
    workerPath: `${base}tesseract/worker.min.js`,
    corePath: `${base}tesseract/core/`,
    langPath: `${base}tessdata`,
    gzip: true,
    logger: (m: any) => {
      if (progressCb && typeof m.progress === 'number') progressCb(m.progress, m.status);
    },
  } as any);
  workerLangs = key;
  return worker;
}

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;
function cleanText(s: string) {
  // tesseract 對中日文常在字間插入空白，移除 CJK 字元之間的空白
  let t = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) t = t.replace(new RegExp(`(${CJK.source}) (?=${CJK.source})`, 'g'), '$1');
  return t;
}

/** 對單頁執行 OCR，回傳頁面座標的文字行 */
export async function ocrPage(
  ref: PageRef,
  langs: string[],
  dpi = 300,
  onProgress?: (p: number, status: string) => void,
): Promise<OcrLine[]> {
  const scale = dpi / 72;
  const canvas = document.createElement('canvas');
  await renderPageToCanvas(ref, canvas, scale, 0).promise;
  const w = await getWorker(langs);
  progressCb = onProgress || null;
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: true } as any);
  progressCb = null;
  const lines: OcrLine[] = [];
  const toWord = (bbox: any, text: string): OcrWord => ({
    text,
    x: bbox.x0 / scale,
    y: bbox.y0 / scale,
    w: (bbox.x1 - bbox.x0) / scale,
    h: (bbox.y1 - bbox.y0) / scale,
  });
  for (const block of (data as any).blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        if ((line.confidence ?? 100) < 15) continue;
        const words: OcrWord[] = (line.words || [])
          .filter((wd: any) => wd.text?.trim() && (wd.confidence ?? 100) > 10)
          .map((wd: any) => toWord(wd.bbox, wd.text.trim()));
        const text = cleanText(line.text || '');
        if (!text) continue;
        lines.push({ id: uid(), ...toWord(line.bbox, text), words });
      }
    }
  }
  canvas.width = canvas.height = 0;
  return lines;
}

export async function terminateOcr() {
  if (worker) await worker.terminate();
  worker = null;
  workerLangs = '';
}
