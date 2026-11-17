import { ArrowUpToLine, Copy, Trash2 } from 'lucide-react';
import { uid, useStore } from '../store';
import { FONT_LABELS } from '../lib/fonts';
import type { FontKey, PdfObj } from '../types';

const COLORS = ['#000000', '#5f6368', '#ffffff', '#d93025', '#f29900', '#188038', '#1a73e8', '#9334e6', '#e91e63', '#795548'];
const HL = ['#ffeb3b', '#a5f36b', '#7fd8ff', '#ff9bd2', '#ffb74d'];

const TYPE_LABEL: Record<string, string> = {
  text: '文字',
  image: '圖片',
  rect: '矩形',
  ellipse: '橢圓',
  highlight: '螢光標記',
  whiteout: '白色塗改',
  line: '直線',
  ink: '手繪',
};

function Swatches({ value, onChange, list = COLORS, allowNone }: { value: string | null | undefined; onChange: (c: string | null) => void; list?: string[]; allowNone?: boolean }) {
  return (
    <div className="swatches">
      {allowNone && <div className="swatch none" title="無" onClick={() => onChange(null)} style={{ outline: value == null ? '2px solid #1473e6' : undefined }} />}
      {list.map((c) => (
        <div key={c} className="swatch" style={{ background: c, outline: value?.toLowerCase() === c ? '2px solid #1473e6' : undefined }} onClick={() => onChange(c)} />
      ))}
      <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: 22, height: 22, padding: 0, border: 'none' }} />
    </div>
  );
}

