import {
  ArrowUpRight,
  Circle,
  Eraser,
  Hand,
  Highlighter,
  ImagePlus,
  Images,
  MousePointer2,
  PenLine,
  PenTool,
  Signature,
  Square,
  SquareDashed,
  Type,
  TextCursorInput,
} from 'lucide-react';
import { useStore } from '../store';
import { normalizeImage, pickFiles } from '../lib/files';
import type { Tool } from '../types';

type Item = { tool?: Tool; icon: any; label: string; key?: string; action?: () => void } | 'sep';

export async function insertImageFlow() {
  const [file] = await pickFiles('image/*');
  if (!file) return;
  try {
    const img = await normalizeImage(file);
    useStore.getState().setPendingImage(img);
    useStore.getState().toast('在頁面上點一下以放置圖片');
  } catch (e: any) {
    useStore.getState().toast(e.message, 'error');
  }
}

export const TOOL_ITEMS: Item[] = [
  { tool: 'select', icon: MousePointer2, label: '選取 / 移動物件、選取文字', key: 'V' },
  { tool: 'hand', icon: Hand, label: '手形工具（平移）', key: 'H' },
  'sep',
  { tool: 'editText', icon: TextCursorInput, label: '編輯既有文字（含 OCR 辨識文字）', key: 'E' },
  { tool: 'addText', icon: Type, label: '新增文字', key: 'T' },
  { tool: 'editImage', icon: Images, label: '編輯既有圖片（移動、取代、刪除、匯出）', key: 'I' },
  { icon: ImagePlus, label: '插入圖片', action: insertImageFlow },
  'sep',
  { tool: 'highlight', icon: Highlighter, label: '螢光筆', key: 'L' },
  { tool: 'rect', icon: Square, label: '矩形', key: 'R' },
  { tool: 'ellipse', icon: Circle, label: '橢圓', key: 'O' },
  { tool: 'line', icon: ArrowUpRight, label: '直線 / 箭頭（Shift 鎖定角度）', key: 'N' },
  { tool: 'ink', icon: PenTool, label: '手繪', key: 'D' },
  { tool: 'whiteout', icon: SquareDashed, label: '白色塗改（遮蓋內容）', key: 'W' },
  { tool: 'eraser', icon: Eraser, label: '橡皮擦（刪除物件、圖片，部分擦除手繪）', key: 'X' },
  'sep',
  { icon: Signature, label: '簽名', action: () => useStore.getState().openDialog('signature') },
];

export default function ToolRail() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  return (
    <div className="rail">
      {TOOL_ITEMS.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="rail-sep" />
        ) : (
          <button
            key={i}
            className={`btn${it.tool && tool === it.tool ? ' active' : ''}`}
            title={it.label + (it.key ? `（${it.key}）` : '')}
            onClick={() => (it.action ? it.action() : setTool(it.tool!))}
          >
            <it.icon size={19} strokeWidth={1.8} />
          </button>
        ),
      )}
      <div style={{ flex: 1 }} />
      <button className="btn" title="說明" onClick={() => useStore.getState().openDialog('about')}>
        <PenLine size={17} />
      </button>
    </div>
  );
}
