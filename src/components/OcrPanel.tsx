import { Copy, X } from 'lucide-react';
import { useStore } from '../store';

/** 顯示 OCR 辨識結果文字 */
export default function OcrPanel() {
  const pageId = useStore((s) => s.ocrPanel);
  const pages = useStore((s) => s.pages);
  const ocr = useStore((s) => s.ocr);
  if (!pageId) return null;
  const ids = pageId === '*' ? pages.map((p) => p.id).filter((id) => ocr[id]) : [pageId];
  const text = ids
    .map((id) => {
      const n = pages.findIndex((p) => p.id === id) + 1;
      return `── 第 ${n} 頁 ──\n` + (ocr[id] || []).map((l) => l.text).join('\n');
    })
    .join('\n\n');
  return (
    <div className="ocr-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="modal-head" style={{ padding: '10px 12px' }}>
        <h2 style={{ fontSize: 14 }}>OCR 辨識結果</h2>
        <button
          className="btn icon"
          title="複製全部"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            useStore.getState().toast('已複製到剪貼簿', 'success');
          }}
        >
          <Copy size={16} />
        </button>
        <button className="btn icon" onClick={() => useStore.getState().set({ ocrPanel: null })}>
          <X size={16} />
        </button>
      </div>
      <p className="hint" style={{ margin: '8px 12px' }}>
        辨識文字已加入為隱藏文字層（儲存後可搜尋/複製）。切換到「編輯文字」工具即可直接修改辨識出的文字。
      </p>
      <textarea readOnly value={text} />
    </div>
  );
}
