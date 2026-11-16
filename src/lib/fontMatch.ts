// 把 PDF 內的字型名稱（PostScript 名稱，如 "BCDEEE+DFKaiShu-SB-Estd-BF"）對應到 Word / 系統字型。
// 1) 先查常見字型對照表（中、日、韓、英）
// 2) 查不到時，從名稱還原出字型家族名，並檢查本機是否安裝
// 3) 都不行時，依字型類別（有襯線/無襯線/等寬、是否含中文）選擇最接近的預設字型

export interface WordFont {
  ascii: string; // 英數字使用的字型
  eastAsia: string; // 中日韓文字使用的字型
  cjk: boolean; // 原字型本身是中日韓字型（英數字也用它）
}

type Rule = [RegExp, string, boolean]; // [比對, Word 字型名稱, 是否為中日韓字型]

// 中日韓字型使用 Word 在中文 Windows 上的顯示名稱
const RULES: Rule[] = [
  // 繁體中文
  [/DFKai|KaiShu|BiauKai|標楷/i, '標楷體', true],
  [/MingLiU[-_]?HKSCS/i, 'MingLiU_HKSCS', true],
  [/^PMingLiU|新細明/i, '新細明體', true],
  [/MingLiU|細明/i, '細明體', true],
  [/Microsoft\s*JhengHei|MSJhengHei|微軟正黑/i, '微軟正黑體', true],
  [/DFHei|DFLiHei|華康.*黑|儷黑|LiHei/i, '微軟正黑體', true],
  [/DFMing|DFLiMing|華康.*明|儷宋|LiSong/i, '新細明體', true],
  [/NotoSansTC|NotoSansCJKtc|NotoSansCJK|SourceHanSans|思源黑/i, 'Noto Sans TC', true],
  [/NotoSerifTC|NotoSerifCJK|SourceHanSerif|思源宋/i, 'Noto Serif TC', true],
  // 簡體中文
  [/Microsoft\s*YaHei|微软雅黑/i, 'Microsoft YaHei', true],
  [/NSimSun|新宋/i, 'NSimSun', true],
  [/SimSun|宋体|STSong/i, 'SimSun', true],
  [/SimHei|黑体|STHeiti/i, 'SimHei', true],
  [/KaiTi|楷体|STKaiti/i, 'KaiTi', true],
  [/FangSong|仿宋|STFangsong/i, 'FangSong', true],
  [/DengXian|等线/i, 'DengXian', true],
  // 日文
  [/MS-?PMincho|ＭＳ\s*Ｐ明朝/i, 'MS PMincho', true],
  [/MS-?Mincho|ＭＳ\s*明朝/i, 'MS Mincho', true],
  [/MS-?PGothic|ＭＳ\s*Ｐゴシック/i, 'MS PGothic', true],
  [/MS-?Gothic|ＭＳ\s*ゴシック/i, 'MS Gothic', true],
  [/Meiryo|メイリオ/i, 'Meiryo', true],
  [/YuGothic|Yu\s*Gothic|游ゴシック/i, 'Yu Gothic', true],
  [/YuMincho|Yu\s*Mincho|游明朝/i, 'Yu Mincho', true],
  // 韓文
  [/MalgunGothic|Malgun/i, 'Malgun Gothic', true],
  [/Batang/i, 'Batang', true],
  [/Gulim/i, 'Gulim', true],
  // 西文
  [/ArialNarrow|Arial\s*Narrow/i, 'Arial Narrow', false],
  [/ArialBlack|Arial\s*Black/i, 'Arial Black', false],
  [/ArialUnicode/i, 'Arial Unicode MS', false],
  [/^Arial/i, 'Arial', false],
  [/Helvetica/i, 'Arial', false],
  [/TimesNewRoman|Times\s*New\s*Roman/i, 'Times New Roman', false],
  [/^Times/i, 'Times New Roman', false],
  [/CourierNew|Courier\s*New/i, 'Courier New', false],
  [/^Courier/i, 'Courier New', false],
  [/Calibri/i, 'Calibri', false],
  [/Cambria\s*Math|CambriaMath/i, 'Cambria Math', false],
  [/Cambria/i, 'Cambria', false],
  [/Candara/i, 'Candara', false],
  [/Consolas/i, 'Consolas', false],
  [/Constantia/i, 'Constantia', false],
  [/Corbel/i, 'Corbel', false],
  [/Aptos/i, 'Aptos', false],
  [/Georgia/i, 'Georgia', false],
  [/Verdana/i, 'Verdana', false],
  [/Tahoma/i, 'Tahoma', false],
  [/Trebuchet/i, 'Trebuchet MS', false],
  [/SegoeUI|Segoe\s*UI/i, 'Segoe UI', false],
  [/CenturyGothic|Century\s*Gothic/i, 'Century Gothic', false],
  [/^Century/i, 'Century', false],
  [/Garamond/i, 'Garamond', false],
  [/BookAntiqua|Book\s*Antiqua/i, 'Book Antiqua', false],
  [/Palatino/i, 'Palatino Linotype', false],
  [/BookmanOld|Bookman/i, 'Bookman Old Style', false],
  [/Impact/i, 'Impact', false],
  [/ComicSans|Comic\s*Sans/i, 'Comic Sans MS', false],
  [/LucidaConsole|Lucida\s*Console/i, 'Lucida Console', false],
  [/LucidaSans|Lucida\s*Sans/i, 'Lucida Sans Unicode', false],
  [/FranklinGothic/i, 'Franklin Gothic Medium', false],
  [/Gill\s*Sans|GillSans/i, 'Gill Sans MT', false],
  [/Symbol/i, 'Symbol', false],
  [/Wingdings/i, 'Wingdings', false],
];

