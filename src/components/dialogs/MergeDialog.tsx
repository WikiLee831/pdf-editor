import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, FilePlus2, FileText, X } from 'lucide-react';
import Modal from './Modal';
import { uid, useStore, type DocState } from '../../store';
import { pickFiles, readFile, registerPdf, imagesToPdf } from '../../lib/files';
import type { OcrLine, PageRef, PdfObj } from '../../types';

type Item = { key: string; name: string; pages: number } & ({ kind: 'tab'; docId: string } | { kind: 'file'; file: File });

/** 複製某分頁的頁面（含編輯物件、OCR），給新的頁面 id，避免與原分頁共用 */
function clonePages(state: DocState, keepIds: boolean) {
  const pages: PageRef[] = [];
  const objects: Record<string, PdfObj[]> = {};
  const ocr: Record<string, OcrLine[]> = {};
  for (const p of state.pages) {
    const id = keepIds ? p.id : uid();
    pages.push({ ...p, id });
    if (state.objects[p.id]?.length) objects[id] = state.objects[p.id].map((o) => ({ ...o, id: keepIds ? o.id : uid() }) as PdfObj);
    if (state.ocr[p.id]?.length) ocr[id] = state.ocr[p.id];
  }
  return { pages, objects, ocr };
}

export default function MergeDialog() {
  const st = useStore.getState;
  const activeDoc = useStore((s) => s.activeDoc);
  const tabs = useMemo(() => st().docStates(), []);
  const [target, setTarget] = useState<'new' | 'current'>('new');
  const [items, setItems] = useState<Item[]>(() =>
    tabs.filter((t) => t.id === activeDoc).map((t) => ({ key: 'tab:' + t.id, kind: 'tab', docId: t.id, name: t.state.docName || '未命名.pdf', pages: t.state.pages.length })),
  );
  const tabName = (t: (typeof tabs)[number]) => t.state.docName || '未命名.pdf';
  const hasTab = (id: string) => items.some((it) => it.kind === 'tab' && it.docId === id);

  const toggleTab = (t: (typeof tabs)[number], on: boolean) => {
    if (on) {
      if (!hasTab(t.id)) setItems((a) => [...a, { key: 'tab:' + t.id, kind: 'tab', docId: t.id, name: tabName(t), pages: t.state.pages.length }]);
    } else setItems((a) => a.filter((it) => !(it.kind === 'tab' && it.docId === t.id)));
  };
  const chooseTarget = (v: 'new' | 'current') => {
    setTarget(v);
    // 加入到目前文件時，目前文件一定要在清單中
    const cur = tabs.find((t) => t.id === activeDoc);
    if (v === 'current' && cur && !hasTab(cur.id)) setItems((a) => [{ key: 'tab:' + cur.id, kind: 'tab', docId: cur.id, name: tabName(cur), pages: cur.state.pages.length }, ...a]);
  };

  const add = async () => {
    const files = await pickFiles('application/pdf,.pdf,image/*', true);
    setItems((it) => [...it, ...files.map((f) => ({ key: uid(), kind: 'file' as const, name: f.name, pages: 0, file: f }))]);
  };
  const mv = (i: number, d: number) => {
    const a = [...items];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setItems(a);
  };

  const run = async () => {
    if (items.length < 2) return st().toast('請至少選擇兩個文件或檔案', 'error');
    const intoCurrent = target === 'current' && !!activeDoc;
    st().openDialog(null);
    st().setBusy({ message: '合併中…' });
    try {
      // 先讀取所有分頁的最新狀態（含目前分頁尚未切換保存的編輯）
      const states = new Map(st().docStates().map((d) => [d.id, d.state]));
      const pages: PageRef[] = [];
      const objects: Record<string, PdfObj[]> = {};
      const ocr: Record<string, OcrLine[]> = {};
      for (const it of items) {
        if (it.kind === 'tab') {
          const s = states.get(it.docId);
          if (!s) throw new Error(`找不到分頁「${it.name}」`);
          const c = clonePages(s, intoCurrent && it.docId === activeDoc);
          pages.push(...c.pages);
          Object.assign(objects, c.objects);
          Object.assign(ocr, c.ocr);
        } else if (it.file.type.startsWith('image/')) pages.push(...(await registerPdf(await imagesToPdf([it.file], 'fit'), it.name)));
        else pages.push(...(await registerPdf(await readFile(it.file), it.name)));
      }
      if (intoCurrent) {
        st().setPages(pages); // 會記錄復原點
        st().set({ objects: { ...st().objects, ...objects }, ocr: { ...st().ocr, ...ocr }, dirty: true });
      } else {
        st().loadDocument('合併文件.pdf', pages);
        st().set({ objects, ocr, dirty: true });
      }
      st().toast(`已合併 ${items.length} 個文件，共 ${pages.length} 頁${intoCurrent ? '' : '，開啟在新分頁'}。記得儲存。`, 'success');
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
            <FilePlus2 size={15} /> 加入其他檔案
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
      {tabs.length > 0 && (
        <div className="opt-group">
          <span className="label">已開啟的文件（勾選要合併的分頁）</span>
          {tabs.map((t) => {
            const locked = target === 'current' && t.id === activeDoc;
            return (
              <label className="radio" key={t.id}>
                <input type="checkbox" checked={hasTab(t.id)} disabled={locked} onChange={(e) => toggleTab(t, e.target.checked)} />
                <FileText size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tabName(t)}</span>
                <span className="hint" style={{ flexShrink: 0 }}>
                  {t.state.pages.length} 頁{t.id === activeDoc ? '・目前分頁' : ''}
                  {t.state.dirty ? '・含未儲存的編輯' : ''}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <div className="opt-group">
        <span className="label">合併順序</span>
        {items.length ? (
          <div className="list">
            {items.map((it, i) => (
              <div className="list-item" key={it.key}>
                <span style={{ width: 20, color: '#999' }}>{i + 1}</span>
                <span className="name">{it.name}</span>
                <span className="hint">{it.kind === 'tab' ? `分頁・${it.pages} 頁` : '檔案'}</span>
                <button className="btn icon" onClick={() => mv(i, -1)} disabled={!i} title="上移">
                  <ArrowUp size={15} />
                </button>
                <button className="btn icon" onClick={() => mv(i, 1)} disabled={i === items.length - 1} title="下移">
                  <ArrowDown size={15} />
                </button>
                <button
                  className="btn icon"
                  title="移除"
                  disabled={target === 'current' && it.kind === 'tab' && it.docId === activeDoc}
                  onClick={() => setItems(items.filter((x) => x !== it))}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <button className="drop-zone" style={{ width: '100%', cursor: 'pointer', padding: 30 }} onClick={add}>
            勾選上方已開啟的文件，或點此選擇要合併的檔案
          </button>
        )}
      </div>

      {activeDoc && (
        <div className="opt-group">
          <span className="label">合併結果</span>
          <label className="radio">
            <input type="radio" checked={target === 'new'} onChange={() => chooseTarget('new')} /> 建立新文件（開在新分頁，原文件不變）
          </label>
          <label className="radio">
            <input type="radio" checked={target === 'current'} onChange={() => chooseTarget('current')} /> 合併到目前分頁（可按 Ctrl+Z 復原）
          </label>
        </div>
      )}
      <p className="hint" style={{ marginBottom: 0 }}>
        分頁中的文件會連同尚未儲存的編輯（文字修改、註解、圖片、OCR）一起合併。合併後可再編輯、組織或分割。
      </p>
    </Modal>
  );
}
