import { memo, useEffect, useRef, useState } from 'react';
import { displaySize, renderPageToCanvas, totalRotation } from '../lib/pdfjs';
import type { PageRef } from '../types';

/** 頁面縮圖（延遲渲染；不含編輯物件） */
function Thumbnail({ pageRef, width = 120, objectsCount = 0 }: { pageRef: PageRef; width?: number; objectsCount?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const R = totalRotation(pageRef);
  const base = displaySize(pageRef, 1);
  const scale = width / base.w;
  const { w, h } = displaySize(pageRef, scale);

  useEffect(() => {
    const el = holder.current!;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) return;
    const job = renderPageToCanvas(pageRef, ref.current!, scale * Math.min(2, devicePixelRatio || 1), R);
    job.promise.catch(() => {});
    return () => job.cancel();
  }, [seen, pageRef.srcId, pageRef.srcIndex, R, scale]);

  return (
    <div className="thumb-img" ref={holder} style={{ width: w, height: h }}>
      <canvas ref={ref} style={{ width: w, height: h }} />
      {objectsCount > 0 && (
        <span style={{ position: 'absolute', right: 3, bottom: 3, background: '#1473e6', color: '#fff', borderRadius: 8, fontSize: 10, padding: '0 5px' }} title="此頁有編輯內容">
          ✎{objectsCount}
        </span>
      )}
    </div>
  );
}

export default memo(Thumbnail);
