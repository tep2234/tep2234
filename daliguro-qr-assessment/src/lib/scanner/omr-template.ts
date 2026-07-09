// Canonical SmartScan answer-sheet geometry (pure, no DOM). Template v2.
// ONE source of truth used by BOTH the printable sheet renderer and the
// scanner/detector, so a bubble printed at (cx,cy) is read at (cx,cy) after
// perspective correction. All coordinates are in a fixed A4-portrait space.
//
// v2 layout (SmartScan design): fixed 4-column × 20-row grid (up to 80 items,
// 5 choices A–E), QR panel top-left, shade-one VERSION bubbles (machine-read
// as a second identity layer), corner "target" markers. The FULL grid is
// always printed; unused rows are ignored by the detector, so geometry never
// shifts when the item count changes.

import type { Item, TestVersion } from "../types";
import { isObjective } from "../items";

export const TEMPLATE_VERSION = 2;

export const SHEET_W = 1000;
export const SHEET_H = 1414; // ~A4 portrait (210:297)

// Items the OMR grid can read: objective, letter-choice style, 2–5 choices.
export function omrItemsOf(items: Item[]): Item[] {
  return items
    .filter((i) => isObjective(i.type) && i.type !== "True or False")
    .filter((i) => i.choices >= 2 && i.choices <= 5)
    .sort((a, b) => a.itemNumber - b.itemNumber);
}

export const CHOICES = ["A", "B", "C", "D", "E"] as const;
export type Choice = (typeof CHOICES)[number];

export const MAX_ITEMS = 80;
export const SUPPORTED_SIZES = [20, 40, 60, 80] as const;
export type SheetSize = (typeof SUPPORTED_SIZES)[number];

// Smallest supported usage bucket that fits `count` items (capped at 80).
// Display-only: the printed grid is always the full 80 rows.
export function chooseSheetSize(count: number): SheetSize {
  for (const s of SUPPORTED_SIZES) if (count <= s) return s;
  return 80;
}

// --- fixed layout constants (canonical units) ---
const MARK = 56; // corner marker square size
const MARK_INSET = 28; // distance of marker from page edge
const MARK_HOLE = 18; // white knockout square inside each marker (target look)

const ROWS_PER_COL = 20;
export const COLUMNS = 4;
const GRID_TOP = 536;
const GRID_BOTTOM = 1276;
const ROW_H = (GRID_BOTTOM - GRID_TOP) / ROWS_PER_COL; // 37
const GRID_L = 52;
const GRID_R = 52;
const BUBBLE_R = 12;
const NUM_OFFSET = 56; // first bubble x within a column, after the item number
const CHOICE_DX = 34; // spacing between A–E centres

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
  choiceIndex: number; // 0..4
  choice: Choice;
  cx: number;
  cy: number;
  r: number;
}
// Shade-one version bubbles (machine-read identity layer 2).
export interface VersionBubble {
  version: TestVersion;
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
  markerHole: number;
  qrZone: Rect;
  versionBubbles: VersionBubble[];
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

export const MARKER_HOLE = MARK_HOLE;

// QR panel sits top-left (per the SmartScan design). Big enough that the
// denser v2 payload still decodes from a handheld photo.
// Fills the QR panel width (v2 payload carries checksum + item count, so the
// printed code is denser — a bigger printed QR keeps modules readable when the
// whole sheet is photographed). Renderer + e2e test both derive from this.
export const QR_ZONE: Rect = { x: 77, y: 134, w: 210, h: 210 };

// Header layout boxes (renderer-only; no machine reads inside these).
export const QR_PANEL: Rect = { x: 70, y: 112, w: 224, h: 246 };
export const INFO_PANEL: Rect = { x: 300, y: 112, w: 400, h: 236 };
export const META_PANEL: Rect = { x: 716, y: 112, w: 220, h: 236 };
export const VERSION_PANEL: Rect = { x: 64, y: 366, w: 216, h: 92 };
export const GUIDE_PANEL: Rect = { x: 300, y: 366, w: 636, h: 92 };

// Version bubbles: shade-one row inside VERSION_PANEL. Pre-shaded at print
// time for the learner's assigned version; the detector cross-checks this
// against the QR's version to catch wrong/duplicated sheets.
export const VERSION_BUBBLES: VersionBubble[] = (["A", "B", "C", "D"] as TestVersion[]).map(
  (version, i) => ({
    version,
    cx: VERSION_PANEL.x + 40 + i * 46,
    cy: VERSION_PANEL.y + 62,
    r: 11,
  }),
);

// Column index (0-based) for a 1-based item number: column-major, 20 per column.
export function columnFor(itemNumber: number): number {
  return Math.floor((itemNumber - 1) / ROWS_PER_COL);
}
export function rowFor(itemNumber: number): number {
  return (itemNumber - 1) % ROWS_PER_COL;
}

const USABLE_W = SHEET_W - GRID_L - GRID_R;
const COL_W = USABLE_W / COLUMNS;

export function columnX(column: number): number {
  return GRID_L + column * COL_W;
}

export function rowCenterY(itemNumber: number): number {
  return GRID_TOP + rowFor(itemNumber) * ROW_H + ROW_H / 2;
}

// Centre of a bubble in fixed canonical space — independent of total items.
export function bubbleCenter(itemNumber: number, choiceIndex: number): Point {
  return {
    x: columnX(columnFor(itemNumber)) + NUM_OFFSET + choiceIndex * CHOICE_DX,
    y: rowCenterY(itemNumber),
  };
}

export function buildTemplate(items: number): OmrTemplate {
  const count = Math.max(1, Math.min(items, MAX_ITEMS));

  const bubbles: Bubble[] = [];
  for (let n = 1; n <= count; n += 1) {
    for (let c = 0; c < CHOICES.length; c += 1) {
      const p = bubbleCenter(n, c);
      bubbles.push({
        item: n,
        choiceIndex: c,
        choice: CHOICES[c],
        cx: p.x,
        cy: p.y,
        r: BUBBLE_R,
      });
    }
  }

  return {
    items: count,
    width: SHEET_W,
    height: SHEET_H,
    columns: COLUMNS,
    rowHeight: ROW_H,
    bubbleRadius: BUBBLE_R,
    markerRects: MARKER_RECTS,
    markerCenters: MARKER_CENTERS,
    markerHole: MARK_HOLE,
    qrZone: QR_ZONE,
    versionBubbles: VERSION_BUBBLES,
    bubbles,
  };
}

// X of the item-number label for a column (used by the renderer).
export function numberX(column: number): number {
  return columnX(column) + 10;
}

// Header pill (A B C D E) box for a column (renderer-only).
export function columnHeaderRect(column: number): Rect {
  const x = columnX(column) + NUM_OFFSET - CHOICE_DX / 2 - 4;
  return { x, y: GRID_TOP - 32, w: CHOICE_DX * 5 + 8, h: 24 };
}

export function choiceXs(): number[] {
  return CHOICES.map((_, c) => NUM_OFFSET + c * CHOICE_DX);
}

export const GRID = { top: GRID_TOP, bottom: GRID_BOTTOM, left: GRID_L, right: GRID_R };
