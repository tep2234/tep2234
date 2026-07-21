// OMR detection (pure, framework-free, unit-testable).
// Pipeline: grayscale -> find 4 corner markers -> homography (canonical->image)
// -> sample each bubble's inner disc darkness -> classify per item.

import type { Choice, OmrTemplate, Point } from "./omr-template";
import type { ScanItemStatus } from "../types";
import { CHOICES } from "./omr-template";

export interface GrayImage {
  data: Uint8ClampedArray | Uint8Array | number[]; // single channel, 0..255
  width: number;
  height: number;
}

export interface RgbaImage {
  data: Uint8ClampedArray | number[]; // RGBA
  width: number;
  height: number;
}

export type ItemStatus = ScanItemStatus;

export interface ItemReading {
  item: number;
  detected: Choice | null;
  status: ItemStatus;
  confidence: number; // 0..1
  fill: number[]; // darkness ratio 0..1 per choice A..E
  unreadableChoices?: number[];
}

// The shade-one VERSION row, read as a second identity layer.
export interface VersionReading {
  detected: string | null; // "A".."D" or null when nothing is clearly shaded
  fill: number[];
  status: "selected" | "blank" | "unclear" | "multiple";
  confidence: number;
}

export interface SheetReading {
  aligned: boolean;
  markersFound: number;
  corners: Point[] | null;
  brightness: number; // 0..255 mean
  sharpness: number; // higher = sharper
  version: VersionReading;
  items: ItemReading[];
  // Canonical answer-area diagnostics used by independent capture gates.
  // These are derived from local paper/background and expected print outlines,
  // not from the mix of marked and unmarked answers.
  shadowLevel?: number; // 0..100, higher means less even illumination
  glareLevel?: number; // percentage of answer bubbles with washed-out bright regions
  printContrast?: number; // 0..1 median expected bubble-outline contrast
  obscuredBubbleCount?: number;
}

export interface OmrPerformanceProfile {
  markerDetectionMs: number;
  geometryCorrectionMs: number;
  bubbleSamplingMs: number;
  confidenceCalculationMs: number;
}

function profileNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// Adaptive contrast thresholds. markScore = (localBg - innerBrightness) / localBg,
// so the same physical mark reads consistently regardless of ambient lighting.
const MARK_HI = 0.25; // clearly shaded (inner 25%+ darker than surrounding paper)
const MARK_LO = 0.12; // clearly empty (below = no mark; paper noise is 5–10%)
const MARGIN = 0.08; // gap needed between top choice and runner-up
const STRONG_MARGIN = 0.13; // clean separation needed for faint marks
export const MIN_VERSION_CONFIDENCE = 0.75;

