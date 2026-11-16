// 橡皮擦：判斷游標（圓形，半徑 r，頁面座標）碰到哪些物件並刪除。
// - 手繪線條：只擦掉經過的部分（線條會被切成多段）
// - 其他物件：整個刪除
// - 取代了原始內容的物件（移動過的原圖、編輯過的原文字）：刪除新內容，但原內容維持被遮蓋，
//   避免一擦反而讓舊內容重新出現
import { uid } from '../store';
import { measureText } from './fonts';
import type { DetectedImage, PdfObj } from '../types';

type P = { x: number; y: number };

function distToSeg(p: P, a: number[], b: number[]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  let t = l ? ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * dx - p.x, a[1] + t * dy - p.y);
}

/** 圓與（可能旋轉的）矩形是否相交；rot 以 (x,y) 為軸心、順時針度數 */
function circleHitsBox(p: P, r: number, x: number, y: number, w: number, h: number, rot = 0) {
  let px = p.x - x;
  let py = p.y - y;
  if (rot) {
    const t = (-rot * Math.PI) / 180;
    [px, py] = [px * Math.cos(t) - py * Math.sin(t), px * Math.sin(t) + py * Math.cos(t)];
  }
  const cx = Math.max(0, Math.min(w, px));
  const cy = Math.max(0, Math.min(h, py));
  return Math.hypot(px - cx, py - cy) <= r;
}

export function hitObject(o: PdfObj, p: P, r: number): boolean {
  switch (o.type) {
    case 'text': {
      if (!o.text) return false; // 純遮蓋（已刪除的原文字）不再處理
      const m = measureText(o.text, o.font, o.fontSize, o.bold);
      return circleHitsBox(p, r, o.x, o.y, m.w, m.h, o.rot);
    }
    case 'image':
      return circleHitsBox(p, r, o.x, o.y, o.w, o.h, o.rot);
    case 'rect':
    case 'ellipse':
    case 'highlight':
    case 'whiteout':
      // 由原圖刪除產生的遮蓋不可再擦（否則原圖會跑回來）
      if (o.type === 'whiteout' && o.sourceImageId) return false;
      return circleHitsBox(p, r, o.x, o.y, o.w, o.h);
    case 'line':
      return distToSeg(p, [o.x1, o.y1], [o.x2, o.y2]) <= r + o.strokeWidth / 2;
    case 'ink':
      return o.points.some((q, i) => (i ? distToSeg(p, o.points[i - 1], q) : Math.hypot(q[0] - p.x, q[1] - p.y)) <= r + o.strokeWidth / 2);
  }
}

/** 把線段細分，讓橡皮擦可以擦掉線段中間 */
function densify(points: number[][], step: number) {
  const out: number[][] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** 對頁面物件套用一次擦除，回傳新的物件陣列（無變更時回傳 null） */
export function eraseAt(objs: PdfObj[], p: P, r: number): PdfObj[] | null {
  let changed = false;
  const out: PdfObj[] = [];
  for (const o of objs) {
    if (!hitObject(o, p, r)) {
      out.push(o);
      continue;
    }
    changed = true;
    if (o.type === 'ink') {
      // 只擦掉圓內的點，剩下的切成多段
      const reach = r + o.strokeWidth / 2;
      const pts = densify(o.points, Math.max(0.5, r / 3));
      let seg: number[][] = [];
      let first = true;
      const flush = () => {
        if (seg.length >= 2) {
          out.push({ ...o, id: first ? o.id : uid(), points: seg });
          first = false;
        }
        seg = [];
      };
      for (const q of pts) {
        if (Math.hypot(q[0] - p.x, q[1] - p.y) <= reach) flush();
        else seg.push(q);
      }
      flush();
    } else if (o.type === 'image' && o.cover) {
      // 移動/取代過的原圖：刪掉新圖，但原位置保持遮蓋
      out.push({ id: uid(), type: 'whiteout', x: o.cover.x, y: o.cover.y, w: o.cover.w, h: o.cover.h, fill: o.cover.color, sourceImageId: o.sourceImageId });
    } else if (o.type === 'text' && o.cover) {
      // 編輯過的原文字：清空文字，原文字仍被移除
      out.push({ ...o, text: '' });
    }
    // 其他物件：直接刪除
  }
  return changed ? out : null;
}

/** 游標碰到的原始圖片 */
export function hitImages(images: DetectedImage[], used: Set<string>, p: P, r: number) {
  return images.filter((im) => !used.has(im.id) && circleHitsBox(p, r, im.x, im.y, im.w, im.h));
}
