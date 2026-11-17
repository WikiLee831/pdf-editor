import { useState } from 'react';
import Modal, { PageRangeInput } from './Modal';
import { useStore } from '../../store';
import { parseRange } from '../../lib/convert';
import { buildPdf } from '../../lib/exportPdf';
import { printPdfAsImages, printPdfNative } from '../../lib/print';

export default function PrintDialog() {
  const pages = useStore((s) => s.pages);
  const current = useStore((s) => s.currentPage);
  const [range, setRange] = useState('');
  const [mode, setMode] = useState<'native' | 'image'>('native');
  const [withNotes, setWithNotes] = useState(true);
  const st = useStore.getState;

  const run = async () => {
    let idx: number[];
    try {
      idx = range === 'current' ? [current] : parseRange(range, pages.length);
    } catch (e: any) {
      return st().toast(e.message, 'error');
    }
    if (!idx.length) return st().toast('沒有要列印的頁面', 'error');
    const s = st();
    s.openDialog(null);
    s.setBusy({ message: '準備列印中…', progress: 0 });
    try {
      const sel = idx.map((i) => pages[i]);
      const bytes = await buildPdf({
        pages: sel,
        objects: withNotes ? s.objects : {},
        ocr: {},
        title: s.docName?.replace(/\.pdf$/i, ''),
        onProgress: (p) => s.setBusy({ message: '準備列印中…', progress: mode === 'image' ? p * 0.3 : p }),
      });
      if (mode === 'native') {
        s.setBusy(null);
        await printPdfNative(bytes);
      } else {
        await printPdfAsImages(bytes, 200, (p) => s.setBusy({ message: '產生列印影像中…', progress: 0.3 + p * 0.7 }));
      }
    } catch (e: any) {
      st().toast(`列印失敗：${e.message || e}。可改用「影像相容模式」再試一次。`, 'error');
    } finally {
      st().setBusy(null);
    }
  };

  return (
    <Modal
      title="列印"
      footer={
        <>
          <button className="btn outline" onClick={() => st().openDialog(null)}>
            取消
          </button>
          <button className="btn primary" onClick={run}>
            列印…
          </button>
        </>
      }
    >
      <PageRangeInput value={range} onChange={setRange} total={pages.length} />
      <div className="opt-group">
        <span className="label">內容</span>
        <label className="radio">
          <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} /> 包含編輯內容與註解（文字修改、圖片、螢光筆、簽名等）
        </label>
      </div>
      <div className="opt-group">
        <span className="label">列印方式</span>
        <label className="radio">
          <input type="radio" checked={mode === 'native'} onChange={() => setMode('native')} /> 標準（向量品質，使用瀏覽器 PDF 列印）
        </label>
        <label className="radio">
          <input type="radio" checked={mode === 'image'} onChange={() => setMode('image')} /> 影像相容模式（200 DPI，標準模式無法列印時使用）
        </label>
      </div>
      <p className="hint">按下「列印…」後會開啟系統列印視窗，可在其中選擇印表機、份數、紙張與雙面列印，或選「另存為 PDF」。</p>
    </Modal>
  );
}
