// 從頁面內容串流中「真正移除」指定區域內的文字字形（而非只用色塊遮蓋）。
// 作法：解析內容串流、模擬文字矩陣，找出落在區域內的字形，
// 把該字形改寫為 TJ 陣列中的等寬位移數字 —— 其他文字的位置完全不受影響。
// 任何無法確定的情況（未知編碼、Type3 字型等）都保持原樣，仍由遮蓋色塊處理。
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { Encodings, Font, FontNames } from '@pdf-lib/standard-fonts';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} // PDF 使用者座標（y 向上）

type M = number[];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: M, x: number, y: number) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

// ---------------- 斷詞 ----------------
type Tok =
  | { t: 'num'; v: number; s: number; e: number }
  | { t: 'str'; b: number[]; s: number; e: number }
  | { t: 'name'; v: string; s: number; e: number }
  | { t: 'op'; v: string; s: number; e: number }
  | { t: '['; s: number; e: number }
  | { t: ']'; s: number; e: number }
  | { t: '<<'; s: number; e: number }
  | { t: '>>'; s: number; e: number };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

function* tokenize(d: Uint8Array): Generator<Tok> {
  let i = 0;
  const n = d.length;
  while (i < n) {
    const c = d[i];
    if (WS.has(c)) {
      i++;
      continue;
    }
    const s = i;
    if (c === 37) {
      while (i < n && d[i] !== 10 && d[i] !== 13) i++;
      continue;
    }
    if (c === 40) {
      // 字面字串
      const b: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        let ch = d[i++];
        if (ch === 92) {
          const e = d[i++];
          const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
          if (e in map) b.push(map[e]);
          else if (e >= 48 && e <= 55) {
            let v = e - 48;
            for (let k = 0; k < 2 && d[i] >= 48 && d[i] <= 55; k++) v = v * 8 + (d[i++] - 48);
            b.push(v & 255);
          } else if (e === 13) {
            if (d[i] === 10) i++;
          } else if (e !== 10) b.push(e);
          continue;
        }
        if (ch === 40) depth++;
        else if (ch === 41) {
          depth--;
          if (!depth) break;
        }
        b.push(ch);
      }
      yield { t: 'str', b, s, e: i };
      continue;
    }
    if (c === 60) {
      if (d[i + 1] === 60) {
        i += 2;
        yield { t: '<<', s, e: i };
        continue;
      }
      i++;
      let hex = '';
      while (i < n && d[i] !== 62) {
        if (!WS.has(d[i])) hex += String.fromCharCode(d[i]);
        i++;
      }
      i++;
      if (hex.length % 2) hex += '0';
      const b: number[] = [];
      for (let k = 0; k < hex.length; k += 2) b.push(parseInt(hex.slice(k, k + 2), 16));
      yield { t: 'str', b, s, e: i };
      continue;
    }
    if (c === 62 && d[i + 1] === 62) {
      i += 2;
      yield { t: '>>', s, e: i };
      continue;
    }
    if (c === 91) {
      i++;
      yield { t: '[', s, e: i };
      continue;
    }
    if (c === 93) {
      i++;
      yield { t: ']', s, e: i };
      continue;
    }
    if (c === 47) {
      i++;
      while (i < n && !WS.has(d[i]) && !DELIM.has(d[i])) i++;
      yield { t: 'name', v: String.fromCharCode(...d.subarray(s + 1, i)), s, e: i };
      continue;
    }
    while (i < n && !WS.has(d[i]) && !DELIM.has(d[i])) i++;
    if (i === s) {
      i++;
      continue;
    }
    const word = String.fromCharCode(...d.subarray(s, i));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      yield { t: 'num', v: parseFloat(word), s, e: i };
      continue;
    }
    if (word === 'BI') {
      // 內嵌圖片：跳到 EI
      let j = i;
      while (j < n) {
        if (d[j] === 73 && d[j + 1] === 68 && WS.has(d[j - 1]) && WS.has(d[j + 2])) break; // ID
        j++;
      }
      j += 3;
      while (j < n) {
        if (d[j] === 69 && d[j + 1] === 73 && WS.has(d[j - 1]) && (j + 2 >= n || WS.has(d[j + 2]))) break;
        j++;
      }
      i = Math.min(n, j + 2);
      yield { t: 'op', v: 'BI', s, e: i };
      continue;
    }
    yield { t: 'op', v: word, s, e: i };
  }
}