// --- grayscale ---------------------------------------------------------
export function toGray(img: RgbaImage): GrayImage {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p += 1) {
    // Rec. 601 luma.
    out[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return { data: out, width, height };
}

function meanGray(g: GrayImage): number {
  let sum = 0;
  const step = Math.max(1, Math.floor(g.data.length / 20000));
  let n = 0;
  for (let i = 0; i < g.data.length; i += step) {
    sum += g.data[i];
    n += 1;
  }
  return n > 0 ? sum / n : 255;
}

// Crude sharpness: mean absolute horizontal gradient (higher = sharper).
export function sharpnessOf(g: GrayImage): number {
  const { data, width, height } = g;
  let sum = 0;
  let n = 0;
  const stepY = Math.max(1, Math.floor(height / 200));
  for (let y = 0; y < height; y += stepY) {
    const row = y * width;
    for (let x = 1; x < width; x += 2) {
      sum += Math.abs(data[row + x] - data[row + x - 1]);
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
}

// Otsu's method: pick the gray threshold that best separates dark/light.
export function otsuThreshold(g: GrayImage): number {
  const hist = new Array(256).fill(0);
  const step = Math.max(1, Math.floor(g.data.length / 120000));
  let total = 0;
  for (let i = 0; i < g.data.length; i += step) {
    hist[g.data[i] | 0] += 1;
    total += 1;
  }
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let lo = 128;
  let hi = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    // Track the whole plateau of maximal variance and return its midpoint, so a
    // near-bimodal image (pure black on white) lands between the two peaks
    // rather than at the first/last index.
    if (v > maxVar) {
      maxVar = v;
      lo = t;
      hi = t;
    } else if (v === maxVar) {
      hi = t;
    }
  }
  return Math.round((lo + hi) / 2);
}

interface MarkerCandidate {
  x: number;
  y: number;
  area: number;
  size: number;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function quadArea(q: Point[]): number {
  let area = 0;
  for (let i = 0; i < q.length; i += 1) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function orderQuad(points: MarkerCandidate[]): MarkerCandidate[] | null {
  const tl = points.reduce((a, b) => (b.x + b.y < a.x + a.y ? b : a));
  const br = points.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
  const tr = points.reduce((a, b) => (b.x - b.y > a.x - a.y ? b : a));
  const bl = points.reduce((a, b) => (b.x - b.y < a.x - a.y ? b : a));
  const ordered = [tl, tr, br, bl];
  const uniq = new Set(ordered.map((c) => Math.round(c.x) + "," + Math.round(c.y)));
  return uniq.size === 4 ? ordered : null;
}

function bestMarkerQuad(blobs: MarkerCandidate[], w: number, h: number): MarkerCandidate[] | null {
  if (blobs.length < 4) return null;
  const candidates = blobs
    .slice()
    .sort((a, b) => b.area - a.area)
    .slice(0, 28);
  let best: { quad: MarkerCandidate[]; score: number } | null = null;
  const minSpan = Math.min(w, h) * 0.35;
  const minPageArea = w * h * 0.08;

  for (let a = 0; a < candidates.length - 3; a += 1) {
    for (let b = a + 1; b < candidates.length - 2; b += 1) {
      for (let c = b + 1; c < candidates.length - 1; c += 1) {
        for (let d = c + 1; d < candidates.length; d += 1) {
          const quad = orderQuad([candidates[a], candidates[b], candidates[c], candidates[d]]);
          if (!quad) continue;
          const [tl, tr, br, bl] = quad;
          const topW = dist(tl, tr);
          const bottomW = dist(bl, br);
          const leftH = dist(tl, bl);
          const rightH = dist(tr, br);
          const pageArea = quadArea(quad);
          if (topW < minSpan || bottomW < minSpan || leftH < minSpan || rightH < minSpan) continue;
          if (pageArea < minPageArea) continue;
          const areas = quad.map((p) => p.area);
          const areaRatio = Math.max(...areas) / Math.max(1, Math.min(...areas));
          if (areaRatio > 10) continue;
          const avgW = (topW + bottomW) / 2;
          const avgH = (leftH + rightH) / 2;
          const aspect = avgH / Math.max(avgW, 1);
          if (aspect < 0.95 || aspect > 2.2) continue;
          const parallelBalance =
            Math.abs(topW - bottomW) / Math.max(topW, bottomW) +
            Math.abs(leftH - rightH) / Math.max(leftH, rightH);
          const sizeBalance = areaRatio - 1;
          const score = pageArea - parallelBalance * pageArea * 0.18 - sizeBalance * pageArea * 0.04;
          if (!best || score > best.score) best = { quad, score };
        }
      }
    }
  }
  return best?.quad ?? null;
}

// Find the 4 corner markers ANYWHERE in the frame (the sheet need not fill it).
// The phone photo can include table texture, skew, shadows, and Safari's camera
// crop. We first collect square marker-like dark components, then choose the
// most A4-page-like set of four instead of blindly using image extremes.
export function findCornerMarkers(g: GrayImage): Point[] | null {
  const { width: w, height: h, data } = g;
  const n = w * h;
  const mean = meanGray(g);
  const thr = Math.min(otsuThreshold(g), mean - 18);
  const visited = new Uint8Array(n);
  const minDim = Math.min(w, h);
  const minSide = Math.max(10, minDim * 0.025);
  const maxSide = Math.max(minSide + 1, minDim * 0.14);
  const minArea = minSide * minSide * 0.28;
  const maxArea = maxSide * maxSide * 1.35;
  const stack: number[] = [];
  const blobs: MarkerCandidate[] = [];

  for (let start = 0; start < n; start += 1) {
    if (visited[start] || data[start] >= thr) continue;
    let count = 0;
    let sx = 0;
    let sy = 0;
    let minx = w;
    let maxx = 0;
    let miny = h;
    let maxy = 0;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    let overflow = false;
    while (stack.length) {
      const idx = stack.pop() as number;
      const x = idx % w;
      const y = (idx / w) | 0;
      count += 1;
      sx += x;
      sy += y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (count > maxArea) {
        overflow = true;
        break;
      }
      if (x > 0 && !visited[idx - 1] && data[idx - 1] < thr) {
        visited[idx - 1] = 1;
        stack.push(idx - 1);
      }
      if (x < w - 1 && !visited[idx + 1] && data[idx + 1] < thr) {
        visited[idx + 1] = 1;
        stack.push(idx + 1);
      }
      if (y > 0 && !visited[idx - w] && data[idx - w] < thr) {
        visited[idx - w] = 1;
        stack.push(idx - w);
      }
      if (y < h - 1 && !visited[idx + w] && data[idx + w] < thr) {
        visited[idx + w] = 1;
        stack.push(idx + w);
      }
    }
    if (overflow || count < minArea || count > maxArea) continue;
    const bw = maxx - minx + 1;
    const bh = maxy - miny + 1;
    const fill = count / (bw * bh);
    const aspect = bw / bh;
    const side = Math.max(bw, bh);
    if (side < minSide || side > maxSide) continue;
    if (fill < 0.28 || aspect < 0.55 || aspect > 1.8) continue;
    blobs.push({ x: sx / count, y: sy / count, area: count, size: side });
  }

  const corners = bestMarkerQuad(blobs, w, h);
  return corners ? corners.map((c) => ({ x: c.x, y: c.y })) : null;
}

// --- homography (maps `from` quad -> `to` quad) -------------------------
export function solveHomography(from: Point[], to: Point[]): number[] {
  // 8 unknowns h0..h7 (h8 = 1). Build A (8x8) and b (8).
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x: X, y: Y } = from[i];
    const { x, y } = to[i];
    A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]);
    b.push(x);
    A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]);
    b.push(y);
  }
  const h = gaussSolve(A, b);
  return [...h, 1];
}

