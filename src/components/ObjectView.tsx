import { CSS_FAMILY } from '../lib/fonts';
import type { PdfObj } from '../types';

export type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'p1' | 'p2';

interface Props {
  obj: PdfObj;
  s: number;
  selected: boolean;
  interactive: boolean;
  hidden?: boolean;
  onDown: (e: React.PointerEvent, obj: PdfObj, mode: DragMode) => void;
  onDouble?: (obj: PdfObj) => void;
}

const handles = (obj: PdfObj, onDown: Props['onDown']) =>
  (['nw', 'ne', 'sw', 'se'] as const).map((h) => (
    <div
      key={h}
      className="handle"
      style={{
        left: h.endsWith('w') ? -5 : undefined,
        right: h.endsWith('e') ? -5 : undefined,
        top: h.startsWith('n') ? -5 : undefined,
        bottom: h.startsWith('s') ? -5 : undefined,
        cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize',
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onDown(e, obj, h);
      }}
    />
  ));

export function CoverView({ obj, s }: { obj: PdfObj; s: number }) {
  const c = (obj as any).cover as { x: number; y: number; w: number; h: number; color: string } | undefined;
  if (!c) return null;
  return <div style={{ position: 'absolute', left: c.x * s, top: c.y * s, width: c.w * s, height: c.h * s, background: c.color, pointerEvents: 'none' }} />;
}

export default function ObjectView({ obj, s, selected, interactive, hidden, onDown, onDouble }: Props) {
  const pe = interactive ? 'auto' : 'none';
  const common = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!interactive) return;
      e.stopPropagation();
      onDown(e, obj, 'move');
    },
    onDoubleClick: () => onDouble?.(obj),
  };
  const opacity = obj.opacity ?? 1;
  const rot = obj.rot ? `rotate(${obj.rot}deg)` : undefined;
  switch (obj.type) {
    case 'text':
      return (
        <div
          className={`obj obj-text${selected ? ' selected' : ''}`}
          style={{
            left: obj.x * s,
            top: obj.y * s,
            fontSize: obj.fontSize * s,
            fontFamily: CSS_FAMILY[obj.font],
            fontWeight: obj.bold ? 700 : 400,
            color: obj.color,
            opacity: hidden ? 0 : opacity,
            transform: rot,
            pointerEvents: pe,
          }}
          {...common}
        >
          {obj.text || '​'}
        </div>
      );
    case 'image':
      return (
        <div
          className={`obj obj-image${selected ? ' selected' : ''}`}
          style={{ left: obj.x * s, top: obj.y * s, width: obj.w * s, height: obj.h * s, opacity, transform: rot, transformOrigin: '0 0', pointerEvents: pe }}
          {...common}
        >
          <img src={obj.src} alt="" draggable={false} />
          {selected && interactive && !obj.rot && handles(obj, onDown)}
        </div>
      );
    case 'rect':
    case 'ellipse':
    case 'highlight':
    case 'whiteout': {
      const style: React.CSSProperties = {
        left: obj.x * s,
        top: obj.y * s,
        width: obj.w * s,
        height: obj.h * s,
        pointerEvents: pe,
      };
      if (obj.type === 'highlight') {
        style.background = obj.fill || '#ffeb3b';
        style.opacity = obj.opacity ?? 0.45;
        style.mixBlendMode = 'multiply';
      } else if (obj.type === 'whiteout') {
        style.background = obj.fill || '#ffffff';
        style.opacity = opacity;
      } else {
        style.background = obj.fill || 'transparent';
        style.border = obj.stroke ? `${(obj.strokeWidth ?? 2) * s}px solid ${obj.stroke}` : undefined;
        style.opacity = opacity;
        if (obj.type === 'ellipse') style.borderRadius = '50%';
      }
      return (
        <div className={`obj${selected ? ' selected' : ''}`} style={style} {...common}>
          {selected && interactive && handles(obj, onDown)}
        </div>
      );
    }
    case 'line': {
      const ang = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
      const len = Math.max(8, obj.strokeWidth * 4);
      const heads = obj.arrow
        ? [-1, 1].map((k) => {
            const a = ang + Math.PI + (k * Math.PI) / 7;
            return `M${obj.x2 * s} ${obj.y2 * s} L${(obj.x2 + len * Math.cos(a)) * s} ${(obj.y2 + len * Math.sin(a)) * s}`;
          })
        : [];
      const d = `M${obj.x1 * s} ${obj.y1 * s} L${obj.x2 * s} ${obj.y2 * s} ${heads.join(' ')}`;
      return (
        <svg className="svg-layer" style={{ opacity }}>
          <path d={d} stroke={obj.stroke} strokeWidth={obj.strokeWidth * s} strokeLinecap="round" fill="none" />
          {interactive && <path className="hit" d={d} stroke="transparent" strokeWidth={Math.max(12, obj.strokeWidth * s + 8)} fill="none" {...common} />}
          {selected && <path d={d} stroke="#1473e6" strokeWidth={1} strokeDasharray="4 3" fill="none" />}
          {selected &&
            interactive &&
            (['p1', 'p2'] as const).map((p) => (
              <rect
                key={p}
                x={(p === 'p1' ? obj.x1 : obj.x2) * s - 5}
                y={(p === 'p1' ? obj.y1 : obj.y2) * s - 5}
                width={10}
                height={10}
                fill="#fff"
                stroke="#1473e6"
                style={{ pointerEvents: 'all', cursor: 'crosshair' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onDown(e, obj, p);
                }}
              />
            ))}
        </svg>
      );
    }
    case 'ink': {
      const d = obj.points.map((p, i) => `${i ? 'L' : 'M'}${p[0] * s} ${p[1] * s}`).join(' ');
      return (
        <svg className="svg-layer" style={{ opacity }}>
          <path d={d} stroke={obj.stroke} strokeWidth={obj.strokeWidth * s} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {interactive && <path className="hit" d={d} stroke="transparent" strokeWidth={Math.max(12, obj.strokeWidth * s + 8)} fill="none" {...common} />}
          {selected && <path d={d} stroke="#1473e6" strokeWidth={1} strokeDasharray="4 3" fill="none" />}
        </svg>
      );
    }
  }
}