// ---------------- 字型寬度 ----------------
interface FontInfo {
  bytes: 1 | 2;
  width: (code: number) => number; // 1/1000 em
}

const stdFontCache = new Map<string, Font>();
let winAnsiNames: Record<number, string> | null = null;
function stdWidth(baseFont: string): ((code: number) => number) | null {
  const clean = baseFont.replace(/^[A-Z]{6}\+/, '');
  const alias: Record<string, string> = {
    Arial: FontNames.Helvetica,
    'Arial,Bold': FontNames.HelveticaBold,
    'Arial-BoldMT': FontNames.HelveticaBold,
    ArialMT: FontNames.Helvetica,
    TimesNewRoman: FontNames.TimesRoman,
    'TimesNewRoman,Bold': FontNames.TimesRomanBold,
    CourierNew: FontNames.Courier,
  };
  const name = (Object.values(FontNames) as string[]).includes(clean) ? clean : alias[clean];
  if (!name) return null;
  let f = stdFontCache.get(name);
  if (!f) {
    f = Font.load(name as any);
    stdFontCache.set(name, f);
  }
  if (!winAnsiNames) {
    winAnsiNames = {};
    for (const cp of Encodings.WinAnsi.supportedCodePoints) {
      const { code, name: gn } = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
      winAnsiNames[code] = gn;
    }
  }
  const font = f;
  return (code) => {
    const gn = winAnsiNames![code];
    const w = gn ? font.getWidthOfGlyph(gn) : undefined;
    return w ?? 500;
  };
}

function num(o: any): number | undefined {
  return o instanceof PDFNumber ? o.asNumber() : undefined;
}

function fontInfo(dict: PDFDict): FontInfo | null {
  const ctx = dict.context;
  const lookup = (o: any) => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const sub = (lookup(dict.get(PDFName.of('Subtype'))) as PDFName | undefined)?.asString();
  if (sub === '/Type3') return null;
  if (sub === '/Type0') {
    const enc = lookup(dict.get(PDFName.of('Encoding')));
    const encName = enc instanceof PDFName ? enc.asString() : '';
    if (!/Identity-[HV]|UCS2|UTF16/.test(encName)) return null;
    if (/-V$/.test(encName)) return null; // 直書不處理
    const desc = lookup(dict.get(PDFName.of('DescendantFonts'))) as PDFArray | undefined;
    const cid = desc ? (lookup(desc.get(0)) as PDFDict) : undefined;
    if (!cid) return null;
    const dw = num(lookup(cid.get(PDFName.of('DW')))) ?? 1000;
    const widths = new Map<number, number>();
    const W = lookup(cid.get(PDFName.of('W'))) as PDFArray | undefined;
    if (W) {
      const arr = W.asArray().map(lookup);
      for (let k = 0; k < arr.length; ) {
        const first = num(arr[k]);
        if (first === undefined) break;
        const next = arr[k + 1];
        if (next instanceof PDFArray) {
          next.asArray().forEach((w, j) => widths.set(first + j, num(lookup(w)) ?? dw));
          k += 2;
        } else {
          const last = num(next)!;
          const w = num(arr[k + 2]) ?? dw;
          for (let c = first; c <= last && c - first < 70000; c++) widths.set(c, w);
          k += 3;
        }
      }
    }
    // Identity 編碼時 code = CID；UCS2 編碼無法得知 CID，退回預設寬度
    const identity = /Identity/.test(encName);
    return { bytes: 2, width: (c) => (identity ? widths.get(c) ?? dw : dw) };
  }
  const first = num(lookup(dict.get(PDFName.of('FirstChar'))));
  const Widths = lookup(dict.get(PDFName.of('Widths'))) as PDFArray | undefined;
  if (Widths && first !== undefined) {
    const ws = Widths.asArray().map((w) => num(lookup(w)) ?? 0);
    const missing = num(lookup((lookup(dict.get(PDFName.of('FontDescriptor'))) as PDFDict | undefined)?.get(PDFName.of('MissingWidth')))) ?? 0;
    return { bytes: 1, width: (c) => ws[c - first] ?? missing };
  }
  const base = (lookup(dict.get(PDFName.of('BaseFont'))) as PDFName | undefined)?.asString().slice(1) || '';
  const sw = stdWidth(base);
  return sw ? { bytes: 1, width: sw } : null;
}

