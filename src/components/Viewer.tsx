import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import PageView from './PageView';
import OcrPanel from './OcrPanel';

export default function Viewer() {
  const pages = useStore((s) => s.pages);
  const scale = useStore((s) => s.scale);
  const tool = useStore((s) => s.tool);
  const scrollTo = useStore((s) => s.scrollToPage);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [grabbing, setGrabbing] = useState(false);

  // 可見頁面（延遲渲染）
  useEffect(() => {
    const root = ref.current!;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.pid!;
            if (e.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next;
        });
      },
      { root, rootMargin: '600px 0px' },
    );
    root.querySelectorAll<HTMLElement>('[data-pid]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pages, scale]);

  // 目前頁碼
  useEffect(() => {
    const root = ref.current!;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mid = root.getBoundingClientRect().top + root.clientHeight / 3;
        const els = root.querySelectorAll<HTMLElement>('[data-pid]');
        let best = 0;
        els.forEach((el, i) => {
          if (el.getBoundingClientRect().top <= mid) best = i;
        });
        if (useStore.getState().currentPage !== best) useStore.getState().setCurrentPage(best);
      });
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, []);

  // 跳頁
  useEffect(() => {
    if (!scrollTo) return;
    const el = ref.current?.querySelectorAll<HTMLElement>('[data-pid]')[scrollTo.index];
    if (el) ref.current!.scrollTo({ top: el.offsetTop - 24, behavior: 'auto' });
  }, [scrollTo]);

  // Ctrl + 滾輪縮放（以目前頁為錨點）
  useEffect(() => {
    const root = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const st = useStore.getState();
      const ratio = root.scrollTop / Math.max(1, root.scrollHeight);
      st.setScale(st.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      requestAnimationFrame(() => (root.scrollTop = ratio * root.scrollHeight));
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  // 縮放時保持相對位置
  const lastScale = useRef(scale);
  useEffect(() => {
    const root = ref.current!;
    const k = scale / lastScale.current;
    lastScale.current = scale;
    if (k !== 1) {
      root.scrollTop *= k;
      root.scrollLeft *= k;
    }
  }, [scale]);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (tool === 'hand' || e.button === 1) {
      e.preventDefault();
      const root = ref.current!;
      const sx = e.clientX;
      const sy = e.clientY;
      const st = root.scrollTop;
      const sl = root.scrollLeft;
      setGrabbing(true);
      const move = (ev: PointerEvent) => {
        root.scrollTop = st - (ev.clientY - sy);
        root.scrollLeft = sl - (ev.clientX - sx);
      };
      const up = () => {
        setGrabbing(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (tool === 'select' && !target.closest('.obj, .handle, .hit')) useStore.getState().select(null);
  };

  return (
    <div className={`workspace${tool === 'hand' ? ' hand' : ''}${grabbing ? ' grabbing' : ''}`} ref={ref} onPointerDown={onPointerDown}>
      <div className="pages">
        {pages.map((p, i) => (
          <div key={p.id} data-pid={p.id}>
            <PageView pageRef={p} index={i} scale={scale} visible={visible.has(p.id)} />
          </div>
        ))}
      </div>
      <OcrPanel />
    </div>
  );
}
