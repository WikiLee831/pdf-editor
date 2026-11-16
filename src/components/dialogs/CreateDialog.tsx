import { useState } from 'react';
import { FileImage, FilePlus2, FileText, FileType2 } from 'lucide-react';
import Modal from './Modal';
import { useStore } from '../../store';
import { blankPage, imagesToPdf, pickFiles, readFile, registerPdf } from '../../lib/files';
import { docxToText, textToPdf } from '../../lib/convert';

type Src = 'images' | 'word' | 'text' | 'blank';

/** 建立 PDF：圖片 / Word / 文字 / 空白 */
export default function CreateDialog() {
  const [src, setSrc] = useState<Src>('images');
  const [fit, setFit] = useState<'fit' | 'a4' | 'letter'>('a4');
  const [text, setText] = useState('');
  const [fontSize, setFontSize] = useState(12);
  const [blankCount, setBlankCount] = useState(1);
  const st = useStore.getState;

  const open = async (bytes: Uint8Array, name: string) => {
    const pages = await registerPdf(bytes, name);
    st().loadDocument(name, pages);
    st().set({ dirty: true });
  };

  const run = async () => {
    try {
      if (src === 'blank') {
        st().openDialog(null);
        const [w, h] = fit === 'letter' ? [612, 792] : [595.28, 841.89];
        st().loadDocument('新文件.pdf', Array.from({ length: Math.max(1, blankCount) }, () => blankPage(w, h)));
        st().set({ dirty: true });
        return;
      }
      if (src === 'text') {
        if (!text.trim()) return st().toast('請輸入文字', 'error');
        st().openDialog(null);
        st().setBusy({ message: '建立 PDF…' });
        await open(await textToPdf(text, { fontSize }), '文字文件.pdf');
        return;
      }
      const files = await pickFiles(src === 'images' ? 'image/*' : '.docx,.txt,.md,.csv', src === 'images');
      if (!files.length) return;
      st().openDialog(null);
      st().setBusy({ message: '建立 PDF…' });
      if (src === 'images') {
        await open(await imagesToPdf(files, fit, fit === 'fit' ? 0 : 24), files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '.pdf') : '圖片文件.pdf');
      } else {
        const f = files[0];
        const t = /\.docx$/i.test(f.name) ? await docxToText(await readFile(f)) : await f.text();
        await open(await textToPdf(t, { fontSize }), f.name.replace(/\.[^.]+$/, '.pdf'));
      }
    } catch (e: any) {
      st().toast(`建立失敗：${e.message || e}`, 'error');
    } finally {
      st().setBusy(null);
    }
  };

  const C = ({ s, icon: I, title, desc }: { s: Src; icon: any; title: string; desc: string }) => (
    <button className={`choice${src === s ? ' on' : ''}`} onClick={() => setSrc(s)}>
      <b>
        <I size={16} /> {title}
      </b>
      <span>{desc}</span>
    </button>
  );

  return (
    <Modal
      title="建立 PDF"
      footer={
        <>
          <button className="btn outline" onClick={() => st().openDialog(null)}>
            取消
          </button>
          <button className="btn primary" onClick={run}>
            {src === 'images' || src === 'word' ? '選擇檔案並建立' : '建立'}
          </button>
        </>
      }
    >
      <div className="choice-grid" style={{ marginBottom: 16 }}>
        <C s="images" icon={FileImage} title="從圖片" desc="JPG、PNG 等，可多選" />
        <C s="word" icon={FileType2} title="從 Word / 文字檔" desc=".docx、.txt（文字內容）" />
        <C s="text" icon={FileText} title="輸入文字" desc="直接貼上文字" />
        <C s="blank" icon={FilePlus2} title="空白文件" desc="從空白頁開始" />
      </div>
      {(src === 'images' || src === 'blank') && (
        <div className="opt-group">
          <span className="label">頁面大小</span>
          {src === 'images' && (
            <label className="radio">
              <input type="radio" checked={fit === 'fit'} onChange={() => setFit('fit')} /> 符合圖片大小
            </label>
          )}
          <label className="radio">
            <input type="radio" checked={fit === 'a4'} onChange={() => setFit('a4')} /> A4
          </label>
          <label className="radio">
            <input type="radio" checked={fit === 'letter'} onChange={() => setFit('letter')} /> Letter
          </label>
        </div>
      )}
      {src === 'blank' && (
        <div className="field">
          <label style={{ width: 'auto' }}>頁數</label>
          <input type="number" min={1} max={500} value={blankCount} onChange={(e) => setBlankCount(parseInt(e.target.value) || 1)} style={{ width: 90, height: 30 }} />
        </div>
      )}
      {(src === 'text' || src === 'word') && (
        <div className="field">
          <label style={{ width: 'auto' }}>字級 (pt)</label>
          <input type="number" min={6} max={48} value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value) || 12)} style={{ width: 90, height: 30 }} />
        </div>
      )}
      {src === 'text' && <textarea className="text-input" style={{ height: 220, padding: 10, resize: 'vertical' }} placeholder="在此輸入或貼上文字…" value={text} onChange={(e) => setText(e.target.value)} />}
      {src === 'word' && <p className="hint">Word 檔會擷取文字與段落後排版為 A4 PDF（不含原檔圖片與複雜格式）。</p>}
    </Modal>
  );
}
