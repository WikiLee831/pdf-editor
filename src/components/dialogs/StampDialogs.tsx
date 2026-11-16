import { useState } from 'react';
import Modal, { PageRangeInput } from './Modal';
import { uid, useStore } from '../../store';
import { measureText, FONT_LABELS, LINE_HEIGHT } from '../../lib/fonts';
import { parseRange } from '../../lib/convert';
import { totalRotation } from '../../lib/pdfjs';
import type { FontKey, PageRef, PdfObj } from '../../types';

/** 顯示（已旋轉）座標 → 頁面座標 */
function visToPage(ref: PageRef, vx: number, vy: number) {
  const R = totalRotation(ref);
  const dw = R % 180 === 0 ? ref.width : ref.height;
  const dh = R % 180 === 0 ? ref.height : ref.width;
  const t = (R * Math.PI) / 180;
  const dx = vx - dw / 2;
  const dy = vy - dh / 2;
  return { x: ref.width / 2 + Math.cos(t) * dx + Math.sin(t) * dy, y: ref.height / 2 - Math.sin(t) * dx + Math.cos(t) * dy, dw, dh, R };
}

function useRange(total: number, current: number) {
  const [range, setRange] = useState('');
  const resolve = () => (range === 'current' ? [current] : parseRange(range, total));
  return { range, setRange, resolve };
}