const num = (v: string, d = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

export default function PropsPanel() {
  const sel = useStore((s) => s.selected);
  const obj = useStore((s) => (s.selected ? s.objects[s.selected.pageId]?.find((o) => o.id === s.selected!.id) : undefined));
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const pages = useStore((s) => s.pages);
  const current = useStore((s) => s.currentPage);
  const st = useStore.getState;

  const upd = (patch: Partial<PdfObj>) => sel && st().updateObject(sel.pageId, sel.id, patch);

  if (obj && sel) {
    const o: any = obj;
    return (
      <div className="props">
        <h3>{TYPE_LABEL[obj.type]}屬性</h3>
        {obj.type === 'text' && (
          <>
            <div className="field">
              <label>內容</label>
              <textarea value={obj.text} rows={3} style={{ flex: 1, border: '1px solid #dadada', borderRadius: 4, padding: 4, resize: 'vertical' }} onChange={(e) => st().updateObject(sel.pageId, sel.id, { text: e.target.value }, false)} onFocus={() => st().pushHistory()} />
            </div>
            <div className="field">
              <label>字型</label>
              <select value={obj.font} onChange={(e) => upd({ font: e.target.value as FontKey })}>
                {Object.entries(FONT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>大小</label>
              <input type="number" min={2} max={400} step={0.5} value={obj.fontSize} onChange={(e) => upd({ fontSize: Math.max(2, num(e.target.value, 12)) })} />
              <button className={`btn icon outline${obj.bold ? ' active' : ''}`} title="粗體" onClick={() => upd({ bold: !obj.bold })}>
                <b>B</b>
              </button>
            </div>
            <div className="field">
              <label>顏色</label>
              <Swatches value={obj.color} onChange={(c) => upd({ color: c || '#000000' })} />
            </div>
            {obj.cover && (
              <div className="field">
                <label>底色</label>
                <Swatches value={obj.cover.color} list={['#ffffff', '#f5f5f5', '#fff8e1']} onChange={(c) => upd({ cover: { ...obj.cover!, color: c || '#ffffff' } })} />
              </div>
            )}
          </>
        )}
        {(obj.type === 'rect' || obj.type === 'ellipse') && (
          <>
            <div className="field">
              <label>框線</label>
              <Swatches value={obj.stroke} allowNone onChange={(c) => upd({ stroke: c })} />
            </div>
            <div className="field">
              <label>填色</label>
              <Swatches value={obj.fill} allowNone onChange={(c) => upd({ fill: c })} />
            </div>
          </>
        )}
        {(obj.type === 'highlight' || obj.type === 'whiteout') && (
          <div className="field">
            <label>顏色</label>
            <Swatches value={obj.fill} list={obj.type === 'highlight' ? HL : ['#ffffff', '#000000', '#f5f5f5']} onChange={(c) => upd({ fill: c || '#ffffff' })} />
          </div>
        )}
        {(obj.type === 'line' || obj.type === 'ink') && (
          <div className="field">
            <label>顏色</label>
            <Swatches value={obj.stroke} onChange={(c) => upd({ stroke: c || '#000000' })} />
          </div>
        )}
        {(obj.type === 'line' || obj.type === 'ink' || obj.type === 'rect' || obj.type === 'ellipse') && (
          <div className="field">
            <label>線寬</label>
            <input type="range" min={0.5} max={20} step={0.5} value={o.strokeWidth ?? 2} onChange={(e) => upd({ strokeWidth: num(e.target.value, 2) })} />
            <span style={{ width: 28 }}>{o.strokeWidth ?? 2}</span>
          </div>
        )}
        {obj.type === 'line' && (
          <label className="radio" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={!!obj.arrow} onChange={(e) => upd({ arrow: e.target.checked })} /> 箭頭
          </label>
        )}
        {obj.type !== 'whiteout' && (
          <div className="field">
            <label>不透明度</label>
            <input type="range" min={0.05} max={1} step={0.05} value={obj.opacity ?? (obj.type === 'highlight' ? 0.45 : 1)} onChange={(e) => upd({ opacity: num(e.target.value, 1) })} />
          </div>
        )}
        {'w' in o && (
          <>
            <h4>位置與大小 (pt)</h4>
            <div className="field">
              <label>X / Y</label>
              <input type="number" value={Math.round(o.x * 10) / 10} onChange={(e) => upd({ x: num(e.target.value) } as any)} />
              <input type="number" value={Math.round(o.y * 10) / 10} onChange={(e) => upd({ y: num(e.target.value) } as any)} />
            </div>
            <div className="field">
              <label>寬 / 高</label>
              <input type="number" value={Math.round(o.w * 10) / 10} onChange={(e) => upd({ w: Math.max(1, num(e.target.value, 1)) } as any)} />
              <input type="number" value={Math.round(o.h * 10) / 10} onChange={(e) => upd({ h: Math.max(1, num(e.target.value, 1)) } as any)} />
            </div>
          </>
        )}
        {(obj.type === 'text' || obj.type === 'image') && (
          <div className="field">
            <label>旋轉</label>
            <input type="number" step={15} value={obj.rot || 0} onChange={(e) => upd({ rot: num(e.target.value) })} />
          </div>
        )}
        <h4>動作</h4>
        <div className="row">
          <button
            className="btn outline"
            onClick={() => {
              const copy: any = { ...obj, id: uid(), cover: undefined, sourceRunId: undefined, sourceImageId: undefined };
              if ('x' in copy) {
                copy.x += 10;
                copy.y += 10;
              }
              if (copy.type === 'line') Object.assign(copy, { x1: copy.x1 + 10, y1: copy.y1 + 10, x2: copy.x2 + 10, y2: copy.y2 + 10 });
              if (copy.type === 'ink') copy.points = copy.points.map((p: number[]) => [p[0] + 10, p[1] + 10]);
              st().addObject(sel.pageId, copy);
            }}
          >
            <Copy size={14} /> 複製
          </button>
          <button className="btn outline" onClick={() => st().bringToFront(sel.pageId, sel.id)}>
            <ArrowUpToLine size={14} /> 移到最上層
          </button>
          <button className="btn outline danger" onClick={() => st().removeObject(sel.pageId, sel.id)}>
            <Trash2 size={14} /> 刪除
          </button>
        </div>
        {(o.cover || o.sourceRunId) && <p className="hint">此物件取代了原始內容；刪除它即可還原原文。</p>}
      </div>
    );
  }

  // 工具預設樣式
  const page = pages[current];
  return (
    <div className="props">
      <h3>{TOOL_TITLES[tool]}</h3>
      <p className="hint">{TOOL_HINTS[tool]}</p>
      {(tool === 'addText' || tool === 'editText') && (
        <>
          <div className="field">
            <label>字型</label>
            <select value={style.font} onChange={(e) => st().setStyle({ font: e.target.value as FontKey })}>
              {Object.entries(FONT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>大小</label>
            <input type="number" min={2} max={400} value={style.fontSize} onChange={(e) => st().setStyle({ fontSize: Math.max(2, num(e.target.value, 14)) })} />
          </div>
          <div className="field">
            <label>顏色</label>
            <Swatches value={style.color} onChange={(c) => st().setStyle({ color: c || '#000000' })} />
          </div>
        </>
      )}
      {tool === 'eraser' && (
        <div className="field">
          <label>大小</label>
          <input type="range" min={4} max={80} step={2} value={style.eraserSize} onChange={(e) => st().setStyle({ eraserSize: num(e.target.value, 16) })} />
          <span style={{ width: 44, flexShrink: 0 }}>{style.eraserSize} pt</span>
        </div>
      )}
      {tool === 'highlight' && (
        <div className="field">
          <label>顏色</label>
          <Swatches value={style.highlightColor} list={HL} onChange={(c) => st().setStyle({ highlightColor: c || '#ffeb3b' })} />
        </div>
      )}
      {['rect', 'ellipse', 'line', 'ink'].includes(tool) && (
        <>
          <div className="field">
            <label>顏色</label>
            <Swatches value={style.color} onChange={(c) => st().setStyle({ color: c || '#000000' })} />
          </div>
          {(tool === 'rect' || tool === 'ellipse') && (
            <div className="field">
              <label>填色</label>
              <Swatches value={style.fill} allowNone onChange={(c) => st().setStyle({ fill: c })} />
            </div>
          )}
          <div className="field">
            <label>線寬</label>
            <input type="range" min={0.5} max={20} step={0.5} value={style.strokeWidth} onChange={(e) => st().setStyle({ strokeWidth: num(e.target.value, 2) })} />
            <span style={{ width: 28 }}>{style.strokeWidth}</span>
          </div>
          <div className="field">
            <label>不透明度</label>
            <input type="range" min={0.05} max={1} step={0.05} value={style.opacity} onChange={(e) => st().setStyle({ opacity: num(e.target.value, 1) })} />
          </div>
        </>
      )}
      {page && (
        <>
          <h4>目前頁面</h4>
          <p className="hint">
            第 {current + 1} / {pages.length} 頁
            <br />
            尺寸：{(page.width / 72 * 25.4).toFixed(0)} × {(page.height / 72 * 25.4).toFixed(0)} mm
            <br />
            旋轉：{(page.baseRotate + page.rotate) % 360}°
          </p>
        </>
      )}
      <h4>快速鍵</h4>
      <p className="hint">
        <span className="kbd">Ctrl+Z</span> 復原 <span className="kbd">Ctrl+Y</span> 重做
        <br />
        <span className="kbd">Del</span> 刪除物件 <span className="kbd">方向鍵</span> 微調
        <br />
        <span className="kbd">Ctrl+S</span> 儲存 <span className="kbd">Ctrl+滾輪</span> 縮放
        <br />
        <span className="kbd">Esc</span> 取消 / 回到選取工具
      </p>
    </div>
  );
}

const TOOL_TITLES: Record<string, string> = {
  select: '選取',
  hand: '手形工具',
  editText: '編輯文字',
  addText: '新增文字',
  editImage: '編輯圖片',
  placeImage: '放置圖片',
  highlight: '螢光筆',
  rect: '矩形',
  ellipse: '橢圓',
  line: '直線',
  ink: '手繪',
  whiteout: '白色塗改',
  eraser: '橡皮擦',
  snapshot: '快照',
};
const TOOL_HINTS: Record<string, string> = {
  select: '點選物件可移動、縮放；雙擊文字物件可修改內容。在頁面空白處拖曳可選取並複製原始文字。',
  hand: '拖曳以平移頁面。',
  editText: '頁面上的既有文字會以虛線框標示，點一下即可直接修改（會自動取樣原文字顏色與背景色）。清空內容即可刪除該行。掃描檔請先執行 OCR。',
  addText: '在頁面上點一下輸入文字。Ctrl+Enter 或點擊外部完成。',
  editImage: '頁面上的圖片以虛線框標示，點選後可移動/縮放、取代、匯出或刪除。',
  placeImage: '在頁面上點一下放置圖片。',
  highlight: '拖曳框選要標示的區域。',
  rect: '拖曳繪製矩形。',
  ellipse: '拖曳繪製橢圓。',
  line: '拖曳繪製直線；按住 Shift 鎖定 45° 角。可在屬性中加上箭頭。',
  ink: '按住拖曳自由繪製。',
  whiteout: '拖曳框選要遮蓋的內容（輸出時會覆蓋為白色）。',
  eraser: '點一下或拖曳經過即可刪除：新增的文字、圖片、圖形、螢光筆、簽名，以及 PDF 原有的圖片（虛線框標示）。手繪線條只會擦掉經過的部分。按 Ctrl+Z 可復原整次擦除。',
  snapshot: '拖曳框選頁面上的區域，放開後會自動複製到剪貼簿（含編輯內容與註解），也可下載為 PNG，或在頁面上貼成可移動的圖片。按 Esc 取消選取。',
};
