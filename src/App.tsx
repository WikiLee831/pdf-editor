import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Combine,
  FileOutput,
  FilePlus2,
  FolderOpen,
  Hash,
  LayoutGrid,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  ScanText,
  Scissors,
  Stamp,
  Undo2,
  ZoomIn,
  ZoomOut,
  TextCursorInput,
  Images,
  Printer,
  ClipboardPaste,
} from 'lucide-react';
import { useStore } from './store';
import { openFiles, pasteImageBlob, pasteImageFromClipboard, pickFiles, savePdf, setFileHandle } from './lib/files';
import { displaySize } from './lib/pdfjs';
import Viewer from './components/Viewer';
import ThumbPanel from './components/ThumbPanel';
import DocTabs from './components/DocTabs';
import ToolRail, { TOOL_ITEMS } from './components/ToolRail';
import PropsPanel from './components/PropsPanel';
import OcrDialog from './components/dialogs/OcrDialog';
import SplitDialog from './components/dialogs/SplitDialog';
import ConvertDialog from './components/dialogs/ConvertDialog';
import OrganizeDialog from './components/dialogs/OrganizeDialog';
import MergeDialog from './components/dialogs/MergeDialog';
import CreateDialog from './components/dialogs/CreateDialog';
import SignatureDialog from './components/dialogs/SignatureDialog';
import { PageNumberDialog, WatermarkDialog } from './components/dialogs/StampDialogs';
import AboutDialog from './components/dialogs/AboutDialog';
import PrintDialog from './components/dialogs/PrintDialog';

