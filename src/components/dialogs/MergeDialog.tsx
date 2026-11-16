import { useState } from 'react';
import { ArrowDown, ArrowUp, FilePlus2, X } from 'lucide-react';
import Modal from './Modal';
import { useStore } from '../../store';
import { pickFiles, readFile, registerPdf, imagesToPdf } from '../../lib/files';
import type { PageRef } from '../../types';

interface Item {
  key: string;
  name: string;
  pages: number;
  file?: File;
  current?: boolean;
}

export default function MergeDialog() {
  const docPages = useStore((s) => s.pages);
  const docName = useStore((s) => s.docName);
  const [items, setItems] = useState<Item[]>(docPages.length ? [{ key: 'cur', name: `${docName}（目前文件，含編輯）`, pages: docPages.length, current: true }] : []);
  const st = useStore.getState;

  const add = async () => {
    const files = await pickFiles('application/pdf,.pdf,image/*', true);
    setItems((it) => [...it, ...files.map((f) => ({ key: Math.random().toString(36), name: f.name, pages: 0, file: f }))]);
  };
  const mv = (i: number, d: number) => {
    const a = [...items];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setItems(a);
  };

  const run = async () => {
    if (items.length < 2) return st().toast('請至少加入兩個檔案', 'error');
    st().openDialog(null);
    st().setBusy({ message: '合併中…' });
    try {
      const all: PageRef[] = [];
      for (const it of items) {
        if (it.current) all.push(...docPages);
        else if (it.file!.type.startsWith('image/')) all.push(...(await registerPdf(await imagesToPdf([it.file!], 'fit'), it.name)));
        else all.push(...(await registerPdf(await readFile(it.file!), it.name)));
      }
      if (docPages.length) {
        st().setPages(all);
      } else {
        st().loadDocument('合併文件.pdf', all);
      }
      st().toast(`已合併 ${items.length} 個檔案，共 ${all.length} 頁。記得儲存。`, 'success');
    } catch (e: any) {
      st().toast(`合併失敗：${e.message || e}`, 'error');
    } finally {
      st().setBusy(null);
    }
  };

  return (
    <Modal
      title="合併檔案"
      footer={
        <>
          <button className="btn outline" onClick={add} style={{ marginRight: 'auto' }}>
            <FilePlus2 size={15} /> 加入檔案
          </button>
          <button className="btn outline" onClick={() => st().openDialog(null)}>
            取消
          </button>
          <button className="btn primary" onClick={run} disabled={items.length < 2}>
            合併
          </button>
        </>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        加入 PDF 或圖片檔，調整順序後按「合併」。合併後的頁面可再編輯、組織或分割。
      </p>
      {items.length ? (
        <div className="list">
          {items.map((it, i) => (
            <div className="list-item" key={it.key}>
              <span style={{ width: 20, color: '#999' }}>{i + 1}</span>
              <span className="name">{it.name}</span>
              {it.current && <span className="hint">{it.pages} 頁</span>}
              <button className="btn icon" onClick={() => mv(i, -1)} disabled={!i}>
                <ArrowUp size={15} />
              </button>
              <button className="btn icon" onClick={() => mv(i, 1)} disabled={i === items.length - 1}>
                <ArrowDown size={15} />
              </button>
              <button className="btn icon" onClick={() => setItems(items.filter((x) => x !== it))}>
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <button className="drop-zone" style={{ width: '100%', cursor: 'pointer', padding: 30 }} onClick={add}>
          點此選擇要合併的檔案
        </button>
      )}
    </Modal>
  );
}
