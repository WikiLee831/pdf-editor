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
  | 'print'
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

/** 每個分頁（文件）各自保存的狀態 */
const DOC_KEYS = ['docName', 'dirty', 'pages', 'objects', 'ocr', 'past', 'future', 'selected', 'currentPage', 'scale', 'ocrPanel', 'fileHandle'] as const;
type DocKey = (typeof DOC_KEYS)[number];
export type DocState = Pick<State, DocKey>;
export interface DocTab {
  id: string;
  state: DocState;
}

interface State extends Snapshot {
  docs: DocTab[]; // 所有分頁；目前分頁的即時狀態放在最上層欄位
  activeDoc: string | null;
  fileHandle: any; // File System Access API 檔案代碼（可直接覆寫儲存）
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
  closeDocument: (id?: string) => void;
  switchDoc: (id: string) => void;
  /** 取得所有分頁目前的狀態（目前分頁用即時資料） */
  docStates: () => { id: string; state: DocState }[];
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

const pickDoc = (s: State): DocState => Object.fromEntries(DOC_KEYS.map((k) => [k, s[k]])) as DocState;
const blankDoc = (scale: number): DocState => ({
  docName: null,
  dirty: false,
  pages: [],
  objects: {},
  ocr: {},
  past: [],
  future: [],
  selected: null,
  currentPage: 0,
  scale,
  ocrPanel: null,
  fileHandle: null,
});

export const useStore = create<State>((set, get) => ({
  docs: [],
  activeDoc: null,
  fileHandle: null,
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
    set((s) => {
      // 目前分頁是空的就直接使用，否則開新分頁
      const reuse = s.activeDoc && !s.pages.length;
      const docs = s.docs.map((d) => (d.id === s.activeDoc ? { ...d, state: pickDoc(s) } : d));
      const id = reuse ? s.activeDoc! : uid();
      const state: DocState = { ...blankDoc(s.scale), docName: name, pages };
      return {
        ...state,
        docs: reuse ? docs.map((d) => (d.id === id ? { id, state } : d)) : [...docs, { id, state }],
        activeDoc: id,
        tool: 'select',
        pendingImage: null,
        scrollToPage: { index: 0, nonce: Date.now() },
      };
    }),
  closeDocument: (id) =>
    set((s) => {
      const target = id || s.activeDoc;
      const idx = s.docs.findIndex((d) => d.id === target);
      if (idx < 0) return {};
      const docs = s.docs.filter((d) => d.id !== target);
      if (target !== s.activeDoc) return { docs };
      const next = docs[Math.min(idx, docs.length - 1)];
      if (!next) return { ...blankDoc(s.scale), docs, activeDoc: null, tool: 'select', pendingImage: null };
      return { ...next.state, docs, activeDoc: next.id, tool: 'select', pendingImage: null, scrollToPage: null };
    }),
  switchDoc: (id) =>
    set((s) => {
      if (id === s.activeDoc) return {};
      const target = s.docs.find((d) => d.id === id);
      if (!target) return {};
      const docs = s.docs.map((d) => (d.id === s.activeDoc ? { ...d, state: pickDoc(s) } : d));
      return { ...target.state, docs, activeDoc: id, tool: 'select', pendingImage: null, scrollToPage: null };
    }),
  docStates: () => {
    const s = get();
    return s.docs.map((d) => ({ id: d.id, state: d.id === s.activeDoc ? pickDoc(s) : d.state }));
  },

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
