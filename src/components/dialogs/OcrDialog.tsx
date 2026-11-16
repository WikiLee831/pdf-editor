import { useState } from 'react';
import Modal, { PageRangeInput } from './Modal';
import { useStore } from '../../store';
import { OCR_LANGS, ocrPage } from '../../lib/ocr';
import { parseRange } from '../../lib/convert';
import { getTextRuns } from '../../lib/analyze';

export default function OcrDialog() {
  const pages = useStore((s) => s.pages);
  const current = useStore((s) => s.currentPage);
  const [langs, setLangs] = useState<string[]>(['chi_tra', 'eng']);
  const [range, setRange] = useState('');
  const [dpi, setDpi] = useState(300);
  const [skipText, setSkipText] = useState(true);
  const st = useStore.getState;

  const run = async () => {
    if (!langs.length) return st().toast('請至少選擇一種語言', 'error');
    let idx: number[];
    try {
      idx = range === 'current' ? [current] : parseRange(range, pages.length);
    } catch (e: any) {
      return st().toast(e.message, 'error');
    }
    st().openDialog(null);
    let done = 0;
    let skipped = 0;
    try {
      for (let k = 0; k < idx.length; k++) {
        const ref = pages[idx[k]];
        if (skipText) {
          const runs = await getTextRuns(ref);
          if (runs.map((r) => r.text).join('').length > 30) {
            skipped++;
            continue;
          }
        }
        const label = `OCR 辨識第 ${idx[k] + 1} 頁（${k + 1}/${idx.length}）`;
        st().setBusy({ message: label + '：準備中…', progress: k / idx.length });
        const lines = await ocrPage(ref, langs, dpi, (p, status) =>
          st().setBusy({
            message: `${label}：${status.includes('recogniz') ? '辨識中' : status.includes('load') ? '載入語言資料' : '初始化'}`,
            progress: (k + (status.includes('recogniz') ? p : 0)) / idx.length,
          }),
        );
        st().setOcr(ref.id, lines);
        done++;
      }
      st().toast(`OCR 完成：${done} 頁${skipped ? `，略過 ${skipped} 頁已有文字的頁面` : ''}`, 'success');
      if (done) {
        st().set({ ocrPanel: idx.length === 1 ? pages[idx[0]].id : '*' });
      }
    } catch (e: any) {
      console.error(e);
      st().toast(`OCR 失敗：${e.message || e}`, 'error');
    } finally {
      st().setBusy(null);
    }
  };

  return (
    <Modal
      title="OCR 文字辨識"
      footer={
        <>
          <button className="btn outline" onClick={() => st().openDialog(null)}>
            取消
          </button>
          <button className="btn primary" onClick={run}>
            開始辨識
          </button>
        </>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        將掃描檔或圖片中的文字辨識出來：會加入隱藏文字層使 PDF 可搜尋、可複製，且辨識出的文字可以用「編輯文字」工具直接修改。所有辨識都在本機完成，不會上傳檔案。
      </p>
      <div className="opt-group">
        <span className="label">辨識語言</span>
        <div className="row">
          {OCR_LANGS.map((l) => (
            <label key={l.code} className="radio" style={{ marginRight: 12 }}>
              <input type="checkbox" checked={langs.includes(l.code)} onChange={(e) => setLangs(e.target.checked ? [...langs, l.code] : langs.filter((x) => x !== l.code))} />
              {l.label}
            </label>
          ))}
        </div>
      </div>
      <PageRangeInput value={range} onChange={setRange} total={pages.length} />
      <div className="opt-group">
        <span className="label">解析度</span>
        <div className="row">
          {[200, 300, 400].map((d) => (
            <label key={d} className="radio" style={{ marginRight: 12 }}>
              <input type="radio" checked={dpi === d} onChange={() => setDpi(d)} /> {d} DPI{d === 300 ? '（建議）' : d === 200 ? '（較快）' : '（小字）'}
            </label>
          ))}
        </div>
      </div>
      <label className="radio">
        <input type="checkbox" checked={skipText} onChange={(e) => setSkipText(e.target.checked)} /> 略過已含文字的頁面
      </label>
    </Modal>
  );
}
