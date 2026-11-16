import type { FontKey } from '../types';

const base = import.meta.env.BASE_URL;

export const FONT_LABELS: Record<FontKey, string> = {
  noto: '思源黑體 (中文)',
  helvetica: 'Helvetica',
  times: 'Times',
  courier: 'Courier',
};

export const CSS_FAMILY: Record<FontKey, string> = {
  noto: '"PS Noto Sans TC", "Microsoft JhengHei", sans-serif',
  helvetica: 'Helvetica, Arial, "PS Noto Sans TC", sans-serif',
  times: '"Times New Roman", Times, "PS Noto Sans TC", serif',
  courier: '"Courier New", Courier, "PS Noto Sans TC", monospace',
};

/** line-height 1.2 時，基線距離行頂的比例（em） */
export const BASELINE_RATIO: Record<FontKey, number> = {
  noto: 1.036,
  helvetica: 0.947,
  times: 0.938,
  courier: 0.867,
};
export const LINE_HEIGHT = 1.2;

const byteCache = new Map<string, Promise<Uint8Array>>();
export function loadFontBytes(bold = false): Promise<Uint8Array> {
  const file = bold ? 'NotoSansTC-Bold.ttf' : 'NotoSansTC-Regular.ttf';
  let p = byteCache.get(file);
  if (!p) {
    p = fetch(`${base}fonts/${file}`).then(async (r) => {
      if (!r.ok) throw new Error(`無法載入字型 ${file}，請執行 npm run setup`);
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => byteCache.delete(file));
    byteCache.set(file, p);
  }
  return p;
}

let cssRegistered = false;
export function registerCssFonts() {
  if (cssRegistered || typeof FontFace === 'undefined') return;
  cssRegistered = true;
  const faces = [
    new FontFace('PS Noto Sans TC', `url(${base}fonts/NotoSansTC-Regular.ttf)`, { weight: '400' }),
    new FontFace('PS Noto Sans TC', `url(${base}fonts/NotoSansTC-Bold.ttf)`, { weight: '700' }),
  ];
  for (const f of faces) {
    (document.fonts as any).add(f);
    f.load().catch(() => {});
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureText(text: string, font: FontKey, size: number, bold = false) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `${bold ? 700 : 400} ${size}px ${CSS_FAMILY[font]}`;
  const lines = text.split('\n');
  return {
    w: Math.max(...lines.map((l) => measureCtx!.measureText(l).width), 1),
    h: lines.length * size * LINE_HEIGHT,
  };
}

/** 文字是否可以用 WinAnsi 標準字型輸出 */
export function isWinAnsi(text: string) {
  return /^[\x20-\x7e\xa0-\xff\n\r\t]*$/.test(text);
}