// ---------------- 主程式 ----------------

function contentBytes(page: PDFPage): Uint8Array | null {
  const ctx = page.doc.context;
  const contents = page.node.get(PDFName.of('Contents'));
  const resolved = contents instanceof PDFRef ? ctx.lookup(contents) : contents;
  const streams: PDFStream[] = [];
  if (resolved instanceof PDFArray) {
    for (const r of resolved.asArray()) {
      const s = r instanceof PDFRef ? ctx.lookup(r) : r;
      if (s instanceof PDFStream) streams.push(s);
    }
  } else if (resolved instanceof PDFStream) streams.push(resolved);
  else return null;
  const parts: Uint8Array[] = [];
  for (const s of streams) {
    if (s instanceof PDFRawStream) parts.push(decodePDFRawStream(s).decode());
    else parts.push((s as any).getUnencodedContents?.() ?? (s as any).getContents());
  }
  const total = parts.reduce((a, p) => a + p.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
    out[o++] = 10;
  }
  return out;
}

const hex = (codes: number[], bytes: 1 | 2) =>
  '<' + codes.map((c) => c.toString(16).padStart(bytes * 2, '0')).join('') + '>';

/**
 * 移除頁面內容串流中、落在 rects 內的文字。回傳移除的字形數。
 * 必須在 pdf-lib 於該頁繪製任何東西之前呼叫。
 */
