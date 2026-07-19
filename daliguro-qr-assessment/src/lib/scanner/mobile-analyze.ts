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
import { BLANK_REVIEW_CONFIDENCE, REVIEW_CONFIDENCE } from "./omr-score";
import { scanQuality, type ScanQuality } from "./scan-quality";
import {
  evaluateQualityGates,
  primaryQualityGuidance,
  type CaptureQualityReasonCode,
} from "./quality-gates";
import {
  normalizedSheetGeometry,
  type NormalizedSheetGeometry,
} from "./frame-stability";

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
  geometry: NormalizedSheetGeometry;
  frameBrightness: number;
  frameSharpness: number;
  // Pixel width frameSharpness was measured at, so stability checks can compare
  // a low-res preview baseline against the high-res final still fairly.
  frameWidth: number;
}

export interface FrameResult {
  scan: MobileScan | null;
  status: string;
  qrVisible: boolean;
  markersVisible: boolean;
  brightness: number;
  aligned: boolean;
  message: string;
  reasonCodes?: MobileFrameReasonCode[];
}

export type MobileFrameReasonCode =
  | CaptureQualityReasonCode
  | "QR_INVALID"
  | "WRONG_ASSESSMENT"
  | "INVALID_ITEM_COUNT"
  | "VERSION_MARK_MISSING"
  | "VERSION_MARK_UNCLEAR"
  | "VERSION_MARK_MULTIPLE"
  | "VERSION_MISMATCH";

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

