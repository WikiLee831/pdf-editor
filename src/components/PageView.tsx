import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, ImagePlus, Move, Replace, Trash2, X } from 'lucide-react';
import { displaySize, getPdfPage, pdfjs, renderPageToCanvas, totalRotation } from '../lib/pdfjs';
import { eraseAt, hitImages } from '../lib/eraser';
import { cropRegion, detectImages, getTextRuns, ocrLinesToRuns, sampleColors } from '../lib/analyze';
import { BASELINE_RATIO, isWinAnsi } from '../lib/fonts';
import { downloadBlob, normalizeImage, pickFiles } from '../lib/files';
import { uid, useStore } from '../store';
import { blobToDataUrl, snapshotRegion, type Rect } from '../lib/snapshot';
import ObjectView, { CoverView, type DragMode } from './ObjectView';
import TextEditor from './TextEditor';
import type { DetectedImage, FontKey, PageRef, PdfObj, TextObj, TextRun } from '../types';

interface Props {
  pageRef: PageRef;
  index: number;
  scale: number;
  visible: boolean;
}

function PageView({ pageRef, index, scale, visible }: Props) {
  const R = totalRotation(pageRef);
  const { w: W, h: H } = displaySize(pageRef, scale);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pageDivRef = useRef<HTMLDivElement>(null);
  const tool = useStore((s) => s.tool);
  const [rendered, setRendered] = useState<string>('');

  // ---- 頁面渲染 ----
  useEffect(() => {
    if (!visible) return;
    const key = `${pageRef.srcId}:${pageRef.srcIndex}:${scale}:${R}`;
    if (rendered === key) return;
    const canvas = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const off = document.createElement('canvas');
    const job = renderPageToCanvas(pageRef, off, scale * dpr, R);
    job.promise
      .then(() => {
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d')!.drawImage(off, 0, 0);
        off.width = off.height = 0;
        setRendered(key);
      })
      .catch((e) => console.warn(e));
    return () => job.cancel();
  }, [visible, pageRef.srcId, pageRef.srcIndex, scale, R]);

  // ---- 可選取文字層（選取工具時） ----
  useEffect(() => {
    const div = textLayerRef.current;
    if (!div || !visible || tool !== 'select' || !pageRef.srcId) return;
    let layer: any = null;
    let cancelled = false;
    (async () => {
      const page = await getPdfPage(pageRef);
      if (!page || cancelled) return;
      const viewport = page.getViewport({ scale, rotation: R });
      div.replaceChildren();
      layer = new (pdfjs as any).TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport });
      try {
        await layer.render();
      } catch {
        /* cancelled */
      }
    })();
    return () => {
      cancelled = true;
      try {
        layer?.cancel();
      } catch {
        /* ignore */
      }
      div.replaceChildren();
    };
  }, [visible, tool, pageRef.srcId, pageRef.srcIndex, scale, R]);

  return (
    <div
      className="page"
      ref={pageDivRef}
      data-index={index}
      style={{ width: W, height: H, ['--scale-factor' as any]: scale, ['--total-scale-factor' as any]: scale, ['--user-unit' as any]: 1, ['--scale-round-x' as any]: '1px', ['--scale-round-y' as any]: '1px' }}
    >
      <span className="page-label">{index + 1}</span>
      <canvas className="page-canvas" ref={canvasRef} style={{ width: W, height: H }} />
      {tool === 'select' && <div className="textLayer" ref={textLayerRef} />}
      {visible && <Overlay pageRef={pageRef} scale={scale} W={W} H={H} R={R} pageDiv={pageDivRef} />}
    </div>
  );
}

export default memo(PageView);

// =====================================================================

interface OverlayProps {
  pageRef: PageRef;
  scale: number;
  W: number;
  H: number;
  R: number;
  pageDiv: React.RefObject<HTMLDivElement | null>;
}

type Draft =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'ink'; points: number[][] };

const pickFont = (run: TextRun): FontKey => {
  if (!isWinAnsi(run.text)) return 'noto';
  if (run.mono) return 'courier';
  if (run.serif) return 'times';
  return 'helvetica';
};

