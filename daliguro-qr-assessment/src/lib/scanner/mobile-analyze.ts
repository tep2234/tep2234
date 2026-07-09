// Pure per-frame analysis for the phone scanner (framework-free, DOM-free).
// This module is the single pipeline shared by BOTH the Web Worker (normal
// path — keeps the main thread free for camera preview and taps) and the
// main-thread fallback (when workers are unavailable). Everything here must
// stay importable inside a worker: no React, no window, no canvas.

import { decodeQrPayload } from "../qr-parse";
import { assessmentMatches, type ScanDetection } from "../sync/pairing";
import { buildTemplate, MAX_ITEMS } from "./omr-template";
import { ensureCompleteItems, findCornerMarkers, readSheet, toGray, type SheetReading } from "./omr-detect";
import { readQrSmart } from "./qr-detect";
import { REVIEW_CONFIDENCE } from "./omr-score";
import { scanQuality, type ScanQuality } from "./scan-quality";

// RGBA frame, structurally compatible with ImageData (so the page can pass
// ImageData directly) but plain enough to rebuild from a transferred buffer.
export interface FrameImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MobileScan {
  learnerId: string;
  version: string;
  totalItems: number;
  detected: ScanDetection[];
  confidence: number;
  quality: ScanQuality;
  hasDoubt: boolean;
  reviewCount: number;
  signature: string;
}

export interface FrameResult {
  scan: MobileScan | null;
  status: string;
  qrVisible: boolean;
  markersVisible: boolean;
  brightness: number;
  aligned: boolean;
  message: string;
}

export interface FrameAnalysis {
  result: FrameResult;
  // The QR text this analysis used — either the caller-provided one echoed
  // back, or a fresh jsQR decode. Callers use fresh decodes to refresh their
  // sticky QR cache.
  qrText: string | null;
}

export const AUTO_ACCEPT = 0.8;

export function avgConfidence(data: ScanDetection[]): number {
  return data.length ? data.reduce((s, d) => s + d.confidence, 0) / data.length : 0;
}

export function isDoubtful(d: ScanDetection): boolean {
  return d.status === "unclear" || d.status === "multiple" || (d.status === "selected" && d.confidence < REVIEW_CONFIDENCE);
}

export function scanSignature(lId: string, ver: string, data: ScanDetection[]): string {
  return lId + "|" + ver + "|" + data.map((d) => d.item + ":" + d.answer + ":" + d.status).join(",");
}

export function quickBrightness(data: Uint8ClampedArray | number[]): number {
  let sum = 0;
  let n = 0;
  const step = Math.max(4, Math.floor(data.length / 36000) * 4);
  for (let i = 0; i < data.length; i += step) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    n += 1;
  }
  return n ? Math.round(sum / n) : 255;
}

function readingShadowLevel(reading: SheetReading): number {
  const values = reading.items.flatMap((item) => item.fill).filter((n) => Number.isFinite(n));
  if (values.length === 0) return 100;
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  const variance = values.reduce((sum, n) => sum + (n - mean) * (n - mean), 0) / values.length;
  return Math.round(Math.max(0, Math.min(100, Math.sqrt(variance) * 180)));
}

function readingTiltAngle(reading: SheetReading): number {
  const corners = reading.corners;
  if (!corners || corners.length < 2) return 45;
  const [tl, tr] = corners;
  return Math.abs(Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180 / Math.PI);
}

function readingBubbleDarkness(reading: SheetReading): number {
  const maxes = reading.items.map((item) => Math.max(...item.fill, 0));
  return maxes.length ? maxes.reduce((sum, value) => sum + value, 0) / maxes.length : 0;
}

