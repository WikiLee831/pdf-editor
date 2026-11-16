import { useState } from 'react';
import { CopyPlus, Download, FilePlus2, FileUp, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import Modal from './Modal';
import Thumbnail from '../Thumbnail';
import { uid, useStore } from '../../store';
import { baseName, blankPage, currentPdfBytes, downloadBlob, pickFiles, readFile, registerPdf } from '../../lib/files';
import { extractPages } from '../../lib/exportPdf';
import type { PageRef } from '../../types';

export default function OrganizeDialog() {
  const orig = useStore((s) => s.pages);
  const docName = useStore((s) => s.docName);
  const [pages, setPages] = useState<PageRef[]>(orig);
  const [dupOf, setDupOf] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const st = useStore.getState;

  const selected = pages.filter((p) => sel.has(p.id));
  const targets = (id?: string) => (id ? [id] : selected.map((p) => p.id));

  const rotate = (deg: number, id?: string) => {
    const t = new Set(targets(id));
    setPages(pages.map((p) => (t.has(p.id) ? { ...p, rotate: (((p.rotate + deg) % 360) + 360) % 360 } : p)));
  };
  const remove = (id?: string) => {
    const t = new Set(targets(id));
    if (t.size >= pages.length) return st().toast('至少要保留一頁', 'error');
    setPages(pages.filter((p) => !t.has(p.id)));
    setSel(new Set());
  };
  const duplicate = (id?: string) => {
    const t = new Set(targets(id));
    const out: PageRef[] = [];
    const map = { ...dupOf };
    for (const p of pages) {
      out.push(p);
      if (t.has(p.id)) {
        const np = { ...p, id: uid() };
        map[np.id] = dupOf[p.id] || p.id;
        out.push(np);
      }
    }
    setDupOf(map);
    setPages(out);
  };
  const insertAt = (newPages: PageRef[]) => {
    const lastSel = pages.reduce((m, p, i) => (sel.has(p.id) ? i : m), -1);
    const at = lastSel >= 0 ? lastSel + 1 : pages.length;
    setPages([...pages.slice(0, at), ...newPages, ...pages.slice(at)]);
  };
  const insertBlank = () => {
    const ref = selected[0] || pages[pages.length - 1];
    insertAt([blankPage(ref?.width, ref?.height)]);
  };
  const insertFile = async () => {
    const files = await pickFiles('application/pdf,.pdf', true);
    if (!files.length) return;
    st().setBusy({ message: '讀取檔案…' });
    try {
      const add: PageRef[] = [];
      for (const f of files) add.push(...(await registerPdf(await readFile(f), f.name)));
      insertAt(add);
    } catch (e: any) {
      st().toast(`無法讀取：${e.message}`, 'error');
    } finally {
      st().setBusy(null);
    }
  };
  const extract = async () => {
    if (!selected.length) return st().toast('請先選取頁面', 'error');
    st().setBusy({ message: '擷取頁面…' });
    try {
      // 先套用目前的編輯再擷取
      apply(false);
      const all = useStore.getState().pages;
      const bytes = await currentPdfBytes();
      const idx = selected.map((p) => all.findIndex((q) => q.id === p.id)).filter((i) => i >= 0);
      const out = await extractPages(bytes, idx);
      downloadBlob(new Blob([out as BlobPart], { type: 'application/pdf' }), `${baseName(docName)}_擷取.pdf`);
    } finally {
      st().setBusy(null);
    }
  };

  const apply = (close = true) => {
    const s = st();
    s.pushHistory();
    const objects = { ...s.objects };
    const ocr = { ...s.ocr };
    for (const [nid, oid] of Object.entries(dupOf)) {
      if (!pages.some((p) => p.id === nid)) continue;
      if (s.objects[oid]) objects[nid] = s.objects[oid].map((o) => ({ ...o, id: uid() }));
      if (s.ocr[oid]) ocr[nid] = s.ocr[oid];
    }
    s.set({ pages, objects, ocr, selected: null, currentPage: Math.min(s.currentPage, pages.length - 1) });
    setDupOf({});
    if (close) s.openDialog(null);
  };

  const onClick = (e: React.MouseEvent, i: number, id: string) => {
    const next = new Set(e.ctrlKey || e.metaKey ? sel : []);
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      for (let k = a; k <= b; k++) next.add(pages[k].id);
    } else if ((e.ctrlKey || e.metaKey) && sel.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
    if (!e.shiftKey) setAnchor(i);
  };

  const drop = (targetId: string) => {
    if (!drag || drag === targetId) return;
    const moving = sel.has(drag) ? pages.filter((p) => sel.has(p.id)) : pages.filter((p) => p.id === drag);
    const ids = new Set(moving.map((p) => p.id));
    if (ids.has(targetId)) return;
    const rest = pages.filter((p) => !ids.has(p.id));
    const at = targetId === '__end' ? rest.length : rest.findIndex((p) => p.id === targetId);
    setPages([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
  };

  return (
    <Modal
      title="組織頁面"
      wide
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            共 {pages.length} 頁{sel.size ? `，已選取 ${sel.size} 頁` : ''}。拖曳可調整順序；Ctrl/Shift 多選。
          </span>
          <button className="btn outline" onClick={() => st().openDialog(null)}>
            取消
          </button>
          <button className="btn primary" onClick={() => apply()}>
            套用
          </button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 14, position: 'sticky', top: -18, background: '#fff', padding: '6px 0', zIndex: 2 }}>
        <button className="btn outline" disabled={!sel.size} onClick={() => rotate(-90)}>
          <RotateCcw size={15} /> 向左旋轉
        </button>
        <button className="btn outline" disabled={!sel.size} onClick={() => rotate(90)}>
          <RotateCw size={15} /> 向右旋轉
        </button>
        <button className="btn outline danger" disabled={!sel.size} onClick={() => remove()}>
          <Trash2 size={15} /> 刪除
        </button>
        <button className="btn outline" disabled={!sel.size} onClick={() => duplicate()}>
          <CopyPlus size={15} /> 複製頁面
        </button>
        <button className="btn outline" disabled={!sel.size} onClick={extract}>
          <Download size={15} /> 擷取所選頁面
        </button>
        <span className="sep" />
        <button className="btn outline" onClick={insertBlank}>
          <FilePlus2 size={15} /> 插入空白頁
        </button>
        <button className="btn outline" onClick={insertFile}>
          <FileUp size={15} /> 從檔案插入
        </button>
        <span className="sep" />
        <button className="btn" onClick={() => setSel(new Set(pages.map((p) => p.id)))}>
          全選
        </button>
        <button className="btn" onClick={() => setSel(new Set(pages.filter((_, i) => i % 2 === 0).map((p) => p.id)))}>
          奇數頁
        </button>
        <button className="btn" onClick={() => setSel(new Set(pages.filter((_, i) => i % 2 === 1).map((p) => p.id)))}>
          偶數頁
        </button>
        <button className="btn" onClick={() => setPages([...pages].reverse())}>
          反轉順序
        </button>
      </div>
      <div className="org-grid">
        {pages.map((p, i) => (
          <div
            key={p.id}
            className={`org-item${sel.has(p.id) ? ' sel' : ''}${over === p.id ? ' dragover' : ''}`}
            onClick={(e) => onClick(e, i, p.id)}
            draggable
            onDragStart={() => setDrag(p.id)}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(p.id);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              drop(p.id);
              setDrag(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
          >
            <div style={{ height: 160, display: 'flex', alignItems: 'center' }}>
              <Thumbnail pageRef={p} width={112} />
            </div>
            <span className="thumb-num">{i + 1}</span>
            <div className="org-tools" onClick={(e) => e.stopPropagation()}>
              <button title="向左旋轉" onClick={() => rotate(-90, p.id)}>
                <RotateCcw size={14} />
              </button>
              <button title="向右旋轉" onClick={() => rotate(90, p.id)}>
                <RotateCw size={14} />
              </button>
              <button title="複製" onClick={() => duplicate(p.id)}>
                <CopyPlus size={14} />
              </button>
              <button title="刪除" onClick={() => remove(p.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        <div
          className={`org-item${over === '__end' ? ' dragover' : ''}`}
          style={{ minHeight: 160, border: '2px dashed #ddd', justifyContent: 'center', color: '#999' }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver('__end');
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop('__end');
            setDrag(null);
            setOver(null);
          }}
          onClick={insertFile}
        >
          <FileUp size={22} />
          <span>插入檔案</span>
        </div>
      </div>
    </Modal>
  );
}
