import {
  BlendMode,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getPageRaster, sources } from './pdfjs';
import { subsetFont } from './subset';
import { removeTextInRects, type Rect } from './contentEdit';
import { BASELINE_RATIO, LINE_HEIGHT, isWinAnsi, loadFontBytes } from './fonts';
import type { FontKey, OcrLine, PageRef, PdfObj } from '../types';

export function hexToRgb(hex: string | null | undefined) {
  const h = (hex || '#000000').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

class FontPool {
  private cache = new Map<string, Promise<PDFFont>>();
  /** chars：每種中文字型變體需要的所有字元（用於子集化） */
  constructor(
    private doc: PDFDocument,
    private chars: { r: string; b: string } = { r: '', b: '' },
  ) {}
  get(key: FontKey, bold: boolean, text: string): Promise<PDFFont> {
    // 標準字型只能輸出 WinAnsi，含中文時自動改用思源黑體
    const k: FontKey = key !== 'noto' && !isWinAnsi(text) ? 'noto' : key;
    const id = `${k}-${bold ? 'b' : 'r'}`;
    let p = this.cache.get(id);
    if (!p) {
      if (k === 'noto') {
        const chars = (bold ? this.chars.b : this.chars.r) + text;
        p = loadFontBytes(bold)
          .then((b) => subsetFont(b, chars))
          .then((b) => this.doc.embedFont(b, { subset: false }));
      }
      else {
        const map = {
          helvetica: bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
          times: bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman,
          courier: bold ? StandardFonts.CourierBold : StandardFonts.Courier,
        } as const;
        p = this.doc.embedFont(map[k]);
      }
      this.cache.set(id, p);
    }
    return p;
  }
  keyFor(key: FontKey, text: string): FontKey {
    return key !== 'noto' && !isWinAnsi(text) ? 'noto' : key;
  }
}

class ImagePool {
  private cache = new Map<string, Promise<PDFImage>>();
  constructor(private doc: PDFDocument) {}
  get(src: string): Promise<PDFImage> {
    let p = this.cache.get(src);
    if (!p) {
      p = (async () => {
        const bytes = dataUrlToBytes(src);
        if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) return this.doc.embedJpg(bytes);
        return this.doc.embedPng(bytes);
      })();
      this.cache.set(src, p);
    }
    return p;
  }
}

export function dataUrlToBytes(src: string): Uint8Array {
  const b64 = src.slice(src.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface Ctx {
  page: PDFPage;
  ref: PageRef;
  fonts: FontPool;
  images: ImagePool;
}

// 頁面座標 → PDF 座標
const X = (ref: PageRef, x: number) => ref.view[0] + x;
const Y = (ref: PageRef, y: number) => ref.view[3] - y;

function withRotation(c: Ctx, o: PdfObj, px: number, py: number, fn: () => void) {
  const rot = o.rot || 0;
  if (!rot) return fn();
  // CSS 順時針 rot（y 向下） = PDF 逆時針 -rot（y 向上）
  const t = (-rot * Math.PI) / 180;
  const cx = X(c.ref, px);
  const cy = Y(c.ref, py);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  c.page.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy));
  fn();
  c.page.pushOperators(popGraphicsState());
}

function drawCover(c: Ctx, cover: { x: number; y: number; w: number; h: number; color: string }) {
  c.page.drawRectangle({
    x: X(c.ref, cover.x),
    y: Y(c.ref, cover.y + cover.h),
    width: cover.w,
    height: cover.h,
    color: hexToRgb(cover.color),
    borderWidth: 0,
  });
}

