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

/** 開啟檔案（PDF 或圖片） */
export async function openFiles(files: File[]) {
  const st = useStore.getState();
  if (!files.length) return;
  st.setBusy({ message: '開啟檔案中…' });
  try {
    const pdfFiles = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    const imgFiles = files.filter((f) => f.type.startsWith('image/'));
    let pages: PageRef[] = [];
    for (const f of pdfFiles) pages.push(...(await registerPdf(await readFile(f), f.name)));
    if (imgFiles.length) {
      const bytes = await imagesToPdf(imgFiles, 'fit');
      pages.push(...(await registerPdf(bytes, '圖片.pdf')));
    }
    if (!pages.length) throw new Error('不支援的檔案格式');
    const name = pdfFiles.length === 1 && !imgFiles.length ? pdfFiles[0].name : files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '.pdf') : '合併文件.pdf';
    st.loadDocument(name, pages);
    fileHandle = null;
  } catch (e: any) {
    st.toast(`開啟失敗：${friendlyError(e)}`, 'error');
  } finally {
    st.setBusy(null);
  }
}

/** 將網路類錯誤轉為易懂的說明 */
export function friendlyError(e: any): string {
  const msg = String(e?.message || e);
  if (/fetch|Failed to load|NetworkError|worker/i.test(msg)) {
    return '無法連線到本機伺服器。請確認「啟動 PDF Studio」的黑色視窗仍在執行（關閉它會停止程式），然後重新整理此頁面。';
  }
  return msg;
}

// ---------- 儲存 ----------

let fileHandle: any = null;
export function setFileHandle(h: any) {
  fileHandle = h;
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
    if (fileHandle && !saveAs) {
      const ws = await fileHandle.createWritable();
      await ws.write(blob);
      await ws.close();
    } else {
      const h = await saveBlobAs(blob, st.docName || '文件.pdf', [{ description: 'PDF 文件', accept: { 'application/pdf': ['.pdf'] } }]);
      if (!h) return;
      if (h !== 'download') {
        fileHandle = h;
        st.set({ docName: h.name });
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