export function analyzeDecodedFrame(img: FrameImage, assessmentId: string, qrText: string): FrameResult {
  const brightness = quickBrightness(img.data);
  const decoded = decodeQrPayload(qrText);
  if (!decoded.ok) {
    return { scan: null, status: "qr_error", qrVisible: true, markersVisible: false, brightness, aligned: false, message: decoded.reason };
  }
  if (assessmentId && !assessmentMatches(assessmentId, decoded.payload.assessmentId)) {
    return { scan: null, status: "wrong_assessment", qrVisible: true, markersVisible: false, brightness, aligned: false, message: "Wrong assessment sheet — this QR is for a different assessment." };
  }
  // Item-count guard: block sheets whose declared item count is invalid or
  // exceeds the printable grid, rather than reading a partial sheet.
  const totalItems = Math.round(decoded.payload.n || 0);
  if (!Number.isFinite(totalItems) || totalItems < 1 || totalItems > MAX_ITEMS) {
    return { scan: null, status: "bad_item_count", qrVisible: true, markersVisible: false, brightness, aligned: false, message: `Unsupported item count (${decoded.payload.n}). Sheets must have 1–${MAX_ITEMS} items.` };
  }
  const gray = toGray(img);
  // Marker search is the most expensive step — run it ONCE and share the
  // result with readSheet instead of paying for it twice per frame.
  const corners = findCornerMarkers(gray);
  const markersVisible = corners !== null;
  const template = buildTemplate(totalItems);
  const reading: SheetReading = readSheet(gray, template, {}, corners);
  if (!reading.aligned) {
    return { scan: null, status: "markers", qrVisible: true, markersVisible, brightness, aligned: false, message: "Show all 4 corner targets" };
  }
  // Identity layer 2: the printed shade-one VERSION row must agree with the
  // QR payload. A clear mismatch means a wrong or duplicated sheet — block it.
  if (reading.version.detected && decoded.payload.version && reading.version.detected !== decoded.payload.version) {
    return { scan: null, status: "wrong_version", qrVisible: true, markersVisible, brightness, aligned: true, message: `Sheet version ${reading.version.detected} does not match this QR (version ${decoded.payload.version}). Wrong or duplicated sheet.` };
  }
  // Strict completeness: exactly items 1..totalItems, gaps flagged for review.
  const detected: ScanDetection[] = ensureCompleteItems(reading.items, totalItems).map((r) => ({
    item: r.item,
    answer: r.detected ?? "",
    status: r.status,
    confidence: r.confidence,
    fill: r.fill,
  }));
  const confidence = avgConfidence(detected);
  const hasDoubt = detected.some(isDoubtful);
  const doubtfulItems = detected.filter(isDoubtful).length;
  const quality = scanQuality({
    confidence,
    brightness: reading.brightness,
    sharpness: reading.sharpness,
    aligned: reading.aligned,
    doubtfulItems,
    shadowLevel: readingShadowLevel(reading),
    tiltAngle: readingTiltAngle(reading),
    bubbleDarkness: readingBubbleDarkness(reading),
  });
  const scan: MobileScan = {
    learnerId: decoded.payload.learnerId,
    version: decoded.payload.version,
    totalItems,
    detected,
    confidence,
    quality,
    hasDoubt,
    reviewCount: doubtfulItems,
    signature: scanSignature(decoded.payload.learnerId, decoded.payload.version, detected),
  };
  return {
    scan,
    status: hasDoubt || confidence < AUTO_ACCEPT ? "review" : "ready",
    qrVisible: true,
    markersVisible: true,
    brightness,
    aligned: true,
    message: hasDoubt ? "Needs confirmation" : "Hold steady",
  };
}

// One entry point for a whole frame. When `qrText` is provided (native
// BarcodeDetector hit or sticky cache) the QR step is skipped; otherwise jsQR
// runs here — cheap single-polarity for live frames, full multi-pass recovery
// (invert/contrast/threshold) when `thoroughQr` is set for still photos.
export function analyzeFrameData(
  img: FrameImage,
  assessmentId: string,
  qrText: string | null,
  thoroughQr: boolean,
): FrameAnalysis {
  if (qrText) {
    return { result: analyzeDecodedFrame(img, assessmentId, qrText), qrText };
  }
  const qr = readQrSmart(img, thoroughQr);
  if (!qr) {
    return {
      result: { scan: null, status: "searching", qrVisible: false, markersVisible: false, brightness: quickBrightness(img.data), aligned: false, message: "Find the sheet QR" },
      qrText: null,
    };
  }
  return { result: analyzeDecodedFrame(img, assessmentId, qr.data), qrText: qr.data };
}