export function removeTextInRects(page: PDFPage, rects: Rect[]): number {
  if (!rects.length) return 0;
  const data = contentBytes(page);
  if (!data) return 0;
  const ctx = page.doc.context;
  const resources = page.node.Resources();
  const fontsDict = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const fontCache = new Map<string, FontInfo | null>();
  const getFont = (name: string) => {
    if (!fontCache.has(name)) {
      let info: FontInfo | null = null;
      try {
        const fd = fontsDict?.lookupMaybe(PDFName.of(name), PDFDict);
        if (fd) info = fontInfo(fd);
      } catch {
        info = null;
      }
      fontCache.set(name, info);
    }
    return fontCache.get(name)!;
  };

  const inRect = (x: number, y: number) => rects.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);

  interface GS {
    ctm: M;
    Tc: number;
    Tw: number;
    Th: number;
    TL: number;
    font: string;
    Tfs: number;
    Ts: number;
  }
  let gs: GS = { ctm: [1, 0, 0, 1, 0, 0], Tc: 0, Tw: 0, Th: 1, TL: 0, font: '', Tfs: 0, Ts: 0 };
  const stack: GS[] = [];
  let Tm: M = [1, 0, 0, 1, 0, 0];
  let Tlm: M = [1, 0, 0, 1, 0, 0];
  const edits: { s: number; e: number; text: string }[] = [];
  let removed = 0;
  let lost = false; // 文字矩陣位置不確定（遇到無法量測的字型），直到下次重新定位

  // 運算元堆疊（含巢狀陣列）
  let operands: any[] = [];
  let arrStack: any[][] = [];
  let opStart = -1;

  const nextLine = () => {
    lost = false;
    Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm);
    Tm = Tlm;
  };

  // 處理一個文字顯示運算；回傳改寫後的 TJ（若有字形被移除）
  const showText = (items: (number[] | number)[]): string | null => {
    const f = getFont(gs.font);
    if (!f || !gs.Tfs || lost) {
      // 無法計算寬度：位置不確定，放棄改寫並標記直到重新定位
      lost = true;
      return null;
    }
    const out: (number[] | number)[] = [];
    let any = false;
    for (const it of items) {
      if (typeof it === 'number') {
        Tm = mul([1, 0, 0, 1, (-it / 1000) * gs.Tfs * gs.Th, 0], Tm);
        out.push(it);
        continue;
      }
      let kept: number[] = [];
      for (let k = 0; k + f.bytes - 1 < it.length; k += f.bytes) {
        const code = f.bytes === 2 ? (it[k] << 8) | it[k + 1] : it[k];
        const w0 = f.width(code) / 1000;
        const isSpace = f.bytes === 1 && code === 32;
        const trm = mul([gs.Tfs * gs.Th, 0, 0, gs.Tfs, 0, gs.Ts], mul(Tm, gs.ctm));
        const [cx, cy] = apply(trm, w0 / 2, 0.3);
        const tx = (w0 * gs.Tfs + gs.Tc + (isSpace ? gs.Tw : 0)) * gs.Th;
        if (inRect(cx, cy)) {
          if (kept.length) out.push(kept);
          kept = [];
          // 以等寬位移取代字形
          out.push(-((w0 * gs.Tfs + gs.Tc + (isSpace ? gs.Tw : 0)) * 1000) / gs.Tfs);
          any = true;
          removed++;
        } else kept.push(code);
        Tm = mul([1, 0, 0, 1, tx, 0], Tm);
      }
      if (kept.length) out.push(kept);
    }
    if (!any) return null;
    return '[' + out.map((x) => (typeof x === 'number' ? (Math.round(x * 1000) / 1000).toString() : hex(x, f.bytes))).join(' ') + '] TJ';
  };

  for (const tok of tokenize(data)) {
    if (opStart < 0) opStart = tok.s;
    if (tok.t === '[') {
      arrStack.push([]);
      continue;
    }
    if (tok.t === ']') {
      const a = arrStack.pop() || [];
      (arrStack.length ? arrStack[arrStack.length - 1] : operands).push(a);
      continue;
    }
    if (tok.t !== 'op') {
      const v = tok.t === 'num' ? tok.v : tok.t === 'str' ? { str: tok.b } : tok.t === 'name' ? { name: tok.v } : null;
      (arrStack.length ? arrStack[arrStack.length - 1] : operands).push(v);
      continue;
    }
    const op = tok.v;
    const a = operands;
    const N = (i: number) => (typeof a[i] === 'number' ? a[i] : 0);
    switch (op) {
      case 'q':
        stack.push({ ...gs });
        break;
      case 'Q':
        gs = stack.pop() || gs;
        break;
      case 'cm':
        gs.ctm = mul([N(0), N(1), N(2), N(3), N(4), N(5)], gs.ctm);
        break;
      case 'BT':
        lost = false;
        Tm = Tlm = [1, 0, 0, 1, 0, 0];
        break;
      case 'Tc':
        gs.Tc = N(0);
        break;
      case 'Tw':
        gs.Tw = N(0);
        break;
      case 'Tz':
        gs.Th = N(0) / 100;
        break;
      case 'TL':
        gs.TL = N(0);
        break;
      case 'Ts':
        gs.Ts = N(0);
        break;
      case 'Tf':
        gs.font = a[0]?.name || '';
        gs.Tfs = N(1);
        break;
      case 'Td':
        lost = false;
        Tlm = mul([1, 0, 0, 1, N(0), N(1)], Tlm);
        Tm = Tlm;
        break;
      case 'TD':
        lost = false;
        gs.TL = -N(1);
        Tlm = mul([1, 0, 0, 1, N(0), N(1)], Tlm);
        Tm = Tlm;
        break;
      case 'Tm':
        lost = false;
        Tm = Tlm = [N(0), N(1), N(2), N(3), N(4), N(5)];
        break;
      case 'T*':
        nextLine();
        break;
      case 'Tj':
      case "'":
      case '"': {
        let prefix = '';
        if (op === '"') {
          gs.Tw = N(0);
          gs.Tc = N(1);
          prefix = `${N(0)} Tw ${N(1)} Tc T* `;
        } else if (op === "'") prefix = 'T* ';
        if (op !== 'Tj') nextLine();
        const s = a[a.length - 1]?.str;
        if (s) {
          const r = showText([s]);
          if (r) edits.push({ s: opStart, e: tok.e, text: prefix + r });
        }
        break;
      }
      case 'TJ': {
        const arr = Array.isArray(a[0]) ? a[0] : [];
        const items = arr.map((x: any) => (typeof x === 'number' ? x : x?.str || [])).filter((x: any) => typeof x === 'number' || x.length);
        const r = showText(items);
        if (r) edits.push({ s: opStart, e: tok.e, text: r });
        break;
      }
    }
    operands = [];
    arrStack = [];
    opStart = -1;
  }

  if (!edits.length) return 0;
  // 依位置拼接新內容
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let pos = 0;
  for (const ed of edits) {
    chunks.push(data.subarray(pos, ed.s));
    chunks.push(enc.encode(ed.text));
    pos = ed.e;
  }
  chunks.push(data.subarray(pos));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    merged.set(c, o);
    o += c.length;
  }
  const stream = ctx.flateStream(merged);
  page.node.set(PDFName.of('Contents'), ctx.register(stream));
  return removed;
}
