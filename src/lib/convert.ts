import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { loadPdfJs, type PDFDocumentProxy } from './pdfjs';
import { loadFontBytes } from './fonts';
import { subsetFont } from './subset';

export type Progress = (p: number, msg?: string) => void;

async function renderToBlob(pdf: PDFDocumentProxy, index: number, dpi: number, type: 'image/png' | 'image/jpeg', quality = 0.92) {
  const page = await pdf.getPage(index + 1);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport } as any).promise;
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), type, quality));
  const size = { w: canvas.width, h: canvas.height, pw: viewport.width / (dpi / 72), ph: viewport.height / (dpi / 72) };
  canvas.width = canvas.height = 0;
  return { blob, ...size };
}

export function parseRange(spec: string, total: number): number[] {
  const out: number[] = [];
  const s = spec.trim();
  if (!s || s === '全部' || s.toLowerCase() === 'all') return Array.from({ length: total }, (_, i) => i);
  for (const part of s.split(/[,，、\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)?\s*[-~–]\s*(\d+)?$/);
    if (m) {
      const a = Math.max(1, parseInt(m[1] || '1'));
      const b = Math.min(total, parseInt(m[2] || String(total)));
      for (let i = a; i <= b; i++) out.push(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part);
      if (n >= 1 && n <= total) out.push(n - 1);
    } else throw new Error(`無法解析頁碼：「${part}」`);
  }
  return out;
}

export async function pdfToImages(bytes: Uint8Array, opts: { dpi: number; format: 'png' | 'jpeg'; pages: number[]; quality?: number }, onProgress?: Progress) {
  const pdf = await loadPdfJs(bytes);
  const files: { name: string; data: Blob }[] = [];
  const pad = String(pdf.numPages).length;
  for (let k = 0; k < opts.pages.length; k++) {
    const i = opts.pages[k];
    const { blob } = await renderToBlob(pdf, i, opts.dpi, opts.format === 'png' ? 'image/png' : 'image/jpeg', opts.quality);
    files.push({ name: `第${String(i + 1).padStart(pad, '0')}頁.${opts.format === 'png' ? 'png' : 'jpg'}`, data: blob });
    onProgress?.((k + 1) / opts.pages.length, `轉換第 ${i + 1} 頁`);
  }
  await pdf.destroy();
  return files;
}

interface Line {
  text: string;
  x: number;
  y: number; // 基線（由上往下）
  size: number;
  bold: boolean;
  right: number;
}

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;

async function pageLines(pdf: PDFDocumentProxy, index: number) {
  const page = await pdf.getPage(index + 1);
  // 以未旋轉座標擷取，文字方向才正確
  const viewport = page.getViewport({ scale: 1, rotation: 0 });
  try {
    await page.getOperatorList();
  } catch {
    /* ignore */
  }
  const tc = await page.getTextContent();
  const items: Line[] = [];
  for (const it of tc.items as any[]) {
    if (!it.str || !it.str.trim()) continue;
    const [, , c, d, e, f] = it.transform;
    const [x, y] = viewport.convertToViewportPoint(e, f);
    let fname = '';
    try {
      if (page.commonObjs.has(it.fontName)) fname = page.commonObjs.get(it.fontName)?.name || '';
    } catch {
      /* ignore */
    }
    const size = Math.hypot(c, d) || 10;
    items.push({ text: it.str.trim(), x, y, size, bold: /bold|black|heavy/i.test(fname), right: x + (it.width || 0) });
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  // 先依基線分組，再於每組內依 x 排序合併
  const groups: Line[][] = [];
  for (const it of items) {
    const g = groups.find((G) => Math.abs(G[0].y - it.y) < Math.min(G[0].size, it.size) * 0.45);
    if (g) g.push(it);
    else groups.push([it]);
  }
  const lines: Line[] = groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    const l: Line = { ...g[0] };
    for (const it of g.slice(1)) {
      const gap = it.x - l.right;
      if (gap < -it.size * 0.3 && l.text.endsWith(it.text)) continue; // 重疊的重複文字
      const sep = gap > l.size * 0.2 && !(CJK.test(l.text.slice(-1)) && CJK.test(it.text[0])) ? (gap > l.size * 2 ? '\t' : ' ') : '';
      l.text += sep + it.text;
      l.right = Math.max(l.right, it.right);
      l.size = Math.max(l.size, it.size);
      l.bold = l.bold && it.bold;
    }
    return l;
  });
  lines.sort((a, b) => a.y - b.y);
  return { lines, width: viewport.width, height: viewport.height, page };
}