// Blanks below this confidence mean the darkest bubble was close to the shade
// threshold — the classic signature of a REAL mark washed out by blur,
// distance, or dim light. Those must confirm with the teacher, not silently
// submit as "no answer". Clean blanks (near-zero darkness) score ~1.0 and are
// unaffected.
export function isDoubtful(d: ScanDetection): boolean {
  return (
    d.status === "unclear" ||
    d.status === "multiple" ||
    d.status === "unreadable" ||
    (d.status === "selected" && d.confidence < REVIEW_CONFIDENCE) ||
    (d.status === "blank" && d.confidence < BLANK_REVIEW_CONFIDENCE)
  );
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

function readingTiltAngle(reading: SheetReading): number {
  const corners = reading.corners;
  if (!corners || corners.length < 2) return 45;
  const [tl, tr] = corners;
  return Math.abs(Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180 / Math.PI);
}

export function analyzeDecodedFrame(img: FrameImage, assessmentId: string, qrText: string): FrameResult {
  const brightness = quickBrightness(img.data);
  const decoded = decodeQrPayload(qrText);
  if (!decoded.ok) {
    return { scan: null, status: "qr_error", qrVisible: true, markersVisible: false, brightness, aligned: false, message: decoded.reason, reasonCodes: ["QR_INVALID"] };
  }
  if (assessmentId && !assessmentMatches(assessmentId, decoded.payload.assessmentId)) {
    return { scan: null, status: "wrong_assessment", qrVisible: true, markersVisible: false, brightness, aligned: false, message: "Wrong assessment sheet — this QR is for a different assessment.", reasonCodes: ["WRONG_ASSESSMENT"] };
  }
  // Item-count guard: block sheets whose declared item count is invalid or
  // exceeds the printable grid, rather than reading a partial sheet.
  const totalItems = decoded.payload.n;
  if (!Number.isInteger(totalItems) || totalItems < 1 || totalItems > MAX_ITEMS) {
    return { scan: null, status: "bad_item_count", qrVisible: true, markersVisible: false, brightness, aligned: false, message: `Unsupported item count (${decoded.payload.n}). Sheets must have 1–${MAX_ITEMS} items.`, reasonCodes: ["INVALID_ITEM_COUNT"] };
  }
  const gray = toGray(img);
  // Marker search is the most expensive step — run it ONCE and share the
  // result with readSheet instead of paying for it twice per frame.
  const corners = findCornerMarkers(gray);
  const markersVisible = corners !== null;
  const template = buildTemplate(totalItems);
  const reading: SheetReading = readSheet(gray, template, {}, corners);
  if (!reading.aligned) {
    return { scan: null, status: "markers", qrVisible: true, markersVisible, brightness, aligned: false, message: "Show all 4 corner targets", reasonCodes: ["SHEET_NOT_ALIGNED"] };
  }
  const geometry = normalizedSheetGeometry(reading.corners, img.width, img.height);
  if (!geometry) {
    return { scan: null, status: "markers", qrVisible: true, markersVisible, brightness, aligned: false, message: "Sheet geometry could not be verified. Show all 4 corner targets.", reasonCodes: ["SHEET_NOT_ALIGNED"] };
  }
  const captureGates = evaluateQualityGates({
    aligned: reading.aligned,
    brightness: reading.brightness,
    sharpness: reading.sharpness,
    shadowLevel: reading.shadowLevel,
    tiltAngle: readingTiltAngle(reading),
    bubbleDarkness: reading.printContrast,
    glareLevel: reading.glareLevel,
    obscuredBubbleCount: reading.obscuredBubbleCount,
  });
  if (captureGates.disposition === "retake") {
    return {
      scan: null,
      status: "quality_retake",
      qrVisible: true,
      markersVisible,
      brightness,
      aligned: true,
      message: primaryQualityGuidance(captureGates),
      reasonCodes: captureGates.hardBlockers,
    };
  }
  // A missing, faint, or double-shaded VERSION row is a failed identity
  // cross-check, not a successful match to the QR payload.
  if (!reading.version.detected) {
    const status = reading.version.status;
    const reasonCode: MobileFrameReasonCode =
      status === "multiple"
        ? "VERSION_MARK_MULTIPLE"
        : status === "unclear"
          ? "VERSION_MARK_UNCLEAR"
          : "VERSION_MARK_MISSING";
    const message =
      status === "multiple"
        ? "More than one VERSION bubble is shaded — use the correct printed sheet."
        : status === "unclear"
          ? "VERSION mark is too faint or ambiguous — retake or reprint the sheet."
          : "Required VERSION mark is missing — retake or reprint the sheet.";
    return { scan: null, status: "version_missing", qrVisible: true, markersVisible, brightness, aligned: true, message, reasonCodes: [reasonCode] };
  }
  // Identity layer 2: the printed shade-one VERSION row must agree with the
  // QR payload. A clear mismatch means a wrong or duplicated sheet — block it.
  if (decoded.payload.version && reading.version.detected !== decoded.payload.version) {
    return { scan: null, status: "wrong_version", qrVisible: true, markersVisible, brightness, aligned: true, message: `Sheet version ${reading.version.detected} does not match this QR (version ${decoded.payload.version}). Wrong or duplicated sheet.`, reasonCodes: ["VERSION_MISMATCH"] };
  }
  // Strict completeness: exactly items 1..totalItems, gaps flagged for review.
  const detected: ScanDetection[] = ensureCompleteItems(reading.items, totalItems).map((r) => ({
    item: r.item,
    answer: r.detected ?? "",
    status: r.status,
    confidence: r.confidence,
    fill: r.fill,
    unreadableChoices: r.unreadableChoices,
  }));
  const confidence = avgConfidence(detected);
  const hasItemDoubt = detected.some(isDoubtful);
  const doubtfulItems = detected.filter(isDoubtful).length;
  const quality = scanQuality({
    confidence,
    brightness: reading.brightness,
    sharpness: reading.sharpness,
    aligned: reading.aligned,
    doubtfulItems,
    shadowLevel: reading.shadowLevel,
    tiltAngle: readingTiltAngle(reading),
    bubbleDarkness: reading.printContrast,
    glareLevel: reading.glareLevel,
    obscuredBubbleCount: reading.obscuredBubbleCount,
  });
  if (quality.disposition === "retake") {
    return {
      scan: null,
      status: "quality_retake",
      qrVisible: true,
      markersVisible,
      brightness,
      aligned: true,
      message: quality.issues[0] ?? "Capture quality requires a retake.",
      reasonCodes: quality.hardBlockers,
    };
  }
  const hasDoubt = hasItemDoubt || quality.disposition === "review";
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
    geometry,
    frameBrightness: reading.brightness,
    frameSharpness: reading.sharpness,
    frameWidth: img.width,
  };
  return {
    scan,
    status: hasDoubt || confidence < AUTO_ACCEPT || !quality.autoEligible ? "review" : "ready",
    qrVisible: true,
    markersVisible: true,
    brightness,
    aligned: true,
    message: hasDoubt ? "Needs confirmation" : "Hold steady",
    reasonCodes: quality.reasonCodes,
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
