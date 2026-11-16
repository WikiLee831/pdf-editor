import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useStore } from '../../store';

export default function Modal({ title, children, footer, wide, onClose }: { title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; onClose?: () => void }) {
  const close = onClose || (() => useStore.getState().openDialog(null));
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn icon" onClick={close} aria-label="關閉">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function PageRangeInput({ value, onChange, total }: { value: string; onChange: (v: string) => void; total: number }) {
  return (
    <div className="opt-group">
      <span className="label">頁面範圍</span>
      <label className="radio">
        <input type="radio" checked={value === ''} onChange={() => onChange('')} /> 全部 {total} 頁
      </label>
      <label className="radio">
        <input type="radio" checked={value === 'current'} onChange={() => onChange('current')} /> 目前頁面
      </label>
      <label className="radio">
        <input type="radio" checked={value !== '' && value !== 'current'} onChange={() => onChange('1-' + total)} /> 指定頁碼
        <input className="text-input" style={{ width: 200, height: 28 }} placeholder="例如 1-3, 5, 8-10" value={value !== 'current' ? value : ''} onChange={(e) => onChange(e.target.value)} onFocus={(e) => !e.target.value && onChange('1-' + total)} />
      </label>
    </div>
  );
}