async function drawObject(c: Ctx, o: PdfObj) {
  const { page, ref } = c;
  const opacity = o.opacity ?? 1;
  switch (o.type) {
    case 'whiteout':
      page.drawRectangle({
        x: X(ref, o.x),
        y: Y(ref, o.y + o.h),
        width: o.w,
        height: o.h,
        color: hexToRgb(o.fill || '#ffffff'),
        opacity,
      });
      break;
    case 'highlight':
      page.drawRectangle({
        x: X(ref, o.x),
        y: Y(ref, o.y + o.h),
        width: o.w,
        height: o.h,
        color: hexToRgb(o.fill || '#ffeb3b'),
        opacity: o.opacity ?? 0.45,
        blendMode: BlendMode.Multiply,
      });
      break;
    case 'rect':
      page.drawRectangle({
        x: X(ref, o.x),
        y: Y(ref, o.y + o.h),
        width: o.w,
        height: o.h,
        color: o.fill ? hexToRgb(o.fill) : undefined,
        borderColor: o.stroke ? hexToRgb(o.stroke) : undefined,
        borderWidth: o.stroke ? o.strokeWidth ?? 2 : 0,
        opacity,
        borderOpacity: opacity,
      });
      break;
    case 'ellipse':
      page.drawEllipse({
        x: X(ref, o.x + o.w / 2),
        y: Y(ref, o.y + o.h / 2),
        xScale: o.w / 2,
        yScale: o.h / 2,
        color: o.fill ? hexToRgb(o.fill) : undefined,
        borderColor: o.stroke ? hexToRgb(o.stroke) : undefined,
        borderWidth: o.stroke ? o.strokeWidth ?? 2 : 0,
        opacity,
        borderOpacity: opacity,
      });
      break;
    case 'line': {
      const color = hexToRgb(o.stroke);
      const start = { x: X(ref, o.x1), y: Y(ref, o.y1) };
      const end = { x: X(ref, o.x2), y: Y(ref, o.y2) };
      page.drawLine({ start, end, thickness: o.strokeWidth, color, opacity });
      if (o.arrow) {
        const ang = Math.atan2(end.y - start.y, end.x - start.x);
        const len = Math.max(8, o.strokeWidth * 4);
        for (const s of [-1, 1]) {
          const a = ang + Math.PI - (s * Math.PI) / 7;
          page.drawLine({ start: end, end: { x: end.x + len * Math.cos(a), y: end.y + len * Math.sin(a) }, thickness: o.strokeWidth, color, opacity });
        }
      }
      break;
    }
    case 'ink': {
      if (o.points.length < 2) break;
      const d = o.points.map((p, i) => `${i ? 'L' : 'M'}${X(ref, p[0]).toFixed(2)} ${(-Y(ref, p[1])).toFixed(2)}`).join(' ');
      // drawSvgPath 以 (x,y) 為原點且 y 軸向下
      page.drawSvgPath(d, { x: 0, y: 0, borderColor: hexToRgb(o.stroke), borderWidth: o.strokeWidth, opacity, borderOpacity: opacity, borderLineCap: 1 as any });
      break;
    }
    case 'image': {
      if (o.cover) drawCover(c, o.cover);
      const img = await c.images.get(o.src);
      withRotation(c, o, o.x, o.y, () =>
        page.drawImage(img, { x: X(ref, o.x), y: Y(ref, o.y + o.h), width: o.w, height: o.h, opacity }),
      );
      break;
    }
    case 'text': {
      if (o.cover) drawCover(c, o.cover);
      if (!o.text) break;
      const font = await c.fonts.get(o.font, !!o.bold, o.text);
      const fk = c.fonts.keyFor(o.font, o.text);
      const lines = o.text.split('\n');
      const color = hexToRgb(o.color);
      withRotation(c, o, o.x, o.y, () => {
        lines.forEach((line, i) => {
          if (!line) return;
          const baseline = o.y + o.fontSize * (i * LINE_HEIGHT + BASELINE_RATIO[fk]);
          page.drawText(line, { x: X(ref, o.x), y: Y(ref, baseline), size: o.fontSize, font, color, opacity });
        });
      });
      break;
    }
  }
}

/** 隱形 OCR 文字層（讓掃描檔可搜尋、可複製） */
/** 需要移除原文字的區域（PDF 座標）：被編輯取代的文字行與白色塗改 */
function removalRects(ref: PageRef, objs: PdfObj[], prefix: 'pdf-' | 'ocr-'): Rect[] {
  const out: Rect[] = [];
  const add = (r: { x: number; y: number; w: number; h: number }) =>
    out.push({ x0: X(ref, r.x), x1: X(ref, r.x + r.w), y0: Y(ref, r.y + r.h), y1: Y(ref, r.y) });
  for (const o of objs) {
    if (o.type === 'text' && o.cover && o.sourceRunId?.startsWith(prefix)) add(o.cover);
    else if (o.type === 'whiteout') add(o);
  }
  return out;
}

async function drawOcr(c: Ctx, lines: OcrLine[], skip: Rect[] = []) {
  const all = lines.map((l) => l.text).join('');
  if (!all.trim()) return;
  const font = await c.fonts.get('noto', false, all);
  for (const line of lines) {
    // 同一行的字共用基線與字級，文字擷取時才會排成同一行
    const size = Math.max(2, line.h * 0.9);
    for (const w of line.words.length ? line.words : [line]) {
      const text = w.text.trim();
      if (!text) continue;
      // 已被編輯取代或塗改的辨識文字不再輸出
      const cx = X(c.ref, w.x + w.w / 2);
      const cy = Y(c.ref, w.y + w.h / 2);
      if (skip.some((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1)) continue;
      let width = 0;
      try {
        width = font.widthOfTextAtSize(text, size);
      } catch {
        continue;
      }
      // 以水平縮放讓文字寬度貼齊辨識框
      const sx = width > 0 ? w.w / width : 1;
      const x = X(c.ref, w.x);
      const y = Y(c.ref, line.y + line.h * 0.85);
      c.page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, 1, x - sx * x, 0));
      c.page.drawText(text, { x, y, size, font, opacity: 0 });
      c.page.pushOperators(popGraphicsState());
    }
  }
}

