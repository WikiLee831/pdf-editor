// 座標系統：所有物件座標都是「頁面座標」
// = 未旋轉頁面、左上角為原點、y 向下、單位為 PDF 點 (pt)，相對於 pdf.js 的 page.view（裁切框）

export type FontKey = 'noto' | 'helvetica' | 'times' | 'courier';

export interface PageRef {
  id: string;
  srcId: string | null; // null = 空白頁
  srcIndex: number; // 來源文件中的頁索引 (0 起)
  width: number; // 未旋轉寬 (pt)
  height: number;
  view: [number, number, number, number]; // 來源頁面 view（PDF 使用者座標）
  baseRotate: number; // 原始 /Rotate
  rotate: number; // 使用者額外旋轉 (0/90/180/270)
}

interface BaseObj {
  id: string;
  opacity?: number;
  rot?: number; // 以 (x,y) 為軸心、順時針角度（用於抵銷頁面旋轉）
}

export interface TextObj extends BaseObj {
  type: 'text';
  x: number;
  y: number; // 文字框左上
  text: string;
  fontSize: number;
  font: FontKey;
  bold?: boolean;
  color: string;
  // 取代原文時用來遮蓋原文字的區塊
  cover?: { x: number; y: number; w: number; h: number; color: string };
  sourceRunId?: string;
}

export interface ImageObj extends BaseObj {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  src: string; // data URL (png/jpeg)
  cover?: { x: number; y: number; w: number; h: number; color: string };
  sourceImageId?: string;
}

export interface RectObj extends BaseObj {
  type: 'rect' | 'ellipse' | 'highlight' | 'whiteout';
  x: number;
  y: number;
  w: number;
  h: number;
  stroke?: string | null;
  fill?: string | null;
  strokeWidth?: number;
  sourceRunId?: string;
  sourceImageId?: string;
}

export interface LineObj extends BaseObj {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  arrow?: boolean;
}

export interface InkObj extends BaseObj {
  type: 'ink';
  points: number[][]; // [[x,y], ...]
  stroke: string;
  strokeWidth: number;
}

export type PdfObj = TextObj | ImageObj | RectObj | LineObj | InkObj;

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface OcrLine extends OcrWord {
  id: string;
  words: OcrWord[];
}

export type Tool =
  | 'select'
  | 'hand'
  | 'editText'
  | 'addText'
  | 'editImage'
  | 'placeImage'
  | 'highlight'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'ink'
  | 'whiteout'
  | 'eraser'
  | 'snapshot';

export interface ToolStyle {
  color: string; // 文字/線條顏色
  fill: string | null;
  strokeWidth: number;
  fontSize: number;
  font: FontKey;
  highlightColor: string;
  opacity: number;
  eraserSize: number; // 橡皮擦直徑 (pt)
}

// 既有文字（來自 PDF 或 OCR）合併成的「一行」
export interface TextRun {
  id: string;
  text: string;
  x: number;
  y: number; // 上緣
  w: number;
  h: number;
  baseline: number;
  fontSize: number;
  bold: boolean;
  serif: boolean;
  mono: boolean;
  source: 'pdf' | 'ocr';
}

export interface DetectedImage {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