// 已安裝字型找不到時的替代
const SUBSTITUTE: Record<string, string> = {
  'Noto Sans TC': '微軟正黑體',
  'Noto Serif TC': '新細明體',
  'MingLiU_HKSCS': '細明體',
  Aptos: 'Calibri',
};

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;

// ---------- 本機是否安裝 ----------
const installedCache = new Map<string, boolean>();
let ctx: CanvasRenderingContext2D | null = null;
export function isInstalled(family: string): boolean {
  if (installedCache.has(family)) return installedCache.get(family)!;
  ctx ??= document.createElement('canvas').getContext('2d')!;
  const sample = 'mmmmmmmmmmlliWW@#0123 中文字體測試';
  let found = false;
  for (const base of ['monospace', 'serif', 'sans-serif']) {
    ctx.font = `48px ${base}`;
    const w0 = ctx.measureText(sample).width;
    ctx.font = `48px "${family}", ${base}`;
    if (Math.abs(ctx.measureText(sample).width - w0) > 0.5) {
      found = true;
      break;
    }
  }
  installedCache.set(family, found);
  return found;
}

/** 從 PostScript 名稱還原字型家族名：BCDEEE+CenturyGothic-BoldItalic → Century Gothic */
export function familyFromPsName(name: string) {
  let n = name.replace(/^[A-Z]{6}\+/, '');
  n = n.split(/[,]/)[0];
  n = n.replace(/-(Bold|Italic|Oblique|Regular|Roman|Light|Medium|Semibold|SemiBold|Black|Heavy|Thin|Book|Condensed|BoldItalic|BoldOblique|W\d|Identity-H)+.*$/i, '');
  n = n.replace(/(PSMT|PS|MT)$/, '');
  n = n.replace(/(Regular|Bold|Italic|Light|Medium|Semibold)+$/, '');
  n = n.replace(/-/g, ' ');
  // CamelCase → 加空白
  n = n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return n.trim();
}

/** 嘗試解碼以 Big5/GBK 位元組表示的中文字型名稱 */
function decodeName(name: string) {
  if (!/[\x80-\xff]/.test(name)) return name;
  const bytes = Uint8Array.from([...name].map((c) => c.charCodeAt(0) & 0xff));
  for (const enc of ['big5', 'gbk', 'shift_jis', 'utf-8']) {
    try {
      const s = new TextDecoder(enc, { fatal: true }).decode(bytes);
      if (CJK.test(s)) return s;
    } catch {
      /* 試下一個 */
    }
  }
  return name;
}

const cache = new Map<string, WordFont>();

/**
 * @param psName  pdf.js 提供的字型名稱
 * @param generic pdf.js 的 fallbackName：'serif' | 'sans-serif' | 'monospace'
 * @param text    此字型顯示的文字（判斷是否為中文字型）
 */
export function resolveFont(psName: string, generic: string, text: string): WordFont {
  const key = `${psName}|${generic}|${CJK.test(text) ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // 去掉子集前綴（如 "BCDGEE+"），否則以 ^ 開頭的規則會比對失敗
  const name = decodeName(psName || '').replace(/^[A-Z]{6}\+/, '');
  const serif = /serif/.test(generic) && !/sans/.test(generic);
  const mono = /mono/.test(generic);
  const hasCjk = CJK.test(text);
  const defaultCjk = serif ? '新細明體' : '微軟正黑體';
  const defaultLatin = mono ? 'Courier New' : serif ? 'Times New Roman' : 'Arial';

  let family: string | null = null;
  let cjk = false;
  for (const [re, fam, isCjk] of RULES) {
    if (re.test(name)) {
      family = fam;
      cjk = isCjk;
      break;
    }
  }
  if (family && !isInstalled(family) && SUBSTITUTE[family]) family = SUBSTITUTE[family];
  if (!family) {
    const guess = familyFromPsName(name);
    if (guess && isInstalled(guess)) {
      family = guess;
      cjk = hasCjk || CJK.test(guess);
    }
  }
  let result: WordFont;
  if (family && cjk) result = { ascii: family, eastAsia: family, cjk: true };
  else if (family) result = { ascii: family, eastAsia: defaultCjk, cjk: false };
  else if (hasCjk) result = { ascii: defaultCjk, eastAsia: defaultCjk, cjk: true };
  else result = { ascii: defaultLatin, eastAsia: defaultCjk, cjk: false };
  cache.set(key, result);
  return result;
}

export function isBoldName(name: string) {
  return /bold|black|heavy|semibold|demi|w[6-9]\b|,B\b/i.test(name.replace(/^[A-Z]{6}\+/, ''));
}
export function isItalicName(name: string) {
  return /italic|oblique|,I\b|,BI\b/i.test(name.replace(/^[A-Z]{6}\+/, ''));
}
