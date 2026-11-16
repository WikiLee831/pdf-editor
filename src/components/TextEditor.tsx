import { useEffect, useLayoutEffect, useRef } from 'react';
import { CSS_FAMILY } from '../lib/fonts';
import type { TextObj } from '../types';

interface Props {
  obj: TextObj;
  s: number;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

/** 就地文字編輯器（contentEditable，純文字） */
export default function TextEditor({ obj, s, onCommit, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current!;
    el.innerText = obj.text;
    el.focus();
    // 游標移到最後並全選既有文字以便直接改寫
    const range = document.createRange();
    range.selectNodeContents(el);
    if (!obj.text) range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit((ref.current?.innerText || '').replace(/​/g, '').replace(/\n$/, ''));
    else onCancel();
  };

  useEffect(() => () => finish(true), []);

  return (
    <div
      ref={ref}
      className="obj obj-text"
      contentEditable={'plaintext-only' as any}
      suppressContentEditableWarning
      spellCheck={false}
      style={{
        left: obj.x * s,
        top: obj.y * s,
        fontSize: obj.fontSize * s,
        fontFamily: CSS_FAMILY[obj.font],
        fontWeight: obj.bold ? 700 : 400,
        color: obj.color,
        transform: obj.rot ? `rotate(${obj.rot}deg)` : undefined,
        zIndex: 6,
        minWidth: 20,
        outline: '1.5px dashed #1473e6',
        background: obj.cover ? obj.cover.color : 'rgba(255,255,255,0.6)',
        cursor: 'text',
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          finish(true);
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const t = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, t);
      }}
    />
  );
}