export function applyHomography(h: number[], X: number, Y: number): Point {
  const denom = h[6] * X + h[7] * Y + h[8];
  return {
    x: (h[0] * X + h[1] * Y + h[2]) / denom,
    y: (h[3] * X + h[4] * Y + h[5]) / denom,
  };
}

// Gaussian elimination with partial pivoting for an n x n system.
function gaussSolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-9;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-9));
}

// Bilinear grayscale sample; off-image reads as white (255 = empty).
function sample(g: GrayImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= g.width - 1 || y >= g.height - 1) return 255;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * g.width + x0;
  const a = g.data[i];
  const bb = g.data[i + 1];
  const c = g.data[i + g.width];
  const d = g.data[i + g.width + 1];
  return a * (1 - fx) * (1 - fy) + bb * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

// Adaptive markScore: how much darker the bubble interior is vs its local background.
// Returns 0 (empty) to 1 (fully filled), independent of ambient brightness.
// innerR samples the mark; the ring between r*0.85 and r*1.35 samples paper background
// (r*0.85 skips the printed ink outline; r*1.35 stays clear of adjacent bubbles).
interface BubbleFeature {
  darkness: number;
  background: number;
  outlineContrast: number;
}

function bubbleFeature(g: GrayImage, h: number[], cx: number, cy: number, r: number): BubbleFeature {
  const innerR = r * 0.55;
  const outMinR2 = (r * 0.85) * (r * 0.85);
  const outMaxR = r * 1.35;
  const outMaxR2 = outMaxR * outMaxR;
  const step = 7;
  let innerSum = 0, innerN = 0;
  let outerSum = 0, outerN = 0;
  for (let dy = -step; dy <= step; dy += 1) {
    for (let dx = -step; dx <= step; dx += 1) {
      const ox = (dx / step) * outMaxR;
      const oy = (dy / step) * outMaxR;
      const d2 = ox * ox + oy * oy;
      if (d2 > outMaxR2) continue;
      const p = applyHomography(h, cx + ox, cy + oy);
      const v = sample(g, p.x, p.y);
      if (d2 <= innerR * innerR) {
        innerSum += v; innerN += 1;
      } else if (d2 >= outMinR2) {
        outerSum += v; outerN += 1;
      }
    }
  }
  const inner = innerN > 0 ? innerSum / innerN : 255;
  const outer = outerN > 0 ? outerSum / outerN : 200;
  const bg = Math.max(outer, 40); // floor prevents near-zero division in deep shadow
  // The sheet always prints a bubble outline. Sampling the darkest of three
  // nearby radii tolerates small scale/focus errors while still detecting an
  // outline erased by glare or very weak printing.
  let outlineSum = 0;
  const outlineSamples = 32;
  for (let i = 0; i < outlineSamples; i += 1) {
    const angle = (i / outlineSamples) * Math.PI * 2;
    let darkest = 255;
    for (const radiusScale of [0.9, 1, 1.1]) {
      const p = applyHomography(
        h,
        cx + Math.cos(angle) * r * radiusScale,
        cy + Math.sin(angle) * r * radiusScale,
      );
      darkest = Math.min(darkest, sample(g, p.x, p.y));
    }
    outlineSum += darkest;
  }
  const outline = outlineSum / outlineSamples;
  return {
    darkness: Math.max(0, (bg - inner) / bg),
    background: outer,
    outlineContrast: clamp01((bg - outline) / bg),
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

function isBubbleUnreadable(feature: BubbleFeature): boolean {
  // A missing outline means there is no trustworthy visual evidence that the
  // expected answer region was actually visible. Bright glare and deep local
  // obstruction receive a slightly wider threshold.
  return (
    feature.outlineContrast < 0.045 ||
    ((feature.background >= 248 || feature.background <= 65) && feature.outlineContrast < 0.08)
  );
}

function captureMetrics(features: BubbleFeature[]): {
  shadowLevel: number;
  glareLevel: number;
  printContrast: number;
  obscuredBubbleCount: number;
} {
  if (features.length === 0) {
    return { shadowLevel: 100, glareLevel: 100, printContrast: 0, obscuredBubbleCount: 0 };
  }
  const backgrounds = features.map((feature) => feature.background);
  const spread = percentile(backgrounds, 0.9) - percentile(backgrounds, 0.1);
  const shadowLevel = Math.round(Math.max(0, Math.min(100, (spread / 255) * 180)));
  const washedOut = features.filter(
    (feature) => feature.background >= 248 && feature.outlineContrast < 0.08,
  ).length;
  const glareLevel = Math.round((washedOut / features.length) * 100);
  const printContrast = Math.round(percentile(features.map((feature) => feature.outlineContrast), 0.5) * 1000) / 1000;
  const obscuredBubbleCount = features.filter(isBubbleUnreadable).length;
  return { shadowLevel, glareLevel, printContrast, obscuredBubbleCount };
}

export function classifyItem(
  item: number,
  fill: number[],
  validChoices: number,
): ItemReading {
  const valid = fill.slice(0, Math.max(1, Math.min(validChoices, fill.length)));
  // rank choices by darkness
  const order = valid.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const top = order[0];
  const second = order[1] ?? { v: 0, i: -1 };
  const marked = valid.filter((v) => v > MARK_HI).length;

  if (marked >= 2) {
    return { item, detected: null, status: "multiple", confidence: 0.2, fill };
  }
  if (marked === 1) {
    if (top.v - second.v >= MARGIN) {
      // Confidence: how dark the mark is AND how cleanly it stands apart.
      const confidence = clamp01(Math.min((top.v - second.v) / 0.20, top.v / 0.45));
      return { item, detected: CHOICES[top.i], status: "selected", confidence, fill };
    }
    // one is dark but the runner-up is close → ambiguous.
    return { item, detected: CHOICES[top.i], status: "unclear", confidence: 0.38, fill };
  }
  // nothing crossed the "shaded" threshold.
  if (top.v < MARK_LO) {
    const confidence = clamp01((MARK_LO - top.v) / MARK_LO + 0.35);
    return { item, detected: null, status: "blank", confidence, fill };
  }
  // Faint mark between empty and shaded. It may be a light pencil answer, but
  // in real phone photos faint print, shadows, and paper texture can imitate a
  // weak fill. Keep the best guess, but route it through review unless it is
  // unusually isolated from the runner-up.
  if (top.v - second.v >= STRONG_MARGIN && top.v >= MARK_LO + 0.08) {
    const confidence = clamp01(0.54 + (top.v - second.v));
    return { item, detected: CHOICES[top.i], status: "selected", confidence, fill };
  }
  if (top.v - second.v >= MARGIN) {
    const confidence = clamp01(0.36 + (top.v - second.v));
    return { item, detected: CHOICES[top.i], status: "unclear", confidence, fill };
  }
  return { item, detected: CHOICES[top.i], status: "unclear", confidence: 0.32, fill };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Strict no-missed-number guarantee: return EXACTLY items 1..total in order.
// Any index the detector failed to produce is inserted as an explicit
// "unclear" (Needs Review) placeholder — never silently dropped. This is the
// contract the scan result relies on: a 40-item sheet always yields 40 entries.
export function ensureCompleteItems(items: ItemReading[], total: number): ItemReading[] {
  const byItem = new Map<number, ItemReading>();
  for (const r of items) byItem.set(r.item, r);
  const out: ItemReading[] = [];
  for (let n = 1; n <= total; n += 1) {
    out.push(
      byItem.get(n) ?? {
        item: n,
        detected: null,
        status: "unclear",
        confidence: 0,
        fill: NO_FILL(),
      },
    );
  }
  return out;
}

// Read the shade-one VERSION bubbles using an existing homography.
function readVersionMarks(g: GrayImage, h: number[], template: OmrTemplate): VersionReading {
  const fill = template.versionBubbles.map((b) =>
    bubbleFeature(g, h, b.cx, b.cy, b.r).darkness,
  );
  const order = fill.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const top = order[0];
  const second = order[1] ?? { v: 0, i: -1 };
  if (!top || top.v < MARK_LO) {
    return { detected: null, fill, status: "blank", confidence: top ? clamp01(1 - top.v / MARK_LO) : 0 };
  }
  if (fill.filter((value) => value > MARK_HI).length >= 2) {
    return { detected: null, fill, status: "multiple", confidence: 0.2 };
  }
  if (top.v < MARK_HI || top.v - second.v < MARGIN) {
    return { detected: null, fill, status: "unclear", confidence: 0.35 };
  }
  const confidence = clamp01(Math.min(top.v / 0.45, (top.v - second.v) / 0.2));
  if (confidence < MIN_VERSION_CONFIDENCE) {
    return { detected: null, fill, status: "unclear", confidence };
  }
  return { detected: template.versionBubbles[top.i].version, fill, status: "selected", confidence };
}

const NO_FILL = () => new Array<number>(CHOICES.length).fill(0);

// Read a whole sheet. `validChoicesByItem` limits which choices count per item
// (e.g. a 4-option MC ignores E). Pass `precomputedCorners` when the caller
// already ran findCornerMarkers on this frame — marker search is the most
// expensive step, so live scanning must not pay for it twice.
export function readSheet(
  g: GrayImage,
  template: OmrTemplate,
  validChoicesByItem: Record<number, number> = {},
  precomputedCorners?: Point[] | null,
  profile?: OmrPerformanceProfile,
): SheetReading {
  const brightness = meanGray(g);
  const sharpness = sharpnessOf(g);
  const markerStartedAt = profileNow();
  const corners = precomputedCorners !== undefined ? precomputedCorners : findCornerMarkers(g);
  if (profile) profile.markerDetectionMs = profileNow() - markerStartedAt;
  if (!corners) {
    return {
      aligned: false,
      markersFound: 0,
      corners: null,
      brightness,
      sharpness,
      version: { detected: null, fill: [], status: "blank", confidence: 0 },
      items: [],
      shadowLevel: 100,
      glareLevel: 100,
      printContrast: 0,
    };
  }
  const geometryStartedAt = profileNow();
  const h = solveHomography(template.markerCenters, corners);
  if (profile) profile.geometryCorrectionMs = profileNow() - geometryStartedAt;

  // Gather darkness per item/choice.
  const bubbleStartedAt = profileNow();
  const fillByItem = new Map<number, number[]>();
  const features: BubbleFeature[] = [];
  const featuresByItem = new Map<number, BubbleFeature[]>();
  for (const b of template.bubbles) {
    if (!fillByItem.has(b.item)) fillByItem.set(b.item, NO_FILL());
    const feature = bubbleFeature(g, h, b.cx, b.cy, b.r);
    features.push(feature);
    if (!featuresByItem.has(b.item)) featuresByItem.set(b.item, []);
    featuresByItem.get(b.item)![b.choiceIndex] = feature;
    fillByItem.get(b.item)![b.choiceIndex] = feature.darkness;
  }
  if (profile) profile.bubbleSamplingMs = profileNow() - bubbleStartedAt;
  const confidenceStartedAt = profileNow();
  const metrics = captureMetrics(features);
  const localizedVisibilityComparable = metrics.printContrast >= 0.12;

  const items: ItemReading[] = [];
  for (let n = 1; n <= template.items; n += 1) {
    const fill = fillByItem.get(n) ?? NO_FILL();
    const validChoices = validChoicesByItem[n] ?? CHOICES.length;
    const classified = classifyItem(n, fill, validChoices);
    const unreadableChoices = localizedVisibilityComparable
      ? (featuresByItem.get(n) ?? [])
          .slice(0, validChoices)
          .flatMap((feature, index) => feature && isBubbleUnreadable(feature) ? [index] : [])
      : [];
    items.push(
      unreadableChoices.length > 0
        ? {
            ...classified,
            status: "unreadable",
            confidence: Math.min(classified.confidence, 0.15),
            unreadableChoices,
          }
        : classified,
    );
  }

  const version = readVersionMarks(g, h, template);
  if (profile) profile.confidenceCalculationMs = profileNow() - confidenceStartedAt;

  return { aligned: true, markersFound: 4, corners, brightness, sharpness, version, items, ...metrics };
}
