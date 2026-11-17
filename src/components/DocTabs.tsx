import { FileText, Plus, X } from 'lucide-react';
import { useStore } from '../store';
import { closeDoc } from '../lib/files';

/** 文件分頁列：可同時開啟多個 PDF，點選切換、中鍵或 × 關閉 */
export default function DocTabs({ onOpen }: { onOpen: () => void }) {
  const docs = useStore((s) => s.docs);
  const active = useStore((s) => s.activeDoc);
  const activeName = useStore((s) => s.docName);
  const activeDirty = useStore((s) => s.dirty);
  const st = useStore.getState;

  return (
    <div className="doctabs" role="tablist" aria-label="已開啟的文件">
      {docs.map((d) => {
        const isActive = d.id === active;
        const name = (isActive ? activeName : d.state.docName) || '未命名.pdf';
        const dirty = isActive ? activeDirty : d.state.dirty;
        return (
          <div
            key={d.id}
            role="tab"
            aria-selected={isActive}
            className={`doctab${isActive ? ' active' : ''}`}
            title={name}
            onClick={() => st().switchDoc(d.id)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeDoc(d.id);
              }
            }}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          >
            <FileText size={14} className="doctab-icon" />
            <span className="doctab-name">{name}</span>
            {dirty && <span className="doctab-dirty" title="有未儲存的變更" />}
            <button
              className="doctab-close"
              title="關閉"
              aria-label={`關閉 ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                closeDoc(d.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
      <button className="doctab-add" title="開啟其他檔案（Ctrl+O）" onClick={onOpen}>
        <Plus size={16} />
      </button>
    </div>
  );
}
