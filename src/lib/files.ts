import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { loadPdfJs, sources } from './pdfjs';
import { uid, useStore } from '../store';
import { buildPdf } from './exportPdf';
import type { PageRef } from '../types';

export function readFile(file: Blob): Promise<Uint8Array> {
  return file.arrayBuffer().then((b) => new Uint8Array(b));
}

/** 將 PDF 位元組登錄為來源，回傳其頁面 */
export async function registerPdf(bytes: Uint8Array, name: string): Promise<PageRef[]> {
  let pdf;
  try {
    pdf = await loadPdfJs(bytes);
  } catch (e: any) {
    if (e?.name === 'PasswordException') {
      const pw = prompt(`「${name}」受密碼保護，請輸入密碼：`);
      if (pw == null) throw new Error('已取消');
      pdf = await loadPdfJs(bytes, pw);
    } else throw e;
  }
  const id = uid();
  sources.set(id, { id, name, bytes, pdf });
  const pages: PageRef[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const p = await pdf.getPage(i + 1);
    const view = p.view as [number, number, number, number];
    pages.push({
      id: uid(),
      srcId: id,
      srcIndex: i,
      width: view[2] - view[0],
      height: view[3] - view[1],
      view,
      baseRotate: p.rotate || 0,
      rotate: 0,
    });
  }
  return pages;
}

export function blankPage(width = 595.28, height = 841.89): PageRef {
  return { id: uid(), srcId: null, srcIndex: 0, width, height, view: [0, 0, width, height], baseRotate: 0, rotate: 0 };
}

/** 開啟檔案：每個 PDF 各開一個分頁；多張圖片合成一個分頁。回傳成功開啟的分頁數 */
export async function openFiles(files: File[]): Promise<number> {
  const st = useStore.getState();
  if (!files.length) return 0;
  st.setBusy({ message: '開啟檔案中…' });
  let opened = 0;
  try {
    const pdfFiles = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    const imgFiles = files.filter((f) => f.type.startsWith('image/'));
    if (!pdfFiles.length && !imgFiles.length) throw new Error('不支援的檔案格式');
    for (const f of pdfFiles) {
      try {
        const pages = await registerPdf(await readFile(f), f.name);
        st.loadDocument(f.name, pages);
        opened++;
      } catch (e: any) {
        if (e?.message !== '已取消') st.toast(`無法開啟「${f.name}」：${friendlyError(e)}`, 'error');
      }
    }
    if (imgFiles.length) {
      const bytes = await imagesToPdf(imgFiles, 'fit');
      const name = imgFiles.length === 1 ? imgFiles[0].name.replace(/\.[^.]+$/, '.pdf') : '圖片.pdf';
      st.loadDocument(name, await registerPdf(bytes, name));
      opened++;
    }
  } catch (e: any) {
    st.toast(`開啟失敗：${friendlyError(e)}`, 'error');
  } finally {
    st.setBusy(null);
  }
  return opened;
}

/** 關閉分頁（有未儲存變更時先確認），並釋放不再使用的 PDF 來源 */
export function closeDoc(id?: string) {
  const st = useStore.getState();
  const target = id || st.activeDoc;
  const doc = st.docStates().find((d) => d.id === target);
  if (!doc) return;
  if (doc.state.dirty && !confirm(`「${doc.state.docName}」有未儲存的變更，確定要關閉嗎？`)) return;
  st.closeDocument(doc.id);
  const used = new Set<string>();
  for (const d of useStore.getState().docStates()) {
    for (const snap of [d.state, ...d.state.past, ...d.state.future]) for (const p of snap.pages) if (p.srcId) used.add(p.srcId);
  }
  for (const [sid, src] of sources) {
    if (used.has(sid)) continue;
    sources.delete(sid);
    try {
      src.pdf.destroy();
    } catch {
      /* ignore */
    }
  }
}

/** 將網路類錯誤轉為易懂的說明 */
export function friendlyError(e: any): string {
  const msg = String(e?.message || e);
  if (/fetch|Failed to load|NetworkError|worker/i.test(msg)) {
    return '無法連線到本機伺服器。請確認「Start_PDF_Editor.bat」開啟的黑色視窗仍在執行（關閉它會停止程式），然後重新整理此頁面。';
  }
  return msg;
}

// ---------- 儲存 ----------

/** 目前分頁對應的檔案代碼（可直接覆寫原檔） */
export function setFileHandle(h: any) {
  useStore.getState().set({ fileHandle: h });
}

export async function currentPdfBytes(onProgress?: (p: number) => void) {
  const s = useStore.getState();
  return buildPdf({ pages: s.pages, objects: s.objects, ocr: s.ocr, title: s.docName?.replace(/\.pdf$/i, ''), onProgress });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function saveBlobAs(blob: Blob, name: string, types?: { description: string; accept: Record<string, string[]> }[]) {
  const w = window as any;
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: name, types });
      const ws = await h.createWritable();
      await ws.write(blob);
      await ws.close();
      return h;
    } catch (e: any) {
      if (e?.name === 'AbortError') return null;
      // 某些環境不允許，退回下載
    }
  }
  downloadBlob(blob, name);
  return 'download';
}

