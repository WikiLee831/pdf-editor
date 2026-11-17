import { buildPdf } from './exportPdf';
import { getPageRaster, loadPdfJs } from './pdfjs';
import { useStore } from '../store';
import type { PageRef } from '../types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 依目前編輯結果（含註解、文字修改）渲染整頁（未旋轉、左上原點） */
async function renderEdited(ref: PageRef, scale: number): Promise<HTMLCanvasElement> {
  const s = useStore.getState();
  const objs = s.objects[ref.id] || [];
  if (!objs.length) return getPageRaster(ref, scale);
  const bytes = await buildPdf({ pages: [{ ...ref, rotate: 0, baseRotate: 0 }], objects: { [ref.id]: objs }, ocr: {} });
  const pdf = await loadPdfJs(bytes);
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale, rotation: 0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport } as any).promise;
    return canvas;
  } finally {
    pdf.destroy();
  }
}

/** 擷取頁面指定區域（頁面座標），依畫面旋轉方向輸出 PNG */
export async function snapshotRegion(ref: PageRef, rect: Rect, rotation: number, scale = 3): Promise<Blob> {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const w = Math.min(ref.width, rect.x + rect.w) - x;
  const h = Math.min(ref.height, rect.y + rect.h) - y;
  if (w <= 0 || h <= 0) throw new Error('選取範圍在頁面外');
  const page = await renderEdited(ref, scale);
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const R = ((rotation % 360) + 360) % 360;
  const out = document.createElement('canvas');
  out.width = R % 180 ? ch : cw;
  out.height = R % 180 ? cw : ch;
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((R * Math.PI) / 180);
  ctx.drawImage(page, x * scale, y * scale, w * scale, h * scale, -cw / 2, -ch / 2, cw, ch);
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('無法產生影像'))), 'image/png'));
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}
