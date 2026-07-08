// High-sensitivity QR acquisition for SmartScan sheets.
// The printed QR lives in the top-left sheet panel, but handheld photos often
// include table texture, shadows, and page skew. We try cheap full-frame reads
// first, then likely sheet regions, then inversion recovery.

import jsQR from "jsqr";

export interface QrImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface QrRead {
  data: string;
  region: string;
}

interface Crop {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function crop(img: QrImage, c: Crop): QrImage {
  const x0 = Math.max(0, Math.floor(c.x));
  const y0 = Math.max(0, Math.floor(c.y));
  const w = Math.max(1, Math.min(img.width - x0, Math.floor(c.w)));
  const h = Math.max(1, Math.min(img.height - y0, Math.floor(c.h)));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const srcStart = ((y0 + y) * img.width + x0) * 4;
    const dstStart = y * w * 4;
    out.set(img.data.subarray(srcStart, srcStart + w * 4), dstStart);
  }
  return { data: out, width: w, height: h };
}

function tryRead(img: QrImage, region: string, inversionAttempts: "dontInvert" | "attemptBoth"): QrRead | null {
  const hit = jsQR(img.data, img.width, img.height, { inversionAttempts });
  return hit?.data ? { data: hit.data, region } : null;
}

function likelyQrCrops(img: QrImage): Crop[] {
  const { width: w, height: h } = img;
  return [
    { name: "sheet-top-left", x: 0, y: 0, w: w * 0.62, h: h * 0.46 },
    { name: "sheet-top-band", x: 0, y: 0, w, h: h * 0.52 },
    { name: "left-header", x: 0, y: 0, w: w * 0.55, h: h * 0.72 },
    { name: "upper-middle", x: w * 0.08, y: 0, w: w * 0.72, h: h * 0.55 },
  ];
}

export function readQrSmart(img: QrImage, thorough = true): QrRead | null {
  // Cheapest path: full frame in normal polarity.
  const fullFast = tryRead(img, "full", "dontInvert");
  if (fullFast) return fullFast;

  for (const c of likelyQrCrops(img)) {
    const r = crop(img, c);
    const hit = tryRead(r, c.name, "dontInvert");
    if (hit) return hit;
  }

  if (!thorough) return null;

  // Recovery path: inverted/odd exposure plus the same likely regions.
  const fullSensitive = tryRead(img, "full-sensitive", "attemptBoth");
  if (fullSensitive) return fullSensitive;
  for (const c of likelyQrCrops(img)) {
    const r = crop(img, c);
    const hit = tryRead(r, c.name + "-sensitive", "attemptBoth");
    if (hit) return hit;
  }
  return null;
}
