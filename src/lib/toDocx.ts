// PDF → Word (.docx)
//  layout：保留版面且可編輯 —— 背景（圖片、色塊、線條、表格框線）為一張不含文字的影像，
//          文字以絕對定位的文字框（frame）放在原位置，字型/字級/粗體/顏色/字距貼近原檔。
//  flow  ：流動文字 —— 重建段落，圖片依位置插入段落之間，適合大幅改寫內容。
//  image ：每頁一張圖片，外觀完全相同但不可編輯。
import {
  AlignmentType,
  Document,
  FrameAnchorType,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
} from 'docx';
import { loadPdfJs, pdfjs, type PDFDocumentProxy, type PDFPageProxy } from './pdfjs';
import { findImageBoxes } from './analyze';
import { isBoldName, isItalicName, resolveFont, type WordFont } from './fontMatch';

export type DocxMode = 'layout' | 'flow' | 'image';
type Progress = (p: number, msg?: string) => void;

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;
const TW = 20; // 1pt = 20 twips
const PX = 96 / 72; // docx 圖片尺寸以 96dpi 像素表示
const RASTER = 2; // 背景影像解析度倍率（144 DPI）

// ---------------- 文字擷取 ----------------

interface Item {
  text: string;
  x: number;
  right: number;
  baseline: number; // 由上往下
  size: number;
  psName: string; // PDF 字型名稱
  generic: string; // serif / sans-serif / monospace
  bold: boolean;
  italic: boolean;
}
interface Line {
  items: Item[];
  x: number;
  right: number;
  baseline: number;
  size: number;
  text: string;
  color?: string;
}

async function extractItems(page: PDFPageProxy): Promise<{ items: Item[]; width: number; height: number }> {
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  let ops: any = null;
  try {
    ops = await page.getOperatorList(); // 讓字型物件載入，才拿得到字型名稱
  } catch {
    /* ignore */
  }
  const fauxBold = fauxBoldTexts(ops);
  const tc = await page.getTextContent();
  const items: Item[] = [];
  for (const it of tc.items as any[]) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > 0.01 * Math.abs(a) || Math.abs(c) > 0.01 * Math.abs(d) || a <= 0) continue; // 只處理水平文字
    const [x, y] = vp.convertToViewportPoint(e, f);
    let name = '';
    try {
      if (page.commonObjs.has(it.fontName)) name = page.commonObjs.get(it.fontName)?.name || '';
    } catch {
      /* ignore */
    }
    let generic = (tc.styles as any)[it.fontName]?.fontFamily || '';
    try {
      generic = page.commonObjs.get(it.fontName)?.fallbackName || generic;
    } catch {
      /* ignore */
    }
    const size = Math.hypot(c, d) || 10;
    const lead = it.str.length - it.str.trimStart().length;
    items.push({
      text: it.str.trim(),
      x: x + (lead ? (it.width / it.str.length) * lead : 0),
      right: x + (it.width || it.str.length * size * 0.5),
      baseline: y,
      size,
      psName: name,
      generic,
      bold: isBoldName(name) || isFauxBold(fauxBold, it.fontName, it.str),
      italic: isItalicName(name),
    });
  }
  return { items, width: vp.width, height: vp.height };
}

function groupLines(items: Item[]): Line[] {
  items.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const groups: Item[][] = [];
  for (const it of items) {
    const g = groups.find((G) => Math.abs(G[0].baseline - it.baseline) < Math.min(G[0].size, it.size) * 0.4);
    if (g) g.push(it);
    else groups.push([it]);
  }
  const lines: Line[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x - b.x);
    // 間距過大時拆成不同行（例如表格不同欄）
    let cur: Item[] = [];
    const flush = () => {
      if (!cur.length) return;
      const text = cur.reduce((s, it, k) => (k ? s + sep(cur[k - 1], it) + it.text : it.text), '');
      lines.push({
        items: cur,
        x: cur[0].x,
        right: Math.max(...cur.map((i) => i.right)),
        baseline: cur[0].baseline,
        size: Math.max(...cur.map((i) => i.size)),
        text,
      });
      cur = [];
    };
    for (const it of g) {
      const last = cur[cur.length - 1];
      if (last && it.x - last.right > Math.max(last.size, it.size) * 2.5) flush();
      cur.push(it);
    }
    flush();
  }
  return lines.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
}

