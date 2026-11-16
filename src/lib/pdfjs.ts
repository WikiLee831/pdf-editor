import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageRef } from '../types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
// 頁面一載入就啟動 PDF 引擎（而不是等到第一次開檔），並由所有文件共用
try {
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });
} catch {
  /* 退回 pdf.js 預設行為 */
}

const base = import.meta.env.BASE_URL;

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };

export async function loadPdfJs(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  // pdf.js 會轉移 ArrayBuffer，所以一定要傳副本
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: `${base}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
    wasmUrl: `${base}pdfjs/wasm/`,
    iccUrl: `${base}pdfjs/iccs/`,
    useSystemFonts: true,
  } as any);
  return task.promise;
}

// 來源文件登錄表（不進入復原紀錄）
export interface SourceDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
}
export const sources = new Map<string, SourceDoc>();

export async function getPdfPage(ref: PageRef): Promise<PDFPageProxy | null> {
  if (!ref.srcId) return null;
  const src = sources.get(ref.srcId);
  if (!src) return null;
  return src.pdf.getPage(ref.srcIndex + 1);
}

export function totalRotation(ref: PageRef) {
  return (((ref.baseRotate + ref.rotate) % 360) + 360) % 360;
}

/** 依目前旋轉後的尺寸 */
export function displaySize(ref: PageRef, scale: number) {
  const r = totalRotation(ref);
  const w = ref.width * scale;
  const h = ref.height * scale;
  return r % 180 === 0 ? { w, h } : { w: h, h: w };
}

/**
 * 將頁面渲染到 canvas。rotation 預設為頁面總旋轉；傳 0 可取得未旋轉影像。
 * 回傳的 cancel 可中止渲染。
 */
export function renderPageToCanvas(
  ref: PageRef,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation?: number,
): { promise: Promise<void>; cancel: () => void } {
  let task: any = null;
  let cancelled = false;
  const rot = rotation ?? totalRotation(ref);
  const promise = (async () => {
    const page = await getPdfPage(ref);
    if (cancelled) return;
    const ctx = canvas.getContext('2d')!;
    if (!page) {
      // 空白頁
      const w = Math.round((rot % 180 === 0 ? ref.width : ref.height) * scale);
      const h = Math.round((rot % 180 === 0 ? ref.height : ref.width) * scale);
      canvas.width = w;
      canvas.height = h;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const viewport = page.getViewport({ scale, rotation: rot });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    task = page.render({ canvasContext: ctx, canvas, viewport, background: 'white' } as any);
    try {
      await task.promise;
    } catch (e: any) {
      if (e?.name !== 'RenderingCancelledException') throw e;
    }
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* ignore */
      }
    },
  };
}

// 未旋轉的高解析度點陣快取（取色、擷取圖片用）
const rasterCache = new Map<string, Promise<HTMLCanvasElement>>();
export function getPageRaster(ref: PageRef, scale = 2): Promise<HTMLCanvasElement> {
  const key = `${ref.srcId}:${ref.srcIndex}:${scale}`;
  let p = rasterCache.get(key);
  if (!p) {
    const canvas = document.createElement('canvas');
    p = renderPageToCanvas(ref, canvas, scale, 0).promise.then(() => canvas);
    rasterCache.set(key, p);
    if (rasterCache.size > 12) rasterCache.delete(rasterCache.keys().next().value!);
  }
  return p;
}

export function clearRasterCache() {
  rasterCache.clear();
}
