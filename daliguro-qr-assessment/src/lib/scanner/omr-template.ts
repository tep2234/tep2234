// Canonical OMR answer-sheet geometry (pure, no DOM).
// ONE source of truth used by BOTH the printable sheet renderer and the
// scanner/detector, so a bubble printed at (cx,cy) is read at (cx,cy) after
// perspective correction. All coordinates are in a fixed A4-portrait space.

import type { Item } from "../types";
import { isObjective } from "../items";

export const SHEET_W = 1000;
export const SHEET_H = 1414; // ~A4 portrait (210:297)

// Items the OMR grid can read: objective, A–D style, 2–4 choices.
export function omrItemsOf(items: Item[]): Item[] {
  return items
    .filter((i) => isObjective(i.type) && i.type !== "True or False")
    .filter((i) => i.choices >= 2 && i.choices <= 4)
    .sort((a, b) => a.itemNumber - b.itemNumber);
}

export const CHOICES = ["A", "B", "C", "D"] as const;
export type Choice = (typeof CHOICES)[number];

export const SUPPORTED_SIZES = [10, 20, 30, 40, 50] as const;
export type SheetSize = (typeof SUPPORTED_SIZES)[number];

// Smallest supported layout that fits `count` items (capped at 50).
export function chooseSheetSize(count: number): SheetSize {
  for (const s of SUPPORTED_SIZES) if (count <= s) return s;
  return 50;
}

// --- fixed layout constants (canonical units) ---
const MARK = 56; // corner marker square size
const MARK_INSET = 28; // distance of marker from page edge

const GRID_TOP = 540;
const GRID_BOTTOM = 1330;
const ROWS_PER_COL = 10;
const ROW_H = (GRID_BOTTOM - GRID_TOP) / ROWS_PER_COL; // 84
const GRID_L = 60;
const GRID_R = 60;
const BUBBLE_R = 14; // increased for better camera detection
const NUM_OFFSET = 52; // first bubble x within a column, after the item number
const CHOICE_DX = 36; // spacing between A/B/C/D centres (widened for bigger bubbles)

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Bubble {
  item: number; // 1-based item number
  choiceIndex: number; // 0..3
  choice: Choice;
  cx: number;
  cy: number;
  r: number;
}
export interface OmrTemplate {
  items: number;
  width: number;
  height: number;
  columns: number;
  rowHeight: number;
  bubbleRadius: number;
  // Marker squares (for printing) and their centres (for detection), in a
  // fixed correspondence order: [TL, TR, BR, BL].
  markerRects: Rect[];
  markerCenters: Point[];
  qrZone: Rect;
  headerZone: Rect;
  bubbles: Bubble[];
}

export const MARKER_RECTS: Rect[] = [
  { x: MARK_INSET, y: MARK_INSET, w: MARK, h: MARK }, // TL
  { x: SHEET_W - MARK_INSET - MARK, y: MARK_INSET, w: MARK, h: MARK }, // TR
  { x: SHEET_W - MARK_INSET - MARK, y: SHEET_H - MARK_INSET - MARK, w: MARK, h: MARK }, // BR
  { x: MARK_INSET, y: SHEET_H - MARK_INSET - MARK, w: MARK, h: MARK }, // BL
];

export const MARKER_CENTERS: Point[] = MARKER_RECTS.map((m) => ({
  x: m.x + m.w / 2,
  y: m.y + m.h / 2,
}));

// QR is centred near the top so it never contaminates corner-marker detection.
export const QR_ZONE: Rect = { x: (SHEET_W - 252) / 2, y: 150, w: 252, h: 252 };
export const HEADER_ZONE: Rect = { x: 40, y: 96, w: SHEET_W - 80, h: 46 };
export const LEARNER_ZONE: Rect = { x: 40, y: 410, w: SHEET_W - 80, h: 64 };

// Column index (0-based) for a 1-based item number: column-major, 10 per column.
export function columnFor(itemNumber: number): number {
  return Math.floor((itemNumber - 1) / ROWS_PER_COL);
}
export function rowFor(itemNumber: number): number {
  return (itemNumber - 1) % ROWS_PER_COL;
}

export function buildTemplate(items: number): OmrTemplate {
  const size = chooseSheetSize(items);
  const columns = Math.ceil(size / ROWS_PER_COL);
  const usable = SHEET_W - GRID_L - GRID_R;
  const colW = usable / columns;

  const bubbles: Bubble[] = [];
  for (let n = 1; n <= items; n += 1) {
    const col = columnFor(n);
    const row = rowFor(n);
    const colX = GRID_L + col * colW;
    const cy = GRID_TOP + row * ROW_H + ROW_H / 2;
    for (let c = 0; c < CHOICES.length; c += 1) {
      bubbles.push({
        item: n,
        choiceIndex: c,
        choice: CHOICES[c],
        cx: colX + NUM_OFFSET + c * CHOICE_DX,
        cy,
        r: BUBBLE_R,
      });
    }
  }

  return {
    items,
    width: SHEET_W,
    height: SHEET_H,
    columns,
    rowHeight: ROW_H,
    bubbleRadius: BUBBLE_R,
    markerRects: MARKER_RECTS,
    markerCenters: MARKER_CENTERS,
    qrZone: QR_ZONE,
    headerZone: HEADER_ZONE,
    bubbles,
  };
}

// X of the item-number label for a column (used by the renderer).
export function numberX(column: number, columns: number): number {
  const usable = SHEET_W - GRID_L - GRID_R;
  const colW = usable / columns;
  return GRID_L + column * colW + 12;
}

export function rowCenterY(itemNumber: number): number {
  return GRID_TOP + rowFor(itemNumber) * ROW_H + ROW_H / 2;
}
