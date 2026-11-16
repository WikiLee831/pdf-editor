import { useState } from 'react';
import { RotateCw, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import Thumbnail from './Thumbnail';

export default function ThumbPanel() {
  const pages = useStore((s) => s.pages);
  const objects = useStore((s) => s.objects);
  const current = useStore((s) => s.currentPage);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const st = useStore.getState;

  const move = (from: number, to: number) => {
    if (from === to || from + 1 === to) return;
    const arr = [...pages];
    const [p] = arr.splice(from, 1);
    arr.splice(to > from ? to - 1 : to, 0, p);
    st().setPages(arr);
  };

  return (
    <div className="thumbs">
      {pages.map((p, i) => (
        <div
          key={p.id}
          className={`thumb${i === current ? ' current' : ''}${over === i && drag !== null ? ' dragover' : ''}`}
          onClick={() => st().goToPage(i)}
          draggable
          onDragStart={(e) => {
            setDrag(i);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (drag === null) return;
            e.preventDefault();
            setOver(i);
          }}
          onDragEnd={() => {
            setDrag(null);
            setOver(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (drag !== null) move(drag, i);
            setDrag(null);
            setOver(null);
          }}
        >
          <Thumbnail pageRef={p} objectsCount={objects[p.id]?.length || 0} />
          <span className="thumb-num">{i + 1}</span>
          <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
            <button title="向右旋轉" onClick={() => st().setPages(pages.map((q) => (q.id === p.id ? { ...q, rotate: (q.rotate + 90) % 360 } : q)))}>
              <RotateCw size={13} />
            </button>
            <button
              title="刪除此頁"
              onClick={() => {
                if (pages.length <= 1) return st().toast('至少要保留一頁', 'error');
                st().setPages(pages.filter((q) => q.id !== p.id));
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
      <div
        style={{ height: 40 }}
        onDragOver={(e) => {
          if (drag !== null) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (drag !== null) move(drag, pages.length);
          setDrag(null);
        }}
      />
    </div>
  );
}