async function openFlow() {
  const w = window as any;
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({ multiple: true, types: [{ description: 'PDF 或圖片', accept: { 'application/pdf': ['.pdf'], 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'] } }] });
      const files: File[] = await Promise.all(handles.map((h: any) => h.getFile()));
      const pdfs = files.map((f, i) => [f, handles[i]] as const).filter(([f]) => /\.pdf$/i.test(f.name));
      // PDF 逐一開啟成分頁，並記住各自的檔案代碼（儲存時可直接覆寫原檔）
      for (const [f, h] of pdfs) if (await openFiles([f])) setFileHandle(h);
      const imgs = files.filter((f) => !/\.pdf$/i.test(f.name));
      if (imgs.length) await openFiles(imgs);
      return;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    }
  }
  const files = await pickFiles('application/pdf,.pdf,image/*', true);
  await openFiles(files);
}

function fitWidth() {
  const st = useStore.getState();
  const p = st.pages[st.currentPage];
  const ws = document.querySelector('.workspace') as HTMLElement | null;
  if (!p || !ws) return;
  const base = displaySize(p, 1);
  st.setScale((ws.clientWidth - 60) / base.w);
}
function fitPage() {
  const st = useStore.getState();
  const p = st.pages[st.currentPage];
  const ws = document.querySelector('.workspace') as HTMLElement | null;
  if (!p || !ws) return;
  const base = displaySize(p, 1);
  st.setScale(Math.min((ws.clientWidth - 60) / base.w, (ws.clientHeight - 50) / base.h));
  setTimeout(() => st.goToPage(st.currentPage), 50);
}

const TABS = [
  { icon: FilePlus2, label: '建立 PDF', dialog: 'create' },
  { icon: TextCursorInput, label: '編輯文字', run: () => useStore.getState().setTool('editText') },
  { icon: Images, label: '編輯圖片', run: () => useStore.getState().setTool('editImage') },
  { icon: ScanText, label: 'OCR 文字辨識', dialog: 'ocr' },
  { icon: LayoutGrid, label: '組織頁面', dialog: 'organize' },
  { icon: Scissors, label: '分割', dialog: 'split' },
  { icon: Combine, label: '合併', dialog: 'merge' },
  { icon: FileOutput, label: '轉換 / 匯出', dialog: 'convert' },
  { icon: Stamp, label: '浮水印', dialog: 'watermark' },
  { icon: Hash, label: '頁碼', dialog: 'pagenum' },
] as const;

export default function App() {
  const docName = useStore((s) => s.docName);
  const pages = useStore((s) => s.pages);
  const dirty = useStore((s) => s.dirty);
  const scale = useStore((s) => s.scale);
  const current = useStore((s) => s.currentPage);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const dialog = useStore((s) => s.dialog);
  const busy = useStore((s) => s.busy);
  const toasts = useStore((s) => s.toasts);
  const showThumbs = useStore((s) => s.showThumbs);
  const showProps = useStore((s) => s.showProps);
  const tool = useStore((s) => s.tool);
  const activeDoc = useStore((s) => s.activeDoc);
  const st = useStore.getState;
  const hasDoc = pages.length > 0;
  const [over, setOver] = useState(false);
  const [pageInput, setPageInput] = useState('1');

  useEffect(() => setPageInput(String(current + 1)), [current]);
  useEffect(() => {
    document.title = docName ? `${dirty ? '● ' : ''}${docName} - PDF Editor` : 'PDF Editor';
  }, [docName, dirty]);

  // 快速鍵
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      const s = st();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openFlow();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        savePdf(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (s.pages.length && !s.dialog) s.openDialog('print');
        return;
      }
      if (typing || s.dialog) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        s.setScale(s.scale * 1.2);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        s.setScale(s.scale / 1.2);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        s.setScale(1);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected) {
        e.preventDefault();
        s.removeObject(s.selected.pageId, s.selected.id);
      } else if (e.key === 'Escape') {
        if (s.selected) s.select(null);
        else s.set({ tool: 'select', pendingImage: null });
      } else if (s.selected && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        const o: any = s.objects[s.selected.pageId]?.find((x) => x.id === s.selected!.id);
        if (!o) return;
        let patch: any;
        if (o.type === 'line') patch = { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
        else if (o.type === 'ink') patch = { points: o.points.map((p: number[]) => [p[0] + dx, p[1] + dy]) };
        else patch = { x: o.x + dx, y: o.y + dy };
        s.updateObject(s.selected.pageId, s.selected.id, patch);
      } else if (!mod && !e.altKey && s.pages.length) {
        if (e.key === 'PageDown') s.goToPage(Math.min(s.pages.length - 1, s.currentPage + 1));
        else if (e.key === 'PageUp') s.goToPage(Math.max(0, s.currentPage - 1));
        else {
          const it = TOOL_ITEMS.find((x) => x !== 'sep' && x.key?.toLowerCase() === e.key.toLowerCase());
          if (it && it !== 'sep' && it.tool) s.setTool(it.tool);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 離開前提醒
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (st().docStates().some((d) => d.state.dirty)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // 拖放開檔 / 貼上圖片
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA'].includes(t.tagName) || st().dialog) return;
      const dt = e.clipboardData;
      const file =
        Array.from(dt?.files || []).find((f) => f.type.startsWith('image/')) ||
        Array.from(dt?.items || [])
          .find((i) => i.kind === 'file' && i.type.startsWith('image/'))
          ?.getAsFile();
      if (!file) return;
      e.preventDefault();
      await pasteImageBlob(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    if (hasDoc && files.every((f) => f.type.startsWith('image/')) && files.length === 1) {
      const { normalizeImage } = await import('./lib/files');
      st().setPendingImage(await normalizeImage(files[0]));
      st().toast('在頁面上點一下以放置圖片');
      return;
    }
    // 其他檔案各自開成新分頁
    await openFiles(files);
  };

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo">PDF</div>
          PDF Editor
        </div>
        <button className="btn" onClick={openFlow} title="開啟（Ctrl+O）">
          <FolderOpen size={17} /> 開啟
        </button>
        <button className="btn" onClick={() => savePdf(false)} disabled={!hasDoc} title="儲存（Ctrl+S）">
          <Save size={17} /> 儲存
        </button>
        <button className="btn" onClick={() => savePdf(true)} disabled={!hasDoc} title="另存新檔（Ctrl+Shift+S）">
          另存新檔
        </button>
        <button className="btn" onClick={() => st().openDialog('print')} disabled={!hasDoc} title="列印（Ctrl+P）">
          <Printer size={17} /> 列印
        </button>
        <button className="btn icon" onClick={pasteImageFromClipboard} title="從剪貼簿貼上圖片（Ctrl+V）">
          <ClipboardPaste size={17} />
        </button>
        <div className="spacer" />
        {hasDoc && (
          <>
            <button className="btn icon" disabled={!canUndo} onClick={() => st().undo()} title="復原（Ctrl+Z）">
              <Undo2 size={17} />
            </button>
            <button className="btn icon" disabled={!canRedo} onClick={() => st().redo()} title="重做（Ctrl+Y）">
              <Redo2 size={17} />
            </button>
            <span className="sep" />
            <button className="btn icon" disabled={current <= 0} onClick={() => st().goToPage(current - 1)} title="上一頁">
              <ChevronLeft size={17} />
            </button>
            <input
              className="page-input"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = parseInt(pageInput);
                  if (n >= 1 && n <= pages.length) st().goToPage(n - 1);
                  else setPageInput(String(current + 1));
                }
              }}
            />
            <span style={{ color: '#6e6e6e', margin: '0 4px' }}>/ {pages.length}</span>
            <button className="btn icon" disabled={current >= pages.length - 1} onClick={() => st().goToPage(current + 1)} title="下一頁">
              <ChevronRight size={17} />
            </button>
            <span className="sep" />
            <button className="btn icon" onClick={() => st().setScale(scale / 1.2)} title="縮小">
              <ZoomOut size={17} />
            </button>
            <select className="zoom-input" style={{ width: 76 }} value="" onChange={(e) => (e.target.value === 'w' ? fitWidth() : e.target.value === 'p' ? fitPage() : st().setScale(parseFloat(e.target.value)))}>
              <option value="" hidden>
                {Math.round(scale * 100)}%
              </option>
              <option value="w">符合寬度</option>
              <option value="p">整頁</option>
              {[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => (
                <option key={z} value={z}>
                  {z * 100}%
                </option>
              ))}
            </select>
            <button className="btn icon" onClick={() => st().setScale(scale * 1.2)} title="放大">
              <ZoomIn size={17} />
            </button>
            <span className="sep" />
            <button className={`btn icon${showThumbs ? ' active' : ''}`} onClick={() => st().set({ showThumbs: !showThumbs })} title="頁面縮圖">
              <PanelLeft size={17} />
            </button>
            <button className={`btn icon${showProps ? ' active' : ''}`} onClick={() => st().set({ showProps: !showProps })} title="屬性面板">
              <PanelRight size={17} />
            </button>
          </>
        )}
      </header>

      {hasDoc && <DocTabs onOpen={openFlow} />}

      {hasDoc && (
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.label}
              className="tab"
              style={(t.label === '編輯文字' && tool === 'editText') || (t.label === '編輯圖片' && tool === 'editImage') ? { background: '#fff1ec', color: '#d4380d' } : undefined}
              onClick={() => ('dialog' in t ? st().openDialog(t.dialog as any) : t.run())}
            >
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </nav>
      )}

      {hasDoc ? (
        <div className="main">
          <ToolRail />
          {showThumbs && <ThumbPanel key={`thumbs-${activeDoc}`} />}
          <Viewer key={`viewer-${activeDoc}`} docId={activeDoc!} />
          {showProps && <PropsPanel />}
        </div>
      ) : (
        <Welcome over={over} />
      )}

      {hasDoc && (
        <div className="statusbar">
          <span>
            第 {current + 1} / {pages.length} 頁
          </span>
          <span>縮放 {Math.round(scale * 100)}%</span>
          <span style={{ marginLeft: 'auto' }}>所有處理皆在本機瀏覽器完成，檔案不會上傳</span>
        </div>
      )}

      {dialog === 'ocr' && <OcrDialog />}
      {dialog === 'split' && <SplitDialog />}
      {dialog === 'convert' && <ConvertDialog />}
      {dialog === 'organize' && <OrganizeDialog />}
      {dialog === 'merge' && <MergeDialog />}
      {dialog === 'create' && <CreateDialog />}
      {dialog === 'signature' && <SignatureDialog />}
      {dialog === 'watermark' && <WatermarkDialog />}
      {dialog === 'pagenum' && <PageNumberDialog />}
      {dialog === 'about' && <AboutDialog />}
      {dialog === 'print' && <PrintDialog />}

      {busy && (
        <div className="busy">
          <div className="busy-card">
            <div className="spinner" />
            <div>{busy.message}</div>
            {busy.progress !== undefined && (
              <div className="progress">
                <div style={{ width: `${Math.round(busy.progress * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Welcome({ over }: { over: boolean }) {
  const st = useStore.getState;
  const cards = [
    { icon: FolderOpen, title: '開啟 PDF', desc: '檢視、編輯文字與圖片', run: openFlow },
    { icon: FilePlus2, title: '建立 PDF', desc: '從圖片、Word 或文字建立', run: () => st().openDialog('create') },
    { icon: Combine, title: '合併檔案', desc: '把多個 PDF / 圖片合成一份', run: () => st().openDialog('merge') },
    { icon: ScanText, title: 'OCR 辨識', desc: '掃描檔轉為可搜尋、可編輯', run: openFlow },
    { icon: Scissors, title: '分割 PDF', desc: '依頁數、範圍或大小分割', run: openFlow },
    { icon: FileOutput, title: '轉換格式', desc: 'PDF 轉 Word、圖片、文字', run: openFlow },
  ];
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className={`drop-zone${over ? ' over' : ''}`}>
          <div className="brand-logo" style={{ width: 56, height: 56, fontSize: 16, margin: '0 auto', borderRadius: 12 }}>
            PDF
          </div>
          <h1>將 PDF 或圖片拖放到這裡</h1>
          <p>免登入、免安裝外掛，所有處理都在你的電腦上完成。也可以直接按 Ctrl+V 貼上剪貼簿中的圖片。</p>
          <button className="btn primary" style={{ height: 40, padding: '0 22px', fontSize: 14 }} onClick={openFlow}>
            <FolderOpen size={18} /> 選擇檔案
          </button>
        </div>
        <div className="quick">
          {cards.map((c) => (
            <button key={c.title} className="quick-card" onClick={c.run}>
              <div className="qi">
                <c.icon size={18} />
              </div>
              <div>
                <b>{c.title}</b>
                <span>{c.desc}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
