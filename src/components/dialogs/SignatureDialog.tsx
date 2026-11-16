import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { useStore } from '../../store';
import { normalizeImage, pickFiles } from '../../lib/files';

const SAVED_KEY = 'pdfstudio.signatures';

function loadSaved(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
  } catch {
    return [];
  }
}

export default function SignatureDialog() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState('#0b3d91');
  const [width, setWidth] = useState(3);
  const [empty, setEmpty] = useState(true);
  const [saved, setSaved] = useState<string[]>(loadSaved);
  const [remember, setRemember] = useState(true);
  const st = useStore.getState;

  useEffect(() => {
    const c = canvas.current!;
    c.width = c.clientWidth * 2;
    c.height = c.clientHeight * 2;
  }, []);

  const down = (e: React.PointerEvent) => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo((e.clientX - r.left) * k, (e.clientY - r.top) * k);
    c.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      ctx.lineTo((ev.clientX - r.left) * k, (ev.clientY - r.top) * k);
      ctx.stroke();
      setEmpty(false);
    };
    const up = () => {
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
    };
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
  };

  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  const use = (src: string, w: number, h: number) => {
    st().setPendingImage({ src, w, h });
    st().openDialog(null);
    st().toast('在頁面上點一下以放置簽名');
  };

  const done = () => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width,
      y0 = c.height,
      x1 = 0,
      y1 = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (data[(y * c.width + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 <= x0) return;
    const pad = 6;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + pad * 2;
    out.height = y1 - y0 + pad * 2;
    out.getContext('2d')!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    const src = out.toDataURL('image/png');
    if (remember) {
      const list = [src, ...saved].slice(0, 6);
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(list));
      } catch {
        /* ignore */
      }
    }
    use(src, out.width / 4, out.height / 4);
  };

  return (
    <Modal
      title="簽名"
      footer={
        <>
          <button
            className="btn outline"
            style={{ marginRight: 'auto' }}
            onClick={async () => {
              const [f] = await pickFiles('image/*');
              if (!f) return;
              const n = await normalizeImage(f);
              use(n.src, n.w / 2, n.h / 2);
            }}
          >
            上傳簽名圖片
          </button>
          <button className="btn outline" onClick={clear}>
            清除
          </button>
          <button className="btn primary" disabled={empty} onClick={done}>
            使用此簽名
          </button>
        </>
      }
    >
      <div className="field">
        <label>顏色</label>
        {['#000000', '#0b3d91', '#c62828'].map((c) => (
          <div key={c} className="swatch" style={{ background: c, outline: color === c ? '2px solid #1473e6' : undefined }} onClick={() => setColor(c)} />
        ))}
        <label style={{ marginLeft: 12 }}>粗細</label>
        <input type="range" min={1} max={8} value={width} onChange={(e) => setWidth(parseInt(e.target.value))} />
      </div>
      <canvas ref={canvas} className="sig-pad" style={{ height: 200 }} onPointerDown={down} />
      <label className="radio" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 在此瀏覽器記住簽名
      </label>
      {saved.length > 0 && (
        <>
          <h4 style={{ margin: '14px 0 6px', fontSize: 12, color: '#6e6e6e' }}>已儲存的簽名</h4>
          <div className="row">
            {saved.map((s, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img
                  src={s}
                  alt="簽名"
                  style={{ height: 50, border: '1px solid #ddd', borderRadius: 6, padding: 4, cursor: 'pointer', background: '#fff' }}
                  onClick={() => {
                    const img = new Image();
                    img.onload = () => use(s, img.width / 4, img.height / 4);
                    img.src = s;
                  }}
                />
                <button
                  className="btn icon"
                  style={{ position: 'absolute', top: -8, right: -8, width: 20, height: 20, background: '#fff', border: '1px solid #ddd', borderRadius: 10, fontSize: 11 }}
                  onClick={() => {
                    const list = saved.filter((_, j) => j !== i);
                    setSaved(list);
                    try {
                      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
