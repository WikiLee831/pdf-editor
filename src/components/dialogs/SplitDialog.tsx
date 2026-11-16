import { useState } from 'react';
import Modal from './Modal';
import { useStore } from '../../store';
import { baseName, currentPdfBytes, zipAndDownload } from '../../lib/files';
import { extractPages } from '../../lib/exportPdf';
import { parseRange } from '../../lib/convert';

type Mode = 'every' | 'ranges' | 'single' | 'size';

export default function SplitDialog() {
  const pages = useStore((s) => s.pages);
  const docName = useStore((s) => s.docName);
  const [mode, setMode] = useState<Mode>('every');
  const [n, setN] = useState(1);
  const [ranges, setRanges] = useState('1-' + Math.ceil(pages.length / 2) + ', ' + (Math.ceil(pages.length / 2) + 1) + '-' + pages.length);
  const [sizeMb, setSizeMb] = useState(5);
  const st = useStore.getState;
  const total = pages.length;

  const groups = (): number[][] => {
    if (mode === 'every' || mode === 'single') {
      const k = mode === 'single' ? 1 : Math.max(1, n);
      const g: number[][] = [];
      for (let i = 0; i < total; i += k) g.push(Array.from({ length: Math.min(k, total - i) }, (_, j) => i + j));
      return g;
    }
    if (mode === 'ranges') return ranges.split(/[;,，；]/).map((r) => parseRange(r, total)).filter((g) => g.length);
    return [];
  };

  let preview = '';
  try {
    if (mode !== 'size') preview = `將產生 ${groups().length} 個檔案`;
  } catch (e: any) {
    preview = e.message;
  }

  const run = async () => {
    st().openDialog(null);
    st().setBusy({ message: '分割中…', progress: 0 });
    try {
      const bytes = await currentPdfBytes();
      const base = baseName(docName);
      const files: { name: string; data: Uint8Array }[] = [];
      if (mode === 'size') {
        // 依檔案大小：逐頁累加直到超過上限
        const limit = sizeMb * 1024 * 1024;
        let cur: number[] = [];
        let last: Uint8Array | null = null;
        for (let i = 0; i < total; i++) {
          const trial = await extractPages(bytes, [...cur, i]);
          if (trial.length > limit && cur.length) {
            files.push({ name: '', data: last! });
            cur = [i];
            last = await extractPages(bytes, cur);
          } else {
            cur.push(i);
            last = trial;
          }
          st().setBusy({ message: '分割中…', progress: (i + 1) / total });
        }
        if (cur.length) files.push({ name: '', data: last! });
        files.forEach((f, i) => (f.name = `${base}_第${i + 1}部分.pdf`));
      } else {
        const gs = groups();
        for (let i = 0; i < gs.length; i++) {
          const g = gs[i];
          const label = g.length === 1 ? `第${g[0] + 1}頁` : `第${g[0] + 1}-${g[g.length - 1] + 1}頁`;
          files.push({ name: `${base}_${label}.pdf`, data: await extractPages(bytes, g) });
          st().setBusy({ message: '分割中…', progress: (i + 1) / gs.length });
        }
      }
      await zipAndDownload(files, `${base}_分割.zip`);
      st().toast(`已分割為 ${files.length} 個檔案`, 'success');
    } catch (e: any) {
      st().toast(`分割失敗：${e.message || e}`, 'error');
    } finally {
      st().setBusy(null);
    }
  };

  const Choice = ({ m, title, desc }: { m: Mode; title: string; desc: string }) => (
    <button className={`choice${mode === m ? ' on' : ''}`} onClick={() => setMode(m)}>
      <b>{title}</b>
      <span>{desc}</span>
    </button>
  );

  return (
    <Modal
      title="分割 PDF"
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            {preview}
          </span>
          <button className="btn outline" onClick={() => st().openDialog(null)}>
            取消
          </button>
          <button className="btn primary" onClick={run}>
            分割並下載
          </button>
        </>
      }
    >
      <div className="choice-grid" style={{ marginBottom: 16 }}>
        <Choice m="every" title="每 N 頁" desc="固定頁數切成多個檔案" />
        <Choice m="ranges" title="依頁碼範圍" desc="自訂每個檔案的頁面" />
        <Choice m="single" title="每頁一個檔案" desc={`產生 ${total} 個檔案`} />
        <Choice m="size" title="依檔案大小" desc="每個檔案不超過上限" />
      </div>
      {mode === 'every' && (
        <div className="field">
          <label style={{ width: 'auto' }}>每個檔案頁數</label>
          <input type="number" min={1} max={total} value={n} onChange={(e) => setN(parseInt(e.target.value) || 1)} style={{ width: 100, height: 30 }} />
        </div>
      )}
      {mode === 'ranges' && (
        <div className="opt-group">
          <span className="label">頁碼範圍（以逗號或分號分隔每個檔案）</span>
          <input className="text-input" value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="例如：1-3, 4-8, 9-12" />
          <span className="hint">每一段範圍會成為一個檔案；例如「1-3, 4-8」會產生 2 個檔案。</span>
        </div>
      )}
      {mode === 'size' && (
        <div className="field">
          <label style={{ width: 'auto' }}>每個檔案上限 (MB)</label>
          <input type="number" min={0.5} step={0.5} value={sizeMb} onChange={(e) => setSizeMb(parseFloat(e.target.value) || 5)} style={{ width: 100, height: 30 }} />
        </div>
      )}
      <p className="hint">分割會套用目前所有的編輯內容。多個檔案會打包成 ZIP 下載。</p>
    </Modal>
  );
}