function sep(a: Item, b: Item) {
  const gap = b.x - a.right;
  if (gap < a.size * 0.18) return '';
  if (CJK.test(a.text.slice(-1)) && CJK.test(b.text[0])) return '';
  return ' ';
}

// ---------------- 字型對應 ----------------

/**
 * 偵測「假粗體」：沒有粗體字重的字型（如標楷體），Word 會以「填滿＋描邊」模式繪製來加粗。
 * 回傳 字型 → 以描邊模式顯示過的文字片段。
 */
function fauxBoldTexts(ops: any): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!ops) return out;
  const OPS = pdfjs.OPS as any;
  let font = '';
  let mode = 0;
  const stack: { font: string; mode: number }[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push({ font, mode });
    else if (fn === OPS.restore) ({ font, mode } = stack.pop() || { font, mode });
    else if (fn === OPS.setFont) font = args?.[0] || '';
    else if (fn === OPS.setTextRenderingMode) mode = args?.[0] ?? 0;
    else if ((fn === OPS.showText || fn === OPS.showSpacedText) && (mode === 2 || mode === 6)) {
      const glyphs = args?.[0] || [];
      const text = glyphs.map((g: any) => (g && typeof g === 'object' ? g.unicode || '' : '')).join('').trim();
      if (text) out.set(font, [...(out.get(font) || []), text]);
    }
  }
  return out;
}
function isFauxBold(map: Map<string, string[]>, font: string, str: string) {
  const list = map.get(font);
  if (!list) return false;
  const t = str.trim();
  return list.some((x) => x.includes(t) || t.includes(x));
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, size: number, font: WordFont, bold: boolean, italic: boolean) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px "${font.ascii}", "${font.eastAsia}"`;
  return measureCtx.measureText(text).width;
}

// ---------------- 影像處理 ----------------

async function renderPage(page: PDFPageProxy, scale: number, noText: boolean) {
  const vp = page.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (noText) {
    // 不畫文字：攔截 fillText/strokeText
    (ctx as any).fillText = () => {};
    (ctx as any).strokeText = () => {};
  }
  await page.render({ canvasContext: ctx, canvas, viewport: vp } as any).promise;
  return { canvas, ctx };
}

const hex = (c: number[]) => c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** 比對有字/無字兩張影像，取文字顏色；若背景仍含字形（OCR 隱形文字、路徑字型）則從背景抹除 */
function processLine(line: Line, full: ImageData, bg: ImageData, bgCtx: CanvasRenderingContext2D, W: number, H: number) {
  const x0 = Math.max(0, Math.floor(line.x * RASTER) - 1);
  const x1 = Math.min(W, Math.ceil(line.right * RASTER) + 1);
  const y0 = Math.max(0, Math.floor((line.baseline - line.size * 0.95) * RASTER));
  const y1 = Math.min(H, Math.ceil((line.baseline + line.size * 0.28) * RASTER));
  if (x1 <= x0 || y1 <= y0) return;
  const hits: { d: number; i: number }[] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const d = Math.abs(full.data[i] - bg.data[i]) + Math.abs(full.data[i + 1] - bg.data[i + 1]) + Math.abs(full.data[i + 2] - bg.data[i + 2]);
      if (d > 90) hits.push({ d, i });
    }
  const area = (x1 - x0) * (y1 - y0);
  if (hits.length > area * 0.01) {
    // 只取與背景差異最大的像素（字心），避免反鋸齒邊緣讓顏色偏淡
    hits.sort((a, b) => b.d - a.d);
    const top = hits.slice(0, Math.max(1, Math.ceil(hits.length * 0.3)));
    line.color = hex([0, 1, 2].map((k) => top.reduce((sum, h) => sum + full.data[h.i + k], 0) / top.length));
    return;
  }
  // 背景中仍有這行字：以邊框眾數色為底色，取最深色群為文字色，並抹除
  const counts = new Map<string, { n: number; c: number[] }>();
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return [bg.data[i], bg.data[i + 1], bg.data[i + 2]];
  };
  const add = (c: number[]) => {
    const k = c.map((v) => v >> 4).join();
    const e = counts.get(k);
    if (e) {
      e.n++;
      e.c = e.c.map((v, j) => v + c[j]);
    } else counts.set(k, { n: 1, c: [...c] });
  };
  for (let x = x0; x < x1; x++) {
    add(px(x, y0));
    add(px(x, y1 - 1));
  }
  for (let y = y0; y < y1; y++) {
    add(px(x0, y));
    add(px(x1 - 1, y));
  }
  let best = { n: 0, c: [255, 255, 255] };
  for (const v of counts.values()) if (v.n > best.n) best = v;
  const bgc = best.c.map((v) => v / best.n);
  const ink: { d: number; c: number[] }[] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const c = px(x, y);
      const d = Math.hypot(c[0] - bgc[0], c[1] - bgc[1], c[2] - bgc[2]);
      if (d > 80) ink.push({ d, c });
    }
  ink.sort((a, b) => b.d - a.d);
  const core = ink.slice(0, Math.max(1, Math.ceil(ink.length * 0.3)));
  line.color = ink.length ? hex([0, 1, 2].map((k) => core.reduce((s, e) => s + e.c[k], 0) / core.length)) : '000000';
  if (ink.length > area * 0.01) {
    bgCtx.fillStyle = `rgb(${bgc.map(Math.round).join(',')})`;
    bgCtx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
}

function canvasToBytes(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', q = 0.85): Promise<Uint8Array> {
  return new Promise((res) => canvas.toBlob(async (b) => res(new Uint8Array(await b!.arrayBuffer())), type, q));
}

function isBlank(img: ImageData) {
  const d = img.data;
  const step = 4 * 7;
  for (let i = 0; i < d.length; i += step) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) return false;
  return true;
}

// ---------------- 段落/文字框 ----------------

function runsFor(line: Line, extraSpacingTw: number) {
  const runs: TextRun[] = [];
  line.items.forEach((it, k) => {
    const text = (k ? sep(line.items[k - 1], it) : '') + it.text;
    const font = resolveFont(it.psName, it.generic, it.text);
    runs.push(
      new TextRun({
        text,
        size: Math.max(2, Math.round(it.size * 2)),
        bold: it.bold || undefined,
        italics: it.italic || undefined,
        color: line.color,
        font: { ascii: font.ascii, hAnsi: font.ascii, eastAsia: font.eastAsia, cs: font.ascii },
        characterSpacing: extraSpacingTw || undefined,
      }),
    );
  });
  return runs;
}

/** 讓 Word 中的行寬貼近 PDF：計算每字額外字距（twips） */
function fitSpacing(line: Line) {
  const target = line.right - line.x;
  let w = 0;
  line.items.forEach((it, k) => {
    w += measure((k ? sep(line.items[k - 1], it) : '') + it.text, it.size, resolveFont(it.psName, it.generic, it.text), it.bold, it.italic);
  });
  const n = [...line.text].length;
  if (n < 2) return 0;
  const extra = (target - w) / n;
  const lim = line.size * 0.25;
  const e = Math.max(-lim, Math.min(lim, extra));
  return Math.abs(e) < 0.03 ? 0 : Math.round(e * TW);
}

interface Block {
  lines: Line[];
  pitch: number;
}

function buildBlocks(lines: Line[]): Block[] {
  const blocks: Block[] = [];
  for (const l of lines) {
    let placed = false;
    for (const b of blocks) {
      const last = b.lines[b.lines.length - 1];
      const gap = l.baseline - last.baseline;
      const sameSize = Math.abs(l.size - last.size) < 0.6;
      const overlap = Math.min(l.right, Math.max(...b.lines.map((x) => x.right))) - Math.max(l.x, Math.min(...b.lines.map((x) => x.x))) > 0;
      const pitchOk = b.lines.length < 2 || Math.abs(gap - b.pitch) < l.size * 0.15;
      if (sameSize && overlap && gap > l.size * 0.95 && gap < l.size * 1.9 && pitchOk && Math.abs(l.x - b.lines[0].x) < l.size * 6) {
        if (b.lines.length === 1) b.pitch = gap;
        b.lines.push(l);
        placed = true;
        break;
      }
    }
    if (!placed) blocks.push({ lines: [l], pitch: l.size * 1.2 });
  }
  return blocks;
}

async function layoutPage(page: PDFPageProxy, idx: number) {
  const { items, width, height } = await extractItems(page);
  const lines = groupLines(items);
  const children: Paragraph[] = [];

  // 背景影像
  const full = await renderPage(page, RASTER, false);
  const bg = await renderPage(page, RASTER, true);
  const W = bg.canvas.width;
  const H = bg.canvas.height;
  const fullData = full.ctx.getImageData(0, 0, W, H);
  const bgData = bg.ctx.getImageData(0, 0, W, H);
  for (const l of lines) processLine(l, fullData, bgData, bg.ctx, W, H);
  const bgFinal = bg.ctx.getImageData(0, 0, W, H);
  if (!isBlank(bgFinal)) {
    const data = await canvasToBytes(bg.canvas, 'image/jpeg', 0.88);
    children.push(
      new Paragraph({
        spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
        children: [
          new ImageRun({
            type: 'jpg',
            data,
            transformation: { width: width * PX, height: height * PX },
            floating: {
              horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
              verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
              behindDocument: true,
              allowOverlap: true,
              lockAnchor: true,
              wrap: { type: TextWrappingType.NONE },
            },
            altText: { name: `第${idx + 1}頁背景`, description: '頁面背景（圖片、色塊與線條）', title: '背景' },
          }),
        ],
      }),
    );
  }
  full.canvas.width = bg.canvas.width = 0;

  // 文字框
  for (const b of buildBlocks(lines)) {
    const minX = Math.min(...b.lines.map((l) => l.x));
    const maxR = Math.max(...b.lines.map((l) => l.right));
    const size = b.lines[0].size;
    const L = b.lines.length > 1 ? b.pitch : size * 1.2;
    // Word 固定行高時，基線約在行頂往下 (L - 0.2×字級) 處
    const top = b.lines[0].baseline - (L - size * 0.2);
    const fw = Math.min(width - minX, (maxR - minX) * 1.06 + size * 1.5);
    const frame = {
      type: 'absolute' as const,
      position: { x: Math.round(minX * TW), y: Math.round(Math.max(0, top) * TW) },
      width: Math.round(fw * TW),
      anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
      wrap: 'none' as any,
    };
    b.lines.forEach((l, k) => {
      const gapBefore = k ? l.baseline - b.lines[k - 1].baseline - L : 0;
      children.push(
        new Paragraph({
          frame,
          indent: l.x - minX > 0.5 ? { left: Math.round((l.x - minX) * TW) } : undefined,
          spacing: { before: Math.max(0, Math.round(gapBefore * TW)), after: 0, line: Math.round(L * TW), lineRule: LineRuleType.EXACT },
          children: runsFor(l, fitSpacing(l)),
        }),
      );
    });
  }
  if (!children.length) children.push(new Paragraph({ children: [] }));
  return {
    properties: {
      page: {
        size: { width: Math.round(width * TW), height: Math.round(height * TW) },
        margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 },
      },
    },
    children,
  };
}

async function flowPage(page: PDFPageProxy) {
  const { items, width } = await extractItems(page);
  const lines = groupLines(items);
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  const boxes = await findImageBoxes(page, vp.viewBox as number[]);
  const left = lines.length ? Math.min(...lines.map((l) => l.x)) : 72;
  const margin = Math.max(18, Math.min(left, 90));
  const textW = width - margin * 2;

  // 圖片（從整頁影像裁切）
  type Entry = { y: number; para: Paragraph };
  const entries: Entry[] = [];
  if (boxes.length) {
    const full = await renderPage(page, RASTER, false);
    for (const b of boxes) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(b.w * RASTER));
      c.height = Math.max(1, Math.round(b.h * RASTER));
      c.getContext('2d')!.drawImage(full.canvas, b.x * RASTER, b.y * RASTER, b.w * RASTER, b.h * RASTER, 0, 0, c.width, c.height);
      const data = await canvasToBytes(c, 'image/jpeg', 0.9);
      const k = Math.min(1, textW / b.w);
      const center = Math.abs(b.x + b.w / 2 - width / 2) < width * 0.08;
      entries.push({
        y: b.y,
        para: new Paragraph({
          alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
          indent: !center && b.x - margin > 4 ? { left: Math.round((b.x - margin) * TW) } : undefined,
          spacing: { before: 60, after: 60 },
          children: [new ImageRun({ type: 'jpg', data, transformation: { width: b.w * k * PX, height: b.h * k * PX } })],
        }),
      });
    }
    full.canvas.width = 0;
  }

  // 段落
  let para: Line[] = [];
  const flush = () => {
    if (!para.length) return;
    const first = para[0];
    const center = Math.abs((first.x + first.right) / 2 - width / 2) < width * 0.06 && first.right - first.x < width * 0.6;
    const runs: TextRun[] = [];
    para.forEach((l, k) => {
      if (k) {
        const prev = para[k - 1].text.slice(-1);
        if (!(CJK.test(prev) || prev === '-')) runs.push(new TextRun({ text: ' ' }));
      }
      runs.push(...runsFor(l, 0));
    });
    entries.push({
      y: first.baseline - first.size,
      para: new Paragraph({
        alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
        indent: !center && first.x - margin > 6 ? { firstLine: Math.round((first.x - margin) * TW) } : undefined,
        spacing: { after: Math.round(first.size * 6) },
        children: runs,
      }),
    });
    para = [];
  };
  // 同一基線上有多段文字（表格列、多欄）→ 以定位點排成一段
  const rows: Line[][] = [];
  for (const l of lines) {
    const r = rows.find((R) => Math.abs(R[0].baseline - l.baseline) < Math.min(R[0].size, l.size) * 0.4);
    if (r) r.push(l);
    else rows.push([l]);
  }
  for (const row of rows) {
    if (row.length < 2) continue;
    row.sort((a, b) => a.x - b.x);
    const first = row[0];
    const runs: TextRun[] = [];
    row.forEach((l, k) => {
      if (k) runs.push(new TextRun({ text: '	' }));
      runs.push(...runsFor(l, 0));
    });
    entries.push({
      y: first.baseline - first.size,
      para: new Paragraph({
        indent: first.x - margin > 2 ? { left: Math.round((first.x - margin) * TW) } : undefined,
        tabStops: row.slice(1).map((l) => ({ type: TabStopType.LEFT, position: Math.round((l.x - margin) * TW) })),
        spacing: { before: 40, after: 40 },
        children: runs,
      }),
    });
  }
  const single = new Set(rows.filter((r) => r.length === 1).map((r) => r[0]));
  for (const l of lines) {
    if (!single.has(l)) {
      flush();
      continue;
    }
    const prev = para[para.length - 1];
    if (prev) {
      const gap = l.baseline - prev.baseline;
      const same = Math.abs(l.size - prev.size) < 1 && l.items[0].bold === prev.items[0].bold;
      const prevFull = prev.right > width - margin - prev.size * 4;
      if (!same || gap > prev.size * 1.9 || gap < 0 || !prevFull) flush();
    }
    para.push(l);
  }
  flush();
  entries.sort((a, b) => a.y - b.y);
  const children = entries.map((e) => e.para);
  if (!children.length) children.push(new Paragraph({ children: [] }));
  return {
    properties: {
      page: {
        size: { width: Math.round(vp.width * TW), height: Math.round(vp.height * TW) },
        margin: { top: 720, bottom: 720, left: Math.round(margin * TW), right: Math.round(margin * TW) },
      },
    },
    children,
  };
}

async function imagePage(page: PDFPageProxy) {
  const vp = page.getViewport({ scale: 1 }); // 依頁面旋轉
  const scale = 150 / 72;
  const v = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(v.width);
  canvas.height = Math.round(v.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport: v } as any).promise;
  const data = await canvasToBytes(canvas, 'image/jpeg', 0.9);
  canvas.width = 0;
  return {
    properties: {
      page: {
        size: { width: Math.round(vp.width * TW), height: Math.round(vp.height * TW) },
        margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 },
      },
    },
    children: [
      new Paragraph({
        children: [
          new ImageRun({
            type: 'jpg',
            data,
            transformation: { width: vp.width * PX, height: vp.height * PX },
            floating: {
              horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
              verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
              behindDocument: true,
              wrap: { type: TextWrappingType.NONE },
            },
          }),
        ],
      }),
    ],
  };
}

export async function pdfToDocx(bytes: Uint8Array, mode: DocxMode, onProgress?: Progress): Promise<Blob> {
  const pdf: PDFDocumentProxy = await loadPdfJs(bytes);
  const sections: any[] = [];
  try {
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      sections.push(mode === 'layout' ? await layoutPage(page, i) : mode === 'flow' ? await flowPage(page) : await imagePage(page));
      onProgress?.((i + 1) / pdf.numPages, `轉換第 ${i + 1} / ${pdf.numPages} 頁`);
    }
  } finally {
    await pdf.destroy();
  }
  const doc = new Document({
    creator: 'PDF Editor',
    styles: { default: { document: { run: { font: 'Arial' }, paragraph: { spacing: { before: 0, after: 0 } } } } },
    sections,
  });
  return Packer.toBlob(doc);
}

