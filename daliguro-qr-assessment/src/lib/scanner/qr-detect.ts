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

const FAST_WHOLE_FRAME_MAX_SIDE = 1000;

interface Crop {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function cloneImage(img: QrImage): QrImage {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

function downsampleForFastWholeFrame(img: QrImage): QrImage {
  const longest = Math.max(img.width, img.height);
  if (longest <= FAST_WHOLE_FRAME_MAX_SIDE) return img;
  const scale = FAST_WHOLE_FRAME_MAX_SIDE / longest;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const src = (sy * img.width + sx) * 4;
      const dst = (y * width + x) * 4;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
      out[dst + 3] = 255;
    }
  }
  return { data: out, width, height };
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

function contrastStretch(img: QrImage): QrImage {
  const out = cloneImage(img);
  let min = 255;
  let max = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const y = Math.round((img.data[i] * 0.299) + (img.data[i + 1] * 0.587) + (img.data[i + 2] * 0.114));
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const span = Math.max(1, max - min);
  for (let i = 0; i < out.data.length; i += 4) {
    const y = Math.round((img.data[i] * 0.299) + (img.data[i + 1] * 0.587) + (img.data[i + 2] * 0.114));
    const v = Math.max(0, Math.min(255, Math.round(((y - min) / span) * 255)));
    out.data[i] = v;
    out.data[i + 1] = v;
    out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  return out;
}

function thresholdImage(img: QrImage): QrImage {
  const out = cloneImage(img);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    sum += (img.data[i] * 0.299) + (img.data[i + 1] * 0.587) + (img.data[i + 2] * 0.114);
    count += 1;
  }
  const threshold = count ? sum / count : 128;
  for (let i = 0; i < out.data.length; i += 4) {
    const y = (img.data[i] * 0.299) + (img.data[i + 1] * 0.587) + (img.data[i + 2] * 0.114);
    const v = y < threshold ? 0 : 255;
    out.data[i] = v;
    out.data[i + 1] = v;
    out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  return out;
}

function tryRead(img: QrImage, region: string, inversionAttempts: "dontInvert" | "attemptBoth"): QrRead | null {
  const hit = jsQR(img.data, img.width, img.height, { inversionAttempts });
  return hit?.data ? { data: hit.data, region } : null;
}

function likelyQrCrops(img: QrImage): Crop[] {
  const { width: w, height: h } = img;
  return [
    // QR is designed for top-left, but phone photos can be rotated/cropped.
    { name: "sheet-top-left", x: 0, y: 0, w: w * 0.62, h: h * 0.46 },
    { name: "sheet-top-right", x: w * 0.38, y: 0, w: w * 0.62, h: h * 0.46 },
    { name: "sheet-bottom-left", x: 0, y: h * 0.54, w: w * 0.62, h: h * 0.46 },
    { name: "sheet-bottom-right", x: w * 0.38, y: h * 0.54, w: w * 0.62, h: h * 0.46 },
    { name: "sheet-top-band", x: 0, y: 0, w, h: h * 0.52 },
    { name: "sheet-bottom-band", x: 0, y: h * 0.48, w, h: h * 0.52 },
    { name: "sheet-left-band", x: 0, y: 0, w: w * 0.55, h },
    { name: "sheet-right-band", x: w * 0.45, y: 0, w: w * 0.55, h },
    { name: "left-header", x: 0, y: 0, w: w * 0.55, h: h * 0.72 },
    { name: "upper-middle", x: w * 0.08, y: 0, w: w * 0.72, h: h * 0.55 },
    { name: "center", x: w * 0.18, y: h * 0.18, w: w * 0.64, h: h * 0.64 },
  ];
}

function readRegions(img: QrImage, suffix: string, inversionAttempts: "dontInvert" | "attemptBoth"): QrRead | null {
  const full = tryRead(img, "full" + suffix, inversionAttempts);
  if (full) return full;
  for (const c of likelyQrCrops(img)) {
    const r = crop(img, c);
    const hit = tryRead(r, c.name + suffix, inversionAttempts);
    if (hit) return hit;
  }
  return null;
}

// The literal whole-frame stage, exported separately so production telemetry
// and regression fixtures can prove when the geometry-guided rescue adds value.
// It intentionally performs one normal-polarity jsQR attempt only.
export function readQrWholeFrame(img: QrImage): QrRead | null {
  return tryRead(downsampleForFastWholeFrame(img), "full", "dontInvert");
}

export function readQrSmart(img: QrImage, thorough = true): QrRead | null {
  // Cheapest path: full frame in normal polarity.
  const whole = readQrWholeFrame(img);
  if (whole) return whole;

  // Region crops are still normal-polarity and cheaper than the transformed
  // recovery tournament. They are not counted as independent consensus votes.
  const fast = readRegions(img, "", "dontInvert");
  if (fast) return fast;

  if (!thorough) return null;

  // Recovery path: inverted/odd exposure plus the same likely regions.
  const sensitive = readRegions(img, "-sensitive", "attemptBoth");
  if (sensitive) return sensitive;

  const contrast = readRegions(contrastStretch(img), "-contrast", "attemptBoth");
  if (contrast) return contrast;

  const threshold = readRegions(thresholdImage(img), "-threshold", "attemptBoth");
  if (threshold) return threshold;

  return null;
}
