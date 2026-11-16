import { create } from 'zustand';
import type { OcrLine, PageRef, PdfObj, Tool, ToolStyle } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

interface Snapshot {
  pages: PageRef[];
  objects: Record<string, PdfObj[]>;
  ocr: Record<string, OcrLine[]>;
}

export type DialogName =
  | null
  | 'organize'
  | 'split'
  | 'convert'
  | 'ocr'
  | 'create'
  | 'merge'
  | 'watermark'
  | 'pagenum'
  | 'signature'
  | 'about';

interface Busy {
  message: string;
  progress?: number; // 0..1
}

interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'error' | 'success';
}

interface State extends Snapshot {
  docName: string | null;
  dirty: boolean;
  past: Snapshot[];
  future: Snapshot[];

  tool: Tool;
  selected: { pageId: string; id: string } | null;
  scale: number;
  currentPage: number;
  style: ToolStyle;
  pendingImage: { src: string; w: number; h: number } | null;
  busy: Busy | null;
  dialog: DialogName;
  toasts: Toast[];
  showThumbs: boolean;
  showProps: boolean;
  scrollToPage: { index: number; nonce: number } | null;
  ocrPanel: string | null; // 要顯示 OCR 結果的 pageId

  // 文件
  loadDocument: (name: string, pages: PageRef[]) => void;
  closeDocument: () => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // 物件
  addObject: (pageId: string, obj: PdfObj, select?: boolean) => void;
  updateObject: (pageId: string, id: string, patch: Partial<PdfObj>, record?: boolean) => void;
  removeObject: (pageId: string, id: string) => void;
  setObjects: (pageId: string, objs: PdfObj[]) => void;
  bringToFront: (pageId: string, id: string) => void;

  // 頁面
  setPages: (pages: PageRef[]) => void;
  setOcr: (pageId: string, lines: OcrLine[]) => void;

  // UI
  setTool: (t: Tool) => void;
  select: (s: { pageId: string; id: string } | null) => void;
  setScale: (s: number) => void;
  setCurrentPage: (i: number) => void;
  goToPage: (i: number) => void;
  setStyle: (p: Partial<ToolStyle>) => void;
  setPendingImage: (p: State['pendingImage']) => void;
  setBusy: (b: Busy | null) => void;
  openDialog: (d: DialogName) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  set: (p: Partial<State>) => void;
}

const snap = (s: Snapshot): Snapshot => ({ pages: s.pages, objects: s.objects, ocr: s.ocr });

export const useStore = create<State>((set, get) => ({
  docName: null,
  dirty: false,
  pages: [],
  objects: {},
  ocr: {},
  past: [],
  future: [],

  tool: 'select',
  selected: null,
  scale: 1.25,
  currentPage: 0,
  style: {
    color: '#000000',
    fill: null,
    strokeWidth: 2,
    fontSize: 14,
    font: 'noto',
    highlightColor: '#ffeb3b',
    opacity: 1,
    eraserSize: 16,
  },
  pendingImage: null,
  busy: null,
  dialog: null,
  toasts: [],
  showThumbs: true,
  showProps: true,
  scrollToPage: null,
  ocrPanel: null,

  loadDocument: (name, pages) =>
    set({
      docName: name,
      pages,
      objects: {},
      ocr: {},
      past: [],
      future: [],
      selected: null,
      currentPage: 0,
      dirty: false,
      tool: 'select',
      scrollToPage: { index: 0, nonce: Date.now() },
    }),
  closeDocument: () =>
    set({ docName: null, pages: [], objects: {}, ocr: {}, past: [], future: [], selected: null, dirty: false }),

  pushHistory: () =>
    set((s) => ({ past: [...s.past.slice(-80), snap(s)], future: [], dirty: true })),
  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return { ...prev, past: s.past.slice(0, -1), future: [snap(s), ...s.future], selected: null, dirty: true };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const next = s.future[0];
      return { ...next, future: s.future.slice(1), past: [...s.past, snap(s)], selected: null, dirty: true };
    }),

  addObject: (pageId, obj, select = true) => {
    get().pushHistory();
    set((s) => ({
      objects: { ...s.objects, [pageId]: [...(s.objects[pageId] || []), obj] },
      selected: select ? { pageId, id: obj.id } : s.selected,
    }));
  },
  updateObject: (pageId, id, patch, record = true) => {
    if (record) get().pushHistory();
    set((s) => ({
      objects: {
        ...s.objects,
        [pageId]: (s.objects[pageId] || []).map((o) => (o.id === id ? ({ ...o, ...patch } as PdfObj) : o)),
      },
      dirty: true,
    }));
  },
  removeObject: (pageId, id) => {
    get().pushHistory();
    set((s) => ({
      objects: { ...s.objects, [pageId]: (s.objects[pageId] || []).filter((o) => o.id !== id) },
      selected: s.selected?.id === id ? null : s.selected,
    }));
  },
  setObjects: (pageId, objs) => {
    get().pushHistory();
    set((s) => ({ objects: { ...s.objects, [pageId]: objs } }));
  },
  bringToFront: (pageId, id) => {
    get().pushHistory();
    set((s) => {
      const list = s.objects[pageId] || [];
      const o = list.find((x) => x.id === id);
      if (!o) return {};
      return { objects: { ...s.objects, [pageId]: [...list.filter((x) => x.id !== id), o] } };
    });
  },

  setPages: (pages) => {
    get().pushHistory();
    set((s) => ({
      pages,
      currentPage: Math.min(s.currentPage, Math.max(0, pages.length - 1)),
      selected: null,
    }));
  },
  setOcr: (pageId, lines) => {
    get().pushHistory();
    set((s) => ({ ocr: { ...s.ocr, [pageId]: lines } }));
  },

  setTool: (tool) => set({ tool, selected: tool === 'select' ? get().selected : null }),
  select: (selected) => set({ selected }),
  setScale: (scale) => set({ scale: Math.max(0.25, Math.min(5, Math.round(scale * 100) / 100)) }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  goToPage: (i) => set({ currentPage: i, scrollToPage: { index: i, nonce: Date.now() } }),
  setStyle: (p) => set((s) => ({ style: { ...s.style, ...p } })),
  setPendingImage: (pendingImage) => set({ pendingImage, tool: pendingImage ? 'placeImage' : 'select' }),
  setBusy: (busy) => set({ busy }),
  openDialog: (dialog) => set({ dialog }),
  toast: (text, kind = 'info') => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3500);
  },
  set: (p) => set(p),
}));