function Overlay({ pageRef, scale: s, W, H, R, pageDiv }: OverlayProps) {
  const pageId = pageRef.id;
  const objects = useStore((st) => st.objects[pageId]) || EMPTY;
  const ocrLines = useStore((st) => st.ocr[pageId]);
  const tool = useStore((st) => st.tool);
  const selected = useStore((st) => (st.selected?.pageId === pageId ? st.selected.id : null));
  const style = useStore((st) => st.style);
  const pendingImage = useStore((st) => st.pendingImage);

  const [runs, setRuns] = useState<TextRun[]>([]);
  const [images, setImages] = useState<DetectedImage[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ obj: TextObj; existingId?: string } | null>(null);
  const [selImage, setSelImage] = useState<string | null>(null);
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null);
  const [snap, setSnap] = useState<Rect | null>(null);
  const [snapBusy, setSnapBusy] = useState(false);
  const erasing = useRef<{ pushed: boolean; last: { x: number; y: number } } | null>(null);

  const w = pageRef.width * s;
  const h = pageRef.height * s;

  // 既有文字/圖片
  useEffect(() => {
    if (tool !== 'editText') return;
    let alive = true;
    getTextRuns(pageRef).then((r) => alive && setRuns(r));
    return () => {
      alive = false;
    };
  }, [tool, pageRef.srcId, pageRef.srcIndex]);
  useEffect(() => {
    if (tool !== 'editImage' && tool !== 'eraser') return;
    let alive = true;
    detectImages(pageRef).then((r) => alive && setImages(r));
    return () => {
      alive = false;
    };
  }, [tool, pageRef.srcId, pageRef.srcIndex]);
  useEffect(() => {
    if (tool !== 'editImage') setSelImage(null);
    if (tool !== 'snapshot') setSnap(null);
    if (tool !== 'editText' && tool !== 'addText' && editing) setEditing(null);
  }, [tool]);

  const allRuns = useMemo(() => [...runs, ...(ocrLines ? ocrLinesToRuns(ocrLines) : [])], [runs, ocrLines]);
  const usedRuns = useMemo(() => new Set(objects.map((o) => (o as any).sourceRunId).filter(Boolean)), [objects]);
  const usedImages = useMemo(() => new Set(objects.map((o) => (o as any).sourceImageId).filter(Boolean)), [objects]);

  // 螢幕座標 → 頁面座標
  const toPage = useCallback(
    (cx: number, cy: number) => {
      const rect = pageDiv.current!.getBoundingClientRect();
      const dx = cx - (rect.left + W / 2);
      const dy = cy - (rect.top + H / 2);
      const t = (R * Math.PI) / 180;
      const px = Math.cos(t) * dx + Math.sin(t) * dy;
      const py = -Math.sin(t) * dx + Math.cos(t) * dy;
      return { x: (px + w / 2) / s, y: (py + h / 2) / s };
    },
    [W, H, R, w, h, s],
  );

  const st = useStore.getState;
  const counterRot = R ? -R : 0;

  // ---- 物件拖曳 / 縮放 ----
  const onObjDown = (e: React.PointerEvent, obj: PdfObj, mode: DragMode) => {
    if (e.button !== 0) return;
    if (tool === 'editText' || tool === 'addText') {
      if (obj.type === 'text') {
        setEditing({ obj, existingId: obj.id });
        st().select({ pageId, id: obj.id });
        return;
      }
    }
    if (tool !== 'select') return;
    e.preventDefault();
    st().select({ pageId, id: obj.id });
    const start = toPage(e.clientX, e.clientY);
    const orig = obj as any;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = toPage(ev.clientX, ev.clientY);
      let dx = p.x - start.x;
      let dy = p.y - start.y;
      if (!moved && Math.hypot(dx * s, dy * s) < 3) return;
      if (!moved) {
        st().pushHistory();
        moved = true;
      }
      let patch: any = {};
      if (mode === 'move') {
        if (obj.type === 'line') patch = { x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy };
        else if (obj.type === 'ink') patch = { points: orig.points.map((q: number[]) => [q[0] + dx, q[1] + dy]) };
        else patch = { x: orig.x + dx, y: orig.y + dy };
      } else if (mode === 'p1') patch = { x1: orig.x1 + dx, y1: orig.y1 + dy };
      else if (mode === 'p2') patch = { x2: orig.x2 + dx, y2: orig.y2 + dy };
      else {
        let { x, y, w: ow, h: oh } = orig;
        const keep = obj.type === 'image' ? !ev.shiftKey : ev.shiftKey;
        if (keep) {
          // 等比例縮放
          const sx = (mode.endsWith('e') ? dx : -dx) / ow;
          const sy = (mode.startsWith('s') ? dy : -dy) / oh;
          const k = Math.abs(sx) > Math.abs(sy) ? sx : sy;
          dx = (mode.endsWith('e') ? 1 : -1) * k * ow;
          dy = (mode.startsWith('s') ? 1 : -1) * k * oh;
        }
        if (mode.endsWith('e')) ow += dx;
        else {
          x += dx;
          ow -= dx;
        }
        if (mode.startsWith('s')) oh += dy;
        else {
          y += dy;
          oh -= dy;
        }
        if (ow < 3 || oh < 3) return;
        patch = { x, y, w: ow, h: oh };
      }
      st().updateObject(pageId, obj.id, patch, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onObjDouble = (obj: PdfObj) => {
    if (obj.type === 'text' && tool === 'select') {
      setEditing({ obj, existingId: obj.id });
    }
  };

  // ---- 橡皮擦 ----
  const eraseStep = (p: { x: number; y: number }) => {
    const r = style.eraserSize / 2;
    const cur = st().objects[pageId] || [];
    const res = eraseAt(cur, p, r);
    const used = new Set(cur.map((o) => (o as any).sourceImageId).filter(Boolean));
    const imgs = hitImages(images, used, p, r);
    if (!res && !imgs.length) return;
    if (erasing.current && !erasing.current.pushed) {
      st().pushHistory();
      erasing.current.pushed = true;
    }
    let next = res || cur;
    for (const im of imgs) {
      const id = uid();
      next = [...next, { id, type: 'whiteout', x: im.x - 1, y: im.y - 1, w: im.w + 2, h: im.h + 2, fill: '#ffffff', sourceImageId: im.id }];
      // 以原圖周圍的背景色遮蓋
      sampleColors(pageRef, { x: im.x - 3, y: im.y - 3, w: im.w + 6, h: im.h + 6 }).then(({ bg }) => {
        if (bg !== '#ffffff') st().updateObject(pageId, id, { fill: bg }, false);
      });
    }
    const sel = st().selected;
    st().set({
      objects: { ...st().objects, [pageId]: next },
      dirty: true,
      selected: sel && sel.pageId === pageId && !next.some((o) => o.id === sel.id) ? null : sel,
    });
  };
  const eraseTo = (p: { x: number; y: number }) => {
    const e = erasing.current;
    if (!e) return;
    // 在上一點與目前點之間插點，快速拖曳也不會漏擦
    const step = Math.max(1, style.eraserSize / 4);
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - e.last.x, p.y - e.last.y) / step));
    for (let k = 1; k <= n; k++) eraseStep({ x: e.last.x + ((p.x - e.last.x) * k) / n, y: e.last.y + ((p.y - e.last.y) * k) / n });
    e.last = p;
  };

  // ---- 在空白處按下：繪圖工具 ----
  const onBgDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toPage(e.clientX, e.clientY);
    if (tool === 'select') {
      st().select(null);
      return;
    }
    if (tool === 'editImage') {
      setSelImage(null);
      return;
    }
    if (tool === 'editText') return;
    if (tool === 'eraser') {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      erasing.current = { pushed: false, last: p };
      eraseStep(p);
      return;
    }
    if (tool === 'addText') {
      e.preventDefault();
      if (editing) return; // 先讓目前的編輯 blur
      const size = style.fontSize;
      setEditing({
        obj: {
          id: uid(),
          type: 'text',
          x: p.x,
          y: p.y - size * 0.6,
          text: '',
          fontSize: size,
          font: style.font,
          color: style.color,
          rot: counterRot || undefined,
        },
      });
      return;
    }
    if (tool === 'placeImage' && pendingImage) {
      e.preventDefault();
      const maxW = pageRef.width * 0.4;
      const k = Math.min(1, maxW / pendingImage.w);
      const iw = pendingImage.w * k;
      const ih = pendingImage.h * k;
      st().addObject(pageId, { id: uid(), type: 'image', x: p.x - iw / 2, y: p.y - ih / 2, w: iw, h: ih, src: pendingImage.src, rot: counterRot || undefined });
      st().set({ pendingImage: null, tool: 'select' });
      return;
    }
    if (tool === 'snapshot') setSnap(null);
    if (['highlight', 'rect', 'ellipse', 'whiteout', 'line', 'ink', 'snapshot'].includes(tool)) {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const d: Draft = tool === 'ink' ? { kind: 'ink', points: [[p.x, p.y]] } : tool === 'line' ? { kind: 'line', x0: p.x, y0: p.y, x1: p.x, y1: p.y } : { kind: 'rect', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      setDraft(d);
    }
  };
  const onBgMove = (e: React.PointerEvent) => {
    if (tool === 'eraser') {
      const p = toPage(e.clientX, e.clientY);
      setEraserPos(p);
      if (erasing.current) eraseTo(p);
      return;
    }
    if (!draft) return;
    const p = toPage(e.clientX, e.clientY);
    if (draft.kind === 'ink') setDraft({ ...draft, points: [...draft.points, [p.x, p.y]] });
    else if (draft.kind === 'line' && e.shiftKey) {
      const dx = p.x - draft.x0;
      const dy = p.y - draft.y0;
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      setDraft({ ...draft, x1: draft.x0 + len * Math.cos(a), y1: draft.y0 + len * Math.sin(a) });
    } else setDraft({ ...draft, x1: p.x, y1: p.y });
  };
  const onBgUp = () => {
    erasing.current = null;
    if (!draft) return;
    const d = draft;
    setDraft(null);
    const id = uid();
    if (d.kind === 'ink') {
      if (d.points.length < 2) return;
      st().addObject(pageId, { id, type: 'ink', points: simplify(d.points, 0.4), stroke: style.color, strokeWidth: style.strokeWidth, opacity: style.opacity }, false);
      return;
    }
    if (d.kind === 'line') {
      if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 2) return;
      st().addObject(pageId, { id, type: 'line', x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1, stroke: style.color, strokeWidth: style.strokeWidth, opacity: style.opacity });
      return;
    }
    const x = Math.min(d.x0, d.x1);
    const y = Math.min(d.y0, d.y1);
    const rw = Math.abs(d.x1 - d.x0);
    const rh = Math.abs(d.y1 - d.y0);
    if (rw < 2 || rh < 2) return;
    if (tool === 'snapshot') {
      const r = { x, y, w: rw, h: rh };
      setSnap(r);
      snapAction(r, 'copy');
      return;
    }
    if (tool === 'highlight') st().addObject(pageId, { id, type: 'highlight', x, y, w: rw, h: rh, fill: style.highlightColor, opacity: 0.45 }, false);
    else if (tool === 'whiteout') st().addObject(pageId, { id, type: 'whiteout', x, y, w: rw, h: rh, fill: '#ffffff' }, false);
    else st().addObject(pageId, { id, type: tool as 'rect' | 'ellipse', x, y, w: rw, h: rh, stroke: style.color, fill: style.fill, strokeWidth: style.strokeWidth, opacity: style.opacity });
  };

  // ---- 快照 ----
  const snapAction = async (r: Rect, action: 'copy' | 'download' | 'paste') => {
    const make = () => snapshotRegion(pageRef, r, R, 3);
    const pageNo = st().pages.findIndex((p) => p.id === pageId) + 1;
    setSnapBusy(true);
    try {
      if (action === 'copy') {
        // 以 Promise 形式交給剪貼簿，確保在使用者操作的有效期間內寫入
        const blob = make();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        st().toast('已將選取區域複製到剪貼簿，可在其他程式或本頁按 Ctrl+V 貼上', 'success');
      } else if (action === 'download') {
        downloadBlob(await make(), `快照_第${pageNo}頁.png`);
      } else {
        const src = await blobToDataUrl(await make());
        const sideways = R % 180 !== 0;
        const w = sideways ? r.h : r.w;
        const h = sideways ? r.w : r.h;
        const cx = r.x + r.w / 2 + 12;
        const cy = r.y + r.h / 2 + 12;
        const id = uid();
        st().addObject(pageId, { id, type: 'image', x: cx - w / 2, y: cy - h / 2, w, h, src, rot: counterRot || undefined });
        st().setTool('select');
        st().select({ pageId, id });
        st().toast('已貼上快照圖片，可拖曳到其他位置', 'success');
      }
    } catch (e: any) {
      if (action === 'copy') st().toast(`無法寫入剪貼簿（${e?.message || e}），請改用「下載 PNG」`, 'error');
      else st().toast(`快照失敗：${e?.message || e}`, 'error');
    } finally {
      setSnapBusy(false);
    }
  };

  // ---- 編輯既有文字 ----
  const startEditRun = async (run: TextRun) => {
    if (editing) return;
    const font = pickFont(run);
    const { bg, fg } = await sampleColors(pageRef, run);
    const pad = Math.max(0.8, run.fontSize * 0.06);
    setEditing({
      obj: {
        id: uid(),
        type: 'text',
        x: run.x,
        y: run.baseline - run.fontSize * BASELINE_RATIO[font],
        text: run.text,
        fontSize: run.fontSize,
        font,
        bold: run.bold,
        color: fg,
        cover: { x: run.x - pad, y: run.y - pad, w: run.w + pad * 2, h: run.h + pad * 2, color: bg },
        sourceRunId: run.id,
      },
    });
  };

  const commitEdit = (text: string) => {
    const ed = editing;
    setEditing(null);
    if (!ed) return;
    if (ed.existingId) {
      const cur = objects.find((o) => o.id === ed.existingId) as TextObj | undefined;
      if (!cur || cur.text === text) return;
      if (!text && !cur.cover) st().removeObject(pageId, cur.id);
      else st().updateObject(pageId, cur.id, { text });
      return;
    }
    const isRun = !!ed.obj.sourceRunId;
    if (!isRun && !text.trim()) return;
    if (isRun && text === ed.obj.text) return;
    st().addObject(pageId, { ...ed.obj, text });
  };

  // ---- 既有圖片操作 ----
  const imgAction = async (img: DetectedImage, action: 'delete' | 'replace' | 'move' | 'export' | 'copy') => {
    const pad = 0.5;
    const rect = { x: img.x - pad, y: img.y - pad, w: img.w + pad * 2, h: img.h + pad * 2 };
    if (action === 'export') {
      const url = await cropRegion(pageRef, img, 4);
      const blob = await (await fetch(url)).blob();
      downloadBlob(blob, `圖片_第${st().pages.findIndex((p) => p.id === pageId) + 1}頁.png`);
      return;
    }
    if (action === 'copy') {
      const url = await cropRegion(pageRef, img, 4);
      const blob = await (await fetch(url)).blob();
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        st().toast('已複製圖片', 'success');
      } catch {
        st().toast('瀏覽器不允許寫入剪貼簿', 'error');
      }
      return;
    }
    const { bg } = await sampleColors(pageRef, { x: img.x - 3, y: img.y - 3, w: img.w + 6, h: img.h + 6 });
    if (action === 'delete') {
      st().addObject(pageId, { id: uid(), type: 'whiteout', ...rect, fill: bg, sourceImageId: img.id }, false);
    } else if (action === 'replace') {
      const [file] = await pickFiles('image/*');
      if (!file) return;
      const n = await normalizeImage(file);
      // 保持原框，依新圖比例置中
      const k = Math.min(img.w / n.w, img.h / n.h);
      const nw = n.w * k;
      const nh = n.h * k;
      st().addObject(pageId, { id: uid(), type: 'image', x: img.x + (img.w - nw) / 2, y: img.y + (img.h - nh) / 2, w: nw, h: nh, src: n.src, cover: { ...rect, color: bg }, sourceImageId: img.id });
    } else if (action === 'move') {
      const src = await cropRegion(pageRef, img, 3);
      st().addObject(pageId, { id: uid(), type: 'image', x: img.x, y: img.y, w: img.w, h: img.h, src, cover: { ...rect, color: bg }, sourceImageId: img.id });
      st().setTool('select');
      st().select({ pageId, id: st().objects[pageId].at(-1)!.id });
    }
    setSelImage(null);
  };

  const interactive = tool === 'select' || tool === 'editText' || tool === 'addText';
  const cls = ['overlay', `tool-${tool}`];
  if (tool === 'select') cls.push('passive');
  else if (['highlight', 'rect', 'ellipse', 'whiteout', 'line', 'ink', 'placeImage', 'snapshot'].includes(tool)) cls.push('crosshair');
  else if (tool === 'addText') cls.push('texting');
  else if (tool === 'eraser') cls.push('erasing');
  if (tool === 'hand') cls.push('passive');

  const sel = images.find((i) => i.id === selImage);

  return (
    <div
      className={cls.join(' ')}
      style={{ left: (W - w) / 2, top: (H - h) / 2, width: w, height: h, transform: R ? `rotate(${R}deg)` : undefined, pointerEvents: tool === 'select' || tool === 'hand' ? 'none' : 'auto' }}
      onPointerDown={onBgDown}
      onPointerMove={onBgMove}
      onPointerUp={onBgUp}
      onPointerLeave={() => setEraserPos(null)}
    >
      {/* 既有文字（編輯模式） */}
      {tool === 'editText' &&
        allRuns
          .filter((r) => !usedRuns.has(r.id) && editing?.obj.sourceRunId !== r.id)
          .map((r) => (
            <div
              key={r.id}
              className={`run${r.source === 'ocr' ? ' ocr' : ''}`}
              title={r.source === 'ocr' ? 'OCR 辨識文字 — 點一下編輯' : '點一下編輯文字'}
              style={{ left: r.x * s - 1, top: r.y * s - 1, width: r.w * s + 2, height: r.h * s + 2 }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                startEditRun(r);
              }}
            />
          ))}

      {/* 遮蓋層在下 */}
      {objects.map((o) => (
        <CoverView key={'c' + o.id} obj={o} s={s} />
      ))}
      {editing?.obj.cover && !editing.existingId && <CoverView obj={editing.obj} s={s} />}

      {objects.map((o) => (
        <ObjectView
          key={o.id}
          obj={o}
          s={s}
          selected={selected === o.id}
          interactive={interactive && !(tool !== 'select' && o.type !== 'text')}
          hidden={editing?.existingId === o.id}
          onDown={onObjDown}
          onDouble={onObjDouble}
        />
      ))}

      {editing && (
        <TextEditor
          key={editing.obj.id}
          obj={editing.existingId ? (objects.find((o) => o.id === editing.existingId) as TextObj) || editing.obj : editing.obj}
          s={s}
          onCommit={commitEdit}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* 既有圖片（編輯圖片模式） */}
      {tool === 'editImage' &&
        images
          .filter((i) => !usedImages.has(i.id))
          .map((i) => (
            <div
              key={i.id}
              className={`img-box${selImage === i.id ? ' selected' : ''}`}
              style={{ left: i.x * s, top: i.y * s, width: i.w * s, height: i.h * s }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setSelImage(i.id);
              }}
            />
          ))}
      {tool === 'editImage' && sel && (
        <div
          className="img-actions"
          style={{ left: sel.x * s, top: Math.max(0, sel.y * s - 40), transform: R ? `rotate(${-R}deg)` : undefined, transformOrigin: '0 100%' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button className="btn" onClick={() => imgAction(sel, 'move')}>
            <Move size={14} /> 移動/縮放
          </button>
          <button className="btn" onClick={() => imgAction(sel, 'replace')}>
            <Replace size={14} /> 取代
          </button>
          <button className="btn" onClick={() => imgAction(sel, 'export')}>
            <Download size={14} /> 匯出
          </button>
          <button className="btn" onClick={() => imgAction(sel, 'copy')}>
            <Copy size={14} /> 複製
          </button>
          <button className="btn danger" onClick={() => imgAction(sel, 'delete')}>
            <Trash2 size={14} /> 刪除
          </button>
        </div>
      )}
      {tool === 'editImage' && images.length === 0 && <EmptyHint text="此頁沒有偵測到點陣圖片。可使用左側「插入圖片」新增。" R={R} />}
      {tool === 'editText' && allRuns.length === 0 && <EmptyHint text="此頁沒有可編輯的文字（可能是掃描影像）。請先執行「OCR 文字辨識」，辨識後即可編輯。" R={R} />}

      {/* 橡皮擦游標 */}
      {tool === 'eraser' && eraserPos && (
        <div
          className="eraser-cursor"
          style={{ left: (eraserPos.x - style.eraserSize / 2) * s, top: (eraserPos.y - style.eraserSize / 2) * s, width: style.eraserSize * s, height: style.eraserSize * s }}
        />
      )}
      {tool === 'eraser' && images.filter((i) => !usedImages.has(i.id)).map((i) => (
        <div key={'e' + i.id} className="img-box erasable" style={{ left: i.x * s, top: i.y * s, width: i.w * s, height: i.h * s }} />
      ))}

      {/* 快照選取區 */}
      {tool === 'snapshot' && snap && !draft && (
        <>
          <div className="snap-box" style={{ left: snap.x * s, top: snap.y * s, width: snap.w * s, height: snap.h * s }} />
          <div
            className="img-actions"
            style={{ left: snap.x * s, top: snap.y * s + snap.h * s + 6 > h - 36 ? Math.max(0, snap.y * s - 40) : snap.y * s + snap.h * s + 6, transform: R ? `rotate(${-R}deg)` : undefined, transformOrigin: '0 0' }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button className="btn" disabled={snapBusy} onClick={() => snapAction(snap, 'copy')}>
              <Copy size={14} /> 複製
            </button>
            <button className="btn" disabled={snapBusy} onClick={() => snapAction(snap, 'download')}>
              <Download size={14} /> 下載 PNG
            </button>
            <button className="btn" disabled={snapBusy} onClick={() => snapAction(snap, 'paste')}>
              <ImagePlus size={14} /> 貼為圖片
            </button>
            <button className="btn icon" title="取消選取" onClick={() => setSnap(null)}>
              <X size={14} />
            </button>
          </div>
        </>
      )}

      {/* 繪製中 */}
      {draft?.kind === 'rect' && (
        <div
          className="draft"
          style={{
            left: Math.min(draft.x0, draft.x1) * s,
            top: Math.min(draft.y0, draft.y1) * s,
            width: Math.abs(draft.x1 - draft.x0) * s,
            height: Math.abs(draft.y1 - draft.y0) * s,
            borderRadius: tool === 'ellipse' ? '50%' : undefined,
            background: tool === 'highlight' ? style.highlightColor + '77' : tool === 'whiteout' ? '#fff' : undefined,
          }}
        />
      )}
      {draft && draft.kind !== 'rect' && (
        <svg className="svg-layer">
          <path
            d={draft.kind === 'ink' ? draft.points.map((p, i) => `${i ? 'L' : 'M'}${p[0] * s} ${p[1] * s}`).join(' ') : `M${draft.x0 * s} ${draft.y0 * s} L${draft.x1 * s} ${draft.y1 * s}`}
            stroke={style.color}
            strokeWidth={style.strokeWidth * s}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={style.opacity}
          />
        </svg>
      )}
    </div>
  );
}

const EMPTY: PdfObj[] = [];

function EmptyHint({ text, R }: { text: string; R: number }) {
  return (
    <div style={{ position: 'absolute', left: '50%', top: 16, transform: `translateX(-50%) ${R ? `rotate(${-R}deg)` : ''}`, background: '#323232e0', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 12, maxWidth: '80%', textAlign: 'center', pointerEvents: 'none' }}>
      {text}
    </div>
  );
}

/** Ramer–Douglas–Peucker 簡化手繪點 */
function simplify(pts: number[][], tol: number): number[][] {
  if (pts.length < 3) return pts;
  const sq = tol * tol;
  const dist = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx - p[0];
    const y = a[1] + t * dy - p[1];
    return x * x + y * y;
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = dist(pts[i], pts[a], pts[b]);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > sq && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

