import { useState } from 'react';
import { FileCode2, FileImage, FileText, FileType2 } from 'lucide-react';
import Modal, { PageRangeInput } from './Modal';
import { useStore } from '../../store';
import { baseName, currentPdfBytes, saveBlobAs, zipAndDownload } from '../../lib/files';
import { parseRange, pdfToDocx, pdfToHtml, pdfToImages, pdfToText, type DocxMode } from '../../lib/convert';

type Fmt = 'docx' | 'png' | 'jpeg' | 'txt' | 'html';

export default function ConvertDialog() {
  const pages = useStore((s) => s.pages);
  const current = useStore((s) => s.currentPage);
  const docName = useStore((s) => s.docName);
  const [fmt, setFmt] = useState<Fmt>('docx');
  const [docxMode, setDocxMode] = useState<DocxMode>('layout');
  const [dpi, setDpi] = useState(150);
  const [range, setRange] = useState('');
  const st = useStore.getState;

  const run = async () => {
    let idx: number[];
    try {
      idx = range === 'current' ? [current] : parseRange(range, pages.length);
    } catch (e: any) {
      return st().toast(e.message, 'error');
    }
    st().openDialog(null);
    const progress = (p: number, msg?: string) => st().setBusy({ message: msg || '轉換中…', progress: p });
    st().setBusy({ message: '準備文件…', progress: 0 });
    const base = baseName(docName);
    try {
      const bytes = await currentPdfBytes();
      if (fmt === 'png' || fmt === 'jpeg') {
        const files = await pdfToImages(bytes, { dpi, format: fmt, pages: idx }, progress);
        await zipAndDownload(
          files.map((f) => ({ ...f, name: `${base}_${f.name}` })),
          `${base}_圖片.zip`,
        );
      } else {
        // 其他格式先擷取頁面範圍
        let src = bytes;
        if (idx.length !== pages.length) {
          const { extractPages } = await import('../../lib/exportPdf');
          src = await extractPages(bytes, idx);
        }
        if (fmt === 'docx') {
          const blob = await pdfToDocx(src, docxMode, progress);
          await saveBlobAs(blob, `${base}.docx`, [{ description: 'Word 文件', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } }]);
        } else if (fmt === 'txt') {
          const text = await pdfToText(src, progress);
          if (!text.replace(/[\s\f]/g, '')) st().toast('文件中沒有可擷取的文字，若為掃描檔請先執行 OCR', 'error');
          await saveBlobAs(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
        } else if (fmt === 'html') {
          const html = await pdfToHtml(src, progress);
          await saveBlobAs(new Blob([html], { type: 'text/html;charset=utf-8' }), `${base}.html`);
        }
      }
      st().toast('轉換完成', 'success');
    } catch (e: any) {
      console.error(e);
      st().toast(`轉換失敗：${e.message || e}`, 'error');
    } finally {
      st().setBusy(null);
    }
  };

  const C = ({ f, icon: I, title, desc }: { f: Fmt; icon: any; title: string; desc: string }) => (
    <button className={`choice${fmt === f ? ' on' : ''}`} onClick={() => setFmt(f)}>
      <b>
        <I size={16} /> {title}
      </b>
      <span>{desc}</span>
    </button>
  );

  return (
    <Modal
      title="轉換 / 匯出 PDF"
      footer={
        <>
          <button className="btn outline" onClick={() => st().openDialog(null)}>
            取消
          </button>
          <button className="btn primary" onClick={run}>
            轉換
          </button>
        </>
      }
    >
      <div className="choice-grid" style={{ marginBottom: 16 }}>
        <C f="docx" icon={FileType2} title="Word (.docx)" desc="可編輯的文件" />
        <C f="png" icon={FileImage} title="PNG 圖片" desc="無損、適合文字" />
        <C f="jpeg" icon={FileImage} title="JPG 圖片" desc="檔案較小" />
        <C f="txt" icon={FileText} title="純文字 (.txt)" desc="只擷取文字" />
        <C f="html" icon={FileCode2} title="網頁 (.html)" desc="文字網頁" />
      </div>
      {fmt === 'docx' && (
        <div className="opt-group">
          <span className="label">Word 轉換方式</span>
          <label className="radio">
            <input type="radio" checked={docxMode === 'layout'} onChange={() => setDocxMode('layout')} /> 保留版面，可編輯（建議）：圖片、色塊、表格線與文字位置都和 PDF 相同
          </label>
          <label className="radio">
            <input type="radio" checked={docxMode === 'flow'} onChange={() => setDocxMode('flow')} /> 流動文字：重建段落並插入圖片，適合大幅改寫內容
          </label>
          <label className="radio">
            <input type="radio" checked={docxMode === 'image'} onChange={() => setDocxMode('image')} /> 整頁圖片：外觀完全相同，但不可編輯
          </label>
        </div>
      )}
      {(fmt === 'png' || fmt === 'jpeg') && (
        <div className="opt-group">
          <span className="label">解析度</span>
          <div className="row">
            {[72, 150, 300, 600].map((d) => (
              <label key={d} className="radio" style={{ marginRight: 12 }}>
                <input type="radio" checked={dpi === d} onChange={() => setDpi(d)} /> {d} DPI
              </label>
            ))}
          </div>
        </div>
      )}
      <PageRangeInput value={range} onChange={setRange} total={pages.length} />
      <p className="hint">轉換會套用目前所有編輯內容。掃描檔請先執行 OCR，才能轉出可編輯文字。</p>
    </Modal>
  );
}