export async function pdfToText(bytes: Uint8Array, onProgress?: Progress) {
  const pdf = await loadPdfJs(bytes);
  const parts: string[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const { lines } = await pageLines(pdf, i);
    parts.push(lines.map((l) => l.text).join('\n'));
    onProgress?.((i + 1) / pdf.numPages);
  }
  await pdf.destroy();
  return parts.join('\n\n\f');
}

export { pdfToDocx, type DocxMode } from './toDocx';

export async function pdfToHtml(bytes: Uint8Array, onProgress?: Progress) {
  const pdf = await loadPdfJs(bytes);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  let body = '';
  for (let i = 0; i < pdf.numPages; i++) {
    const { lines } = await pageLines(pdf, i);
    body += `<section class="page">\n${lines.map((l) => `<p style="font-size:${l.size.toFixed(1)}px${l.bold ? ';font-weight:bold' : ''}">${esc(l.text)}</p>`).join('\n')}\n</section>\n`;
    onProgress?.((i + 1) / pdf.numPages);
  }
  await pdf.destroy();
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>轉換結果</title><style>body{font-family:"Microsoft JhengHei",sans-serif;background:#eee;margin:0;padding:24px}.page{background:#fff;max-width:820px;margin:0 auto 24px;padding:48px;box-shadow:0 1px 4px #0002}p{margin:.3em 0;white-space:pre-wrap}</style></head><body>${body}</body></html>`;
}

/** 純文字 → PDF（A4、自動換行、嵌入思源黑體） */
export async function textToPdf(text: string, opts: { fontSize?: number; margin?: number } = {}): Promise<Uint8Array> {
  const size = opts.fontSize ?? 12;
  const margin = opts.margin ?? 56;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await subsetFont(await loadFontBytes(false), text), { subset: false });
  const [pw, ph] = [595.28, 841.89];
  const maxW = pw - margin * 2;
  const lh = size * 1.6;
  let page = doc.addPage([pw, ph]);
  let y = ph - margin - size;
  const newPage = () => {
    page = doc.addPage([pw, ph]);
    y = ph - margin - size;
  };
  const widthOf = (s: string) => {
    try {
      return font.widthOfTextAtSize(s, size);
    } catch {
      return s.length * size;
    }
  };
  for (const rawPara of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (rawPara.includes('\f')) {
      newPage();
      continue;
    }
    const para = rawPara.replace(/\t/g, '    ');
    if (!para.trim()) {
      y -= lh;
      if (y < margin) newPage();
      continue;
    }
    // 依寬度斷行：CJK 可逐字斷，英文以單字斷
    const tokens = para.match(/[⺀-鿿가-힯豈-﫿＀-￯　-〿]|[^\s⺀-鿿가-힯豈-﫿＀-￯　-〿]+|\s+/g) || [];
    let line = '';
    const emit = () => {
      if (y < margin) newPage();
      if (line.trim()) page.drawText(line.replace(/\s+$/, ''), { x: margin, y, size, font, color: rgb(0, 0, 0) });
      y -= lh;
      line = '';
    };
    for (const t of tokens) {
      if (widthOf(line + t) > maxW && line) {
        emit();
        if (/^\s+$/.test(t)) continue;
      }
      if (widthOf(t) > maxW) {
        for (const ch of t) {
          if (widthOf(line + ch) > maxW) emit();
          line += ch;
        }
      } else line += t;
    }
    if (line) emit();
  }
  return doc.save();
}

export async function docxToText(bytes: Uint8Array): Promise<string> {
  // @ts-ignore 瀏覽器版本
  const mammoth = (await import('mammoth/mammoth.browser.js')).default;
  const res = await mammoth.extractRawText({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  return res.value as string;
}
