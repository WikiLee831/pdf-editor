import { getPdfPage, getPageRaster, pdfjs, type PDFPageProxy } from './pdfjs';
import type { DetectedImage, OcrLine, PageRef, TextRun } from '../types';

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;

const runCache = new Map<string, Promise<TextRun[]>>();
const imgCache = new Map<string, Promise<DetectedImage[]>>();
const keyOf = (ref: PageRef) => `${ref.srcId}:${ref.srcIndex}`;

interface RawItem {
  str: string;
  x: number;
  baseline: number;
  w: number;
  size: number;
  asc: number;
  desc: number;
  bold: boolean;
  serif: boolean;
  mono: boolean;
}

/** 取得頁面上既有文字，合併成可編輯的行 */
export function getTextRuns(ref: PageRef): Promise<TextRun[]> {
  if (!ref.srcId) return Promise.resolve([]);
  const key = keyOf(ref);
  let p = runCache.get(key);
  if (!p) {
    p = computeRuns(ref);
    runCache.set(key, p);
  }
  return p;
}

async function computeRuns(ref: PageRef): Promise<TextRun[]> {
  const page = await getPdfPage(ref);
  if (!page) return [];
  // 先跑一次 operator list 讓字型物件載入，才能拿到字型名稱（判斷粗體）
  try {
    await page.getOperatorList();
  } catch {
    /* ignore */
  }
  const tc = await page.getTextContent();
  const [vx0, , , vy1] = ref.view;
  const raw: RawItem[] = [];
  for (const it of tc.items as any[]) {
    if (!('str' in it) || !it.str || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    if (Math.abs(b) > 0.01 * Math.abs(a) || Math.abs(c) > 0.01 * Math.abs(d)) continue; // 略過旋轉文字
    if (a <= 0 || d <= 0) continue;
    const size = Math.hypot(c, d);
    if (size < 1) continue;
    const style = (tc.styles as any)[it.fontName] || {};
    let fname = '';
    try {
      if (page.commonObjs.has(it.fontName)) fname = page.commonObjs.get(it.fontName)?.name || '';
    } catch {
      /* ignore */
    }
    const fam = `${style.fontFamily || ''} ${fname}`;
    raw.push({
      str: it.str,
      x: e - vx0,
      baseline: vy1 - f,
      w: it.width || it.str.length * size * 0.5,
      size,
      asc: style.ascent && style.ascent > 0.5 ? style.ascent : 0.88,
      desc: style.descent && style.descent < 0 ? -style.descent : 0.22,
      bold: /bold|black|heavy|semibold|demi|w[6-9]\b/i.test(fname),
      serif: /serif|times|ming|song|明|宋|georgia|garamond|cambria/i.test(fam) && !/sans/i.test(fam),
      mono: /mono|courier|consol/i.test(fam),
    });
  }
  return groupRuns(raw, 'pdf');
}

function groupRuns(items: RawItem[], source: 'pdf' | 'ocr'): TextRun[] {
  items.sort((p, q) => p.baseline - q.baseline || p.x - q.x);
  // 1) 依基線分行
  const lines: RawItem[][] = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l[0].baseline - it.baseline) < Math.min(l[0].size, it.size) * 0.4);
    if (line) line.push(it);
    else lines.push([it]);
  }
  // 2) 行內依 x 排序並依間距切段
  const runs: TextRun[] = [];
  let n = 0;
  for (const line of lines) {
    line.sort((p, q) => p.x - q.x);
    let cur: RawItem[] = [];
    const flush = () => {
      if (!cur.length) return;
      let text = '';
      let right = -Infinity;
      for (const it of cur) {
        if (text) {
          const gap = it.x - right;
          const prev = text[text.length - 1];
          const next = it.str[0];
          if (gap > it.size * 0.18 && prev !== ' ' && next !== ' ' && !(CJK.test(prev) && CJK.test(next))) text += ' ';
        }
        text += it.str;
        right = Math.max(right, it.x + it.w);
      }
      text = text.replace(/\s+$/, '');
      const x = cur[0].x;
      const size = Math.max(...cur.map((c) => c.size));
      const baseline = cur.reduce((s, c) => s + c.baseline * c.str.length, 0) / cur.reduce((s, c) => s + c.str.length, 0);
      const asc = Math.max(...cur.map((c) => c.asc));
      const desc = Math.max(...cur.map((c) => c.desc));
      runs.push({
        id: `${source}-${n++}`,
        text,
        x,
        y: baseline - size * asc,
        w: right - x,
        h: size * (asc + desc),
        baseline,
        fontSize: Math.round(size * 10) / 10,
        bold: cur.filter((c) => c.bold).length > cur.length / 2,
        serif: cur[0].serif,
        mono: cur[0].mono,
        source,
      });
      cur = [];
    };
    for (const it of line) {
      if (cur.length) {
        const last = cur[cur.length - 1];
        const right = Math.max(...cur.map((c) => c.x + c.w));
        const gap = it.x - right;
        const sizeOk = Math.abs(last.size - it.size) < Math.max(last.size, it.size) * 0.35;
        if (!sizeOk || gap > Math.max(last.size, it.size) * 1.6 || gap < -last.size * 2) flush();
      }
      cur.push(it);
    }
    flush();
  }
  return runs;
}