export interface BuildOptions {
  pages: PageRef[];
  objects: Record<string, PdfObj[]>;
  ocr: Record<string, OcrLine[]>;
  title?: string;
  onProgress?: (p: number) => void;
}

/** 依目前的頁面與物件產生最終 PDF */
export async function buildPdf({ pages, objects, ocr, title, onProgress }: BuildOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  // 預先收集需要的中文字元，一次子集化
  const chars = { r: '', b: '' };
  for (const p of pages) {
    for (const o of objects[p.id] || []) {
      if (o.type !== 'text' || !o.text) continue;
      if (o.font === 'noto' || !isWinAnsi(o.text)) chars[o.bold ? 'b' : 'r'] += o.text;
    }
    for (const l of ocr[p.id] || []) chars.r += l.text + l.words.map((w) => w.text).join('');
  }
  const fonts = new FontPool(out, chars);
  const images = new ImagePool(out);

  // 1) 依來源分組複製頁面
  const loaded = new Map<string, PDFDocument>();
  const copied = new Map<string, PDFPage>();
  const bySrc = new Map<string, PageRef[]>();
  const rasterSrc = new Set<string>(); // 加密文件：改以高解析度影像重建頁面
  for (const p of pages) if (p.srcId) bySrc.set(p.srcId, [...(bySrc.get(p.srcId) || []), p]);
  for (const [srcId, refs] of bySrc) {
    const src = sources.get(srcId);
    if (!src) throw new Error('找不到來源文件');
    let doc = loaded.get(srcId);
    if (!doc) {
      doc = await PDFDocument.load(src.bytes, { ignoreEncryption: true, updateMetadata: false });
      loaded.set(srcId, doc);
    }
    if (doc.isEncrypted) {
      rasterSrc.add(srcId);
      continue;
    }
    const unique = [...new Set(refs.map((r) => r.srcIndex))];
    const cps = await out.copyPages(doc, unique);
    unique.forEach((idx, i) => copied.set(`${srcId}:${idx}`, cps[i]));
  }

  // 2) 依順序加入頁面並繪製物件
  const usedOnce = new Set<string>();
  for (let i = 0; i < pages.length; i++) {
    const ref = pages[i];
    let page: PDFPage;
    if (!ref.srcId) {
      page = out.addPage([ref.width, ref.height]);
    } else if (rasterSrc.has(ref.srcId)) {
      page = out.addPage([ref.width, ref.height]);
      page.setMediaBox(ref.view[0], ref.view[1], ref.width, ref.height);
      const canvas = await getPageRaster(ref, 200 / 72);
      const img = await out.embedPng(dataUrlToBytes(canvas.toDataURL('image/png')));
      page.drawImage(img, { x: ref.view[0], y: ref.view[1], width: ref.width, height: ref.height });
    } else {
      const k = `${ref.srcId}:${ref.srcIndex}`;
      let cp = copied.get(k)!;
      if (usedOnce.has(k)) {
        // 同一頁被複製多次時需另外複製
        cp = (await out.copyPages(loaded.get(ref.srcId)!, [ref.srcIndex]))[0];
      }
      usedOnce.add(k);
      page = out.addPage(cp);
      // 真正移除被取代/塗改的原始文字（遮蓋色塊仍會繪製作為保險）
      const rects = removalRects(ref, objects[ref.id] || [], 'pdf-');
      if (rects.length) {
        try {
          removeTextInRects(page, rects);
        } catch (e) {
          console.warn('移除原文字失敗，改以遮蓋處理', e);
        }
      }
    }
    page.setRotation(degrees((((ref.baseRotate + ref.rotate) % 360) + 360) % 360));
    const c: Ctx = { page, ref, fonts, images };
    if (ocr[ref.id]?.length) await drawOcr(c, ocr[ref.id], removalRects(ref, objects[ref.id] || [], 'ocr-'));
    for (const o of objects[ref.id] || []) await drawObject(c, o);
    onProgress?.((i + 1) / pages.length);
  }
  if (title) out.setTitle(title);
  out.setProducer('PDF Editor');
  out.setModificationDate(new Date());
  return out.save();
}

/** 只取部分頁（0 起索引）產生新 PDF */
export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const cps = await out.copyPages(src, indices);
  cps.forEach((p) => out.addPage(p));
  return out.save();
}