export function WatermarkDialog() {
  const pages = useStore((s) => s.pages);
  const current = useStore((s) => s.currentPage);
  const [text, setText] = useState('機密文件');
  const [size, setSize] = useState(60);
  const [color, setColor] = useState('#d32f2f');
  const [opacity, setOpacity] = useState(0.2);
  const [angle, setAngle] = useState(-45);
  const [font, setFont] = useState<FontKey>('noto');
  const r = useRange(pages.length, current);
  const st = useStore.getState;

  const run = () => {
    let idx: number[];
    try {
      idx = r.resolve();
    } catch (e: any) {
      return st().toast(e.message, 'error');
    }
    if (!text.trim()) return;
    const s = st();
    s.pushHistory();
    const objects = { ...s.objects };
    const m = measureText(text, font, size, true);
    for (const i of idx) {
      const ref = pages[i];
      const R = totalRotation(ref);
      const theta = ((angle - 0) * Math.PI) / 180; // 視覺角度（順時針）
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const { dw, dh } = visToPage(ref, 0, 0);
      // 讓文字框中心落在頁面中心（視覺座標）
      const vx = dw / 2 - (cos * m.w) / 2 + (sin * m.h) / 2;
      const vy = dh / 2 - (sin * m.w) / 2 - (cos * m.h) / 2;
      const p = visToPage(ref, vx, vy);
      const obj: PdfObj = { id: uid(), type: 'text', x: p.x, y: p.y, text, fontSize: size, font, bold: true, color, opacity, rot: angle - R };
      objects[ref.id] = [...(objects[ref.id] || []), obj];
    }
    s.set({ objects, dialog: null });
    s.toast(`已在 ${idx.length} 頁加入浮水印（可個別選取調整或刪除）`, 'success');
  };

  return (
    <Modal
      title="加入浮水印"
      footer={
        <>
          <button className="btn outline" onClick={() => st().openDialog(null)}>
            取消
          </button>
          <button className="btn primary" onClick={run}>
            套用
          </button>
        </>
      }
    >
      <div className="field">
        <label>文字</label>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="field">
        <label>字型</label>
        <select value={font} onChange={(e) => setFont(e.target.value as FontKey)}>
          {Object.entries(FONT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>大小</label>
        <input type="number" value={size} min={8} max={300} onChange={(e) => setSize(parseFloat(e.target.value) || 60)} />
        <label>顏色</label>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      <div className="field">
        <label>不透明度</label>
        <input type="range" min={0.05} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} />
        <span style={{ width: 36 }}>{Math.round(opacity * 100)}%</span>
      </div>
      <div className="field">
        <label>角度</label>
        <select value={angle} onChange={(e) => setAngle(parseInt(e.target.value))}>
          <option value={-45}>斜向 45°</option>
          <option value={0}>水平</option>
          <option value={45}>反斜向 45°</option>
          <option value={-90}>垂直</option>
        </select>
      </div>
      <PageRangeInput value={r.range} onChange={r.setRange} total={pages.length} />
    </Modal>
  );
}

const FORMATS = [
  { v: '{n}', label: '1' },
  { v: '第 {n} 頁', label: '第 1 頁' },
  { v: '{n} / {t}', label: '1 / 10' },
  { v: '第 {n} 頁，共 {t} 頁', label: '第 1 頁，共 10 頁' },
  { v: 'Page {n} of {t}', label: 'Page 1 of 10' },
  { v: '- {n} -', label: '- 1 -' },
];
const POSITIONS = [
  { v: 'bc', label: '下方置中' },
  { v: 'br', label: '右下' },
  { v: 'bl', label: '左下' },
  { v: 'tc', label: '上方置中' },
  { v: 'tr', label: '右上' },
  { v: 'tl', label: '左上' },
];

export function PageNumberDialog() {
  const pages = useStore((s) => s.pages);
  const current = useStore((s) => s.currentPage);
  const [fmt, setFmt] = useState(FORMATS[1].v);
  const [pos, setPos] = useState('bc');
  const [size, setSize] = useState(10);
  const [margin, setMargin] = useState(28);
  const [start, setStart] = useState(1);
  const [color, setColor] = useState('#000000');
  const [header, setHeader] = useState('');
  const r = useRange(pages.length, current);
  const st = useStore.getState;

  const run = () => {
    let idx: number[];
    try {
      idx = r.resolve();
    } catch (e: any) {
      return st().toast(e.message, 'error');
    }
    const s = st();
    s.pushHistory();
    const objects = { ...s.objects };
    const total = idx.length + start - 1;
    const place = (ref: PageRef, text: string, where: string) => {
      const font: FontKey = /^[\x20-\x7e]*$/.test(text) ? 'helvetica' : 'noto';
      const m = measureText(text, font, size);
      const { dw, dh, R } = visToPage(ref, 0, 0);
      const vx = where[1] === 'l' ? margin : where[1] === 'r' ? dw - margin - m.w : (dw - m.w) / 2;
      const vy = where[0] === 't' ? margin - size * 0.2 : dh - margin - size * LINE_HEIGHT + size * 0.2;
      const p = visToPage(ref, vx, vy);
      const obj: PdfObj = { id: uid(), type: 'text', x: p.x, y: p.y, text, fontSize: size, font, color, rot: R ? -R : undefined };
      objects[ref.id] = [...(objects[ref.id] || []), obj];
    };
    idx.forEach((i, k) => {
      const ref = pages[i];
      const n = k + start;
      place(ref, fmt.replace('{n}', String(n)).replace('{t}', String(total)), pos);
      if (header.trim()) place(ref, header, pos[0] === 't' ? 'bc' : 'tc');
    });
    s.set({ objects, dialog: null });
    s.toast(`已加入頁碼至 ${idx.length} 頁`, 'success');
  };

  return (
    <Modal
      title="頁碼與頁首/頁尾"
      footer={
        <>
          <button className="btn outline" onClick={() => st().openDialog(null)}>
            取消
          </button>
          <button className="btn primary" onClick={run}>
            套用
          </button>
        </>
      }
    >
      <div className="field">
        <label>格式</label>
        <select value={fmt} onChange={(e) => setFmt(e.target.value)}>
          {FORMATS.map((f) => (
            <option key={f.v} value={f.v}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>位置</label>
        <select value={pos} onChange={(e) => setPos(e.target.value)}>
          {POSITIONS.map((f) => (
            <option key={f.v} value={f.v}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>字級</label>
        <input type="number" value={size} min={5} max={72} onChange={(e) => setSize(parseFloat(e.target.value) || 10)} />
        <label>顏色</label>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      <div className="field">
        <label>邊距 (pt)</label>
        <input type="number" value={margin} min={0} max={200} onChange={(e) => setMargin(parseFloat(e.target.value) || 0)} />
        <label>起始號</label>
        <input type="number" value={start} min={0} onChange={(e) => setStart(parseInt(e.target.value) || 1)} />
      </div>
      <div className="field">
        <label>頁首/尾文字</label>
        <input type="text" value={header} placeholder="（選填）例如文件名稱，放在頁碼的另一側" onChange={(e) => setHeader(e.target.value)} />
      </div>
      <PageRangeInput value={r.range} onChange={r.setRange} total={pages.length} />
    </Modal>
  );
}