/** OCR 結果轉成可編輯行 */
export function ocrLinesToRuns(lines: OcrLine[]): TextRun[] {
  return lines
    .filter((l) => l.text.trim())
    .map((l, i) => {
      const size = Math.max(4, l.h * 0.92);
      return {
        id: `ocr-${l.id || i}`,
        text: l.text,
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
        baseline: l.y + l.h * 0.86,
        fontSize: Math.round(size * 10) / 10,
        bold: false,
        serif: false,
        mono: false,
        source: 'ocr' as const,
      };
    });
}

/** 偵測頁面上的點陣圖片位置 */
export function detectImages(ref: PageRef): Promise<DetectedImage[]> {
  if (!ref.srcId) return Promise.resolve([]);
  const key = keyOf(ref);
  let p = imgCache.get(key);
  if (!p) {
    p = computeImages(ref);
    imgCache.set(key, p);
  }
  return p;
}

type M = number[];
const mul = (m1: M, m2: M): M => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

async function computeImages(ref: PageRef): Promise<DetectedImage[]> {
  const page = await getPdfPage(ref);
  if (!page) return [];
  return findImageBoxes(page, ref.view);
}

/** 由 operator list 找出頁面上點陣圖片的位置（頁面座標：左上原點、y 向下） */
export async function findImageBoxes(page: PDFPageProxy, view: number[]): Promise<DetectedImage[]> {
  const ops = await page.getOperatorList();
  const OPS = pdfjs.OPS as any;
  const [vx0, , , vy1] = view;
  const out: DetectedImage[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const addUnitSquare = (m: M) => {
    const pts = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    if (x1 - x0 < 6 || y1 - y0 < 6) return;
    out.push({ id: `img-${out.length}`, x: x0 - vx0, y: vy1 - y1, w: x1 - x0, h: y1 - y0 });
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() || ctm;
        break;
      case OPS.transform:
        if (args && args.length >= 6) ctm = mul(ctm, args as M);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push(ctm);
        if (args?.[0] && args[0].length >= 6) ctm = mul(ctm, Array.from(args[0]) as M);
        break;
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() || ctm;
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
        addUnitSquare(ctm);
        break;
      case OPS.paintImageXObjectRepeat: {
        const [, sx, sy, positions] = args || [];
        if (positions) for (let k = 0; k < positions.length; k += 2) addUnitSquare(mul(ctm, [sx, 0, 0, sy, positions[k], positions[k + 1]]));
        break;
      }
    }
  }
  // 去除重複
  return out.filter(
    (a, i) =>
      out.findIndex((b) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1) === i,
  );
}

// ---------- 取色 / 裁切 ----------

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** 取樣區塊的背景色與前景（文字）色 */
export async function sampleColors(ref: PageRef, rect: { x: number; y: number; w: number; h: number }) {
  const S = 2;
  try {
    const canvas = await getPageRaster(ref, S);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const x0 = Math.max(0, Math.floor(rect.x * S) - 2);
    const y0 = Math.max(0, Math.floor(rect.y * S) - 2);
    const x1 = Math.min(canvas.width, Math.ceil((rect.x + rect.w) * S) + 2);
    const y1 = Math.min(canvas.height, Math.ceil((rect.y + rect.h) * S) + 2);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 2 || h < 2) return { bg: '#ffffff', fg: '#000000' };
    const data = ctx.getImageData(x0, y0, w, h).data;
    const px = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // 背景：邊框像素的眾數（量化）
    const counts = new Map<string, { n: number; c: number[] }>();
    const addBorder = (c: number[]) => {
      const k = c.map((v) => v >> 4).join(',');
      const e = counts.get(k);
      if (e) {
        e.n++;
        e.c = e.c.map((v, i) => v + c[i]);
      } else counts.set(k, { n: 1, c: [...c] });
    };
    for (let x = 0; x < w; x++) {
      addBorder(px(x, 0));
      addBorder(px(x, h - 1));
    }
    for (let y = 0; y < h; y++) {
      addBorder(px(0, y));
      addBorder(px(w - 1, y));
    }
    let best = { n: 0, c: [255, 255, 255] };
    for (const v of counts.values()) if (v.n > best.n) best = v;
    const bg = best.c.map((v) => v / best.n);
    // 前景：與背景差異最大的像素群平均
    const samples: { d: number; c: number[] }[] = [];
    const step = Math.max(1, Math.floor((w * h) / 20000));
    for (let i = 0; i < w * h; i += step) {
      const c = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
      const d = Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
      if (d > 60) samples.push({ d, c });
    }
    let fg = [0, 0, 0];
    if (samples.length) {
      samples.sort((p, q) => q.d - p.d);
      const top = samples.slice(0, Math.max(1, Math.floor(samples.length * 0.3)));
      fg = [0, 1, 2].map((k) => top.reduce((s, t) => s + t.c[k], 0) / top.length);
    }
    return { bg: hex(bg[0], bg[1], bg[2]), fg: hex(fg[0], fg[1], fg[2]) };
  } catch {
    return { bg: '#ffffff', fg: '#000000' };
  }
}

/** 由頁面點陣裁切出區塊（高解析度） */
export async function cropRegion(ref: PageRef, rect: { x: number; y: number; w: number; h: number }, scale = 3) {
  const canvas = await getPageRaster(ref, scale);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(rect.w * scale));
  out.height = Math.max(1, Math.round(rect.h * scale));
  out.getContext('2d')!.drawImage(canvas, rect.x * scale, rect.y * scale, rect.w * scale, rect.h * scale, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