export async function savePdf(saveAs = false) {
  const st = useStore.getState();
  if (!st.pages.length) return;
  st.setBusy({ message: '產生 PDF 中…', progress: 0 });
  try {
    const bytes = await currentPdfBytes((p) => st.setBusy({ message: '產生 PDF 中…', progress: p }));
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const fileHandle = st.fileHandle;
    if (fileHandle && !saveAs) {
      const ws = await fileHandle.createWritable();
      await ws.write(blob);
      await ws.close();
    } else {
      const h = await saveBlobAs(blob, st.docName || '文件.pdf', [{ description: 'PDF 文件', accept: { 'application/pdf': ['.pdf'] } }]);
      if (!h) return;
      if (h !== 'download') {
        st.set({ fileHandle: h, docName: h.name });
      }
    }
    st.set({ dirty: false });
    st.toast('已儲存', 'success');
  } catch (e: any) {
    st.toast(`儲存失敗：${e.message || e}`, 'error');
  } finally {
    st.setBusy(null);
  }
}

export async function zipAndDownload(files: { name: string; data: Uint8Array | Blob }[], zipName: string) {
  if (files.length === 1) {
    const f = files[0];
    downloadBlob(f.data instanceof Blob ? f.data : new Blob([f.data as BlobPart]), f.name);
    return;
  }
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.data);
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, zipName);
}

// ---------- 圖片 ----------

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('無法讀取圖片'));
    img.src = src;
  });
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

/** 任意圖片轉為 PDF 可嵌入的 PNG/JPEG data URL */
export async function normalizeImage(file: Blob): Promise<{ src: string; w: number; h: number }> {
  let src = await fileToDataUrl(file);
  const img = await loadImage(src);
  if (!/^data:image\/(png|jpeg|jpg)/.test(src)) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    src = c.toDataURL('image/png');
  }
  return { src, w: img.naturalWidth, h: img.naturalHeight };
}

export async function imagesToPdf(files: Blob[], mode: 'fit' | 'a4' | 'letter', margin = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const f of files) {
    const { src, w, h } = await normalizeImage(f);
    const bytes = Uint8Array.from(atob(src.split(',')[1]), (c) => c.charCodeAt(0));
    const img = src.startsWith('data:image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    // 以 96 DPI 換算為點
    const iw = (w * 72) / 96;
    const ih = (h * 72) / 96;
    if (mode === 'fit') {
      const page = doc.addPage([iw + margin * 2, ih + margin * 2]);
      page.drawImage(img, { x: margin, y: margin, width: iw, height: ih });
    } else {
      let [pw, ph] = mode === 'a4' ? [595.28, 841.89] : [612, 792];
      if (iw > ih) [pw, ph] = [ph, pw];
      const page = doc.addPage([pw, ph]);
      const k = Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih);
      page.drawImage(img, { x: (pw - iw * k) / 2, y: (ph - ih * k) / 2, width: iw * k, height: ih * k });
    }
  }
  return doc.save();
}

/** 把圖片直接放到目前頁面中央（依畫面方向），並選取以便移動/縮放 */
export async function placeImageOnCurrentPage(file: Blob) {
  const st = useStore.getState();
  const ref = st.pages[st.currentPage];
  if (!ref) return;
  const img = await normalizeImage(file);
  const R = ((((ref.baseRotate + ref.rotate) % 360) + 360) % 360) as number;
  // 以 96 DPI 換算，最大不超過頁面（視覺方向）的 80%
  const vw = R % 180 ? ref.height : ref.width;
  const vh = R % 180 ? ref.width : ref.height;
  let w = (img.w * 72) / 96;
  let h = (img.h * 72) / 96;
  const k = Math.min(1, (vw * 0.8) / w, (vh * 0.8) / h);
  w *= k;
  h *= k;
  const id = uid();
  st.addObject(ref.id, { id, type: 'image', x: ref.width / 2 - w / 2, y: ref.height / 2 - h / 2, w, h, src: img.src, rot: R ? -R : undefined });
  st.set({ tool: 'select', pendingImage: null });
  st.select({ pageId: ref.id, id });
  st.toast(`已貼上圖片到第 ${st.currentPage + 1} 頁，可拖曳移動或拉角落縮放`, 'success');
}

/** 由剪貼簿讀取圖片（需使用者授權讀取剪貼簿） */
export async function pasteImageFromClipboard() {
  const st = useStore.getState();
  const nav = navigator as any;
  if (!nav.clipboard?.read) return st.toast('此瀏覽器不支援讀取剪貼簿，請直接按 Ctrl+V 貼上', 'error');
  try {
    const items: ClipboardItem[] = await nav.clipboard.read();
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (type) return pasteImageBlob(await it.getType(type));
    }
    st.toast('剪貼簿中沒有圖片（可先用截圖工具或「快照」複製圖片）', 'error');
  } catch (e: any) {
    st.toast(e?.name === 'NotAllowedError' ? '瀏覽器拒絕讀取剪貼簿，請改按 Ctrl+V 貼上' : `貼上失敗：${e.message || e}`, 'error');
  }
}

/** 貼上圖片：有開啟文件時放到目前頁面，否則以該圖片建立新 PDF */
export async function pasteImageBlob(blob: Blob) {
  const st = useStore.getState();
  try {
    if (st.pages.length) return await placeImageOnCurrentPage(blob);
    const file = new File([blob], '剪貼簿圖片.png', { type: blob.type || 'image/png' });
    await openFiles([file]);
  } catch (e: any) {
    st.toast(`貼上失敗：${e.message || e}`, 'error');
  }
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((res) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => res(Array.from(input.files || []));
    input.addEventListener('cancel', () => res([]));
    input.click();
  });
}

export function baseName(name: string | null) {
  return (name || '文件').replace(/\.pdf$/i, '');
}
