// Post-homography QR rescue (decoder-tournament stage, 98% mandate).
//
// Full-frame QR reads fail exactly when the whole page fills the photo: the
// symbol is a small fraction of the frame and jsQR's global binarizer works
// against desk texture, shadows, and skew. But when the four corner markers
// ARE found, the sheet's geometry is known — so the printed QR zone can be
// located precisely, cropped from the ORIGINAL full-resolution capture, and
// re-decoded on its own (plus a 2x nearest-neighbor upscale, which restores
// sub-3px modules to a size jsQR handles). QR and OMR stay independent: this
// only runs after marker detection succeeded, and never invents identity.

import { MARKER_CENTERS, QR_ZONE, type Point } from "./omr-template";
import { applyHomography, solveHomography } from "./omr-detect";
import jsQR from "jsqr";
import type { QrImage, QrRead } from "./qr-detect";

// Canonical-space padding around the QR zone: covers the quiet zone plus
// modest marker-localization error without pulling in the info panel.
const ZONE_PAD = 26;
// A QR zone does not need multi-megapixel rasters. Keeping every decoder input
// within this range bounds both jsQR work and temporary RGBA allocations while
// retaining at least ~4 px/module for dense legacy (53-module) sheets.
const MIN_RESCUE_SIDE = 256;
const MAX_RESCUE_SIDE = 512;
const MAX_DECODE_ATTEMPTS = 2;

function boundedDimension(value: number): number {
  return Math.max(MIN_RESCUE_SIDE, Math.min(MAX_RESCUE_SIDE, Math.round(value)));
}

function cropRectBounded(img: QrImage, x0: number, y0: number, x1: number, y1: number): QrImage | null {
  const cx0 = Math.max(0, Math.floor(x0));
  const cy0 = Math.max(0, Math.floor(y0));
  const cx1 = Math.min(img.width, Math.ceil(x1));
  const cy1 = Math.min(img.height, Math.ceil(y1));
  const sourceW = cx1 - cx0;
  const sourceH = cy1 - cy0;
  if (sourceW < 16 || sourceH < 16) return null;
  const longest = Math.max(sourceW, sourceH);
  const targetLongest = boundedDimension(longest);
  const scale = targetLongest / longest;
  const w = Math.max(16, Math.round(sourceW * scale));
  const h = Math.max(16, Math.round(sourceH * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(cy1 - 1, cy0 + Math.floor(y / scale));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(cx1 - 1, cx0 + Math.floor(x / scale));
      const src = (sy * img.width + sx) * 4;
      const dst = (y * w + x) * 4;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
      out[dst + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Sample the projected QR quadrilateral into a front-facing square. A bounding
// crop alone leaves keystone distortion in place, which is exactly the case
// where whole-frame decoding tends to fail.
function rectifyZone(img: QrImage, homography: number[], zonePoints: Point[]): QrImage | null {
  const projectedSize = Math.round(Math.max(
    distance(zonePoints[0], zonePoints[1]),
    distance(zonePoints[1], zonePoints[2]),
    distance(zonePoints[2], zonePoints[3]),
    distance(zonePoints[3], zonePoints[0]),
  ));
  const size = boundedDimension(projectedSize);
  if (!Number.isFinite(size)) return null;
  const out = new Uint8ClampedArray(size * size * 4);
  const canonicalSize = QR_ZONE.w + ZONE_PAD * 2;
  for (let y = 0; y < size; y += 1) {
    const cy = QR_ZONE.y - ZONE_PAD + ((y + 0.5) / size) * canonicalSize;
    for (let x = 0; x < size; x += 1) {
      const cx = QR_ZONE.x - ZONE_PAD + ((x + 0.5) / size) * canonicalSize;
      const source = applyHomography(homography, cx, cy);
      const sx = Math.max(0, Math.min(img.width - 1, Math.round(source.x)));
      const sy = Math.max(0, Math.min(img.height - 1, Math.round(source.y)));
      const src = (sy * img.width + sx) * 4;
      const dst = (y * size + x) * 4;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
      out[dst + 3] = 255;
    }
  }
  return { data: out, width: size, height: size };
}

function decodeZone(img: QrImage, region: string): QrRead | null {
  // Exactly one jsQR call per candidate. `attemptBoth` covers inverted camera
  // output without launching the broad whole-frame crop/contrast tournament.
  const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
  return hit?.data ? { data: hit.data, region } : null;
}

// Re-decode the QR from its known sheet zone, using detected marker corners
// (image-space centers in TL,TR,BR,BL order) to locate it. Returns null when
// the zone still doesn't decode — callers then preserve answers for review.
export function readQrFromSheetZone(img: QrImage, corners: Point[]): QrRead | null {
  if (corners.length !== 4) return null;
  const h = solveHomography(MARKER_CENTERS, corners);
  const zonePoints = [
    applyHomography(h, QR_ZONE.x - ZONE_PAD, QR_ZONE.y - ZONE_PAD),
    applyHomography(h, QR_ZONE.x + QR_ZONE.w + ZONE_PAD, QR_ZONE.y - ZONE_PAD),
    applyHomography(h, QR_ZONE.x + QR_ZONE.w + ZONE_PAD, QR_ZONE.y + QR_ZONE.h + ZONE_PAD),
    applyHomography(h, QR_ZONE.x - ZONE_PAD, QR_ZONE.y + QR_ZONE.h + ZONE_PAD),
  ];
  const xs = zonePoints.map((p) => p.x);
  const ys = zonePoints.map((p) => p.y);
  const rectified = rectifyZone(img, h, zonePoints);
  if (rectified) {
    const direct = decodeZone(rectified, "zone-warp");
    if (direct) return direct;
  }

  // One bounded raw crop is the fallback for already front-facing sheets. The
  // function has a hard two-attempt ceiling: rectified zone, then raw crop.
  const crop = cropRectBounded(img, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  if (!crop) return null;
  return decodeZone(crop, "zone-crop");
}

// Exported only for a regression assertion that the rescue budget stays
// explicit if this decoder is extended later.
export const QR_ZONE_RESCUE_LIMITS = {
  minSide: MIN_RESCUE_SIDE,
  maxSide: MAX_RESCUE_SIDE,
  maxDecodeAttempts: MAX_DECODE_ATTEMPTS,
} as const;
