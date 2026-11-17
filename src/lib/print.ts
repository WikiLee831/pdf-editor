import { loadPdfJs } from './pdfjs';

function hiddenFrame(): HTMLIFrameElement {
  document.querySelectorAll('iframe.print-frame').forEach((f) => f.remove());
  const f = document.createElement('iframe');
  f.className = 'print-frame';
  // 不可用 display:none，否則瀏覽器的 PDF 檢視器不會載入
  f.setAttribute('style', 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none');
  document.body.appendChild(f);
  return f;
}

/** 列印後把焦點還給主視窗，否則快速鍵會被隱藏的列印框吃掉 */
function restoreFocus() {
  setTimeout(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.focus();
  }, 0);
}

/** 以瀏覽器內建 PDF 檢視器列印（向量品質） */
export function printPdfNative(bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const f = hiddenFrame();
    const timer = setTimeout(() => reject(new Error('列印預覽載入逾時')), 20000);
    f.onload = () => {
      clearTimeout(timer);
      // 給 PDF 檢視器一點時間完成初始化
      setTimeout(() => {
        try {
          f.contentWindow!.focus();
          f.contentWindow!.print();
          restoreFocus();
          resolve();
        } catch (e) {
          reject(e);
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }, 400);
    };
    f.src = url;
  });
}

/** 將每頁渲染為影像後列印（相容模式：適用於無內建 PDF 檢視器的瀏覽器） */
export async function printPdfAsImages(bytes: Uint8Array, dpi = 200, onProgress?: (p: number) => void): Promise<void> {
  const pdf = await loadPdfJs(bytes);
  const urls: { url: string; w: number; h: number }[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const c = document.createElement('canvas');
      c.width = Math.round(viewport.width);
      c.height = Math.round(viewport.height);
      await page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport, background: 'white' } as any).promise;
      const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
      urls.push({ url: URL.createObjectURL(blob), w: viewport.width / (dpi / 72), h: viewport.height / (dpi / 72) });
      c.width = c.height = 0;
      onProgress?.(i / pdf.numPages);
    }
  } finally {
    pdf.destroy();
  }
  const f = hiddenFrame();
  const doc = f.contentDocument!;
  // 每頁以自己的尺寸（pt）設定紙張方向
  const css = urls
    .map((u, i) => `@page p${i}{size:${u.w}pt ${u.h}pt;margin:0}.p${i}{page:p${i};width:${u.w}pt;height:${u.h}pt}`)
    .join('');
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>列印</title><style>@page{margin:0}html,body{margin:0;padding:0}` +
      `.pg{display:block;break-after:page;page-break-after:always;object-fit:contain}.pg:last-child{break-after:auto;page-break-after:auto}${css}</style></head><body>` +
      urls.map((u, i) => `<img class="pg p${i}" src="${u.url}">`).join('') +
      `</body></html>`,
  );
  doc.close();
  await Promise.all(Array.from(doc.images).map((im) => (im.complete ? Promise.resolve() : new Promise((r) => (im.onload = im.onerror = r)))));
  f.contentWindow!.focus();
  f.contentWindow!.print();
  restoreFocus();
  setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u.url)), 60000);
}
