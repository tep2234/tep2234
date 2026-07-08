// The SmartScan still-image pipeline, as a pure function (no React, no DOM
// beyond ImageData). Three independent stages — image quality, identity
// (QR + version bubble + item-count cross-checks), bubble read — producing an
// explicit outcome the UI can route. Extracted from the scanner component so
// it stays under test and the component stays small.

import type { Assessment, Learner, QrAssessmentState, TestVersion } from "../types";
import { buildTemplate, omrItemsOf } from "./omr-template";
import { readSheet, toGray, type SheetReading } from "./omr-detect";
import { buildReview, type ReviewSummary } from "./omr-score";
import { resolveScanIdentity, type ScanResolution } from "./resolve";
import { readQrSmart } from "./qr-detect";
import { scanQuality, type ScanQuality } from "./scan-quality";

export interface ScanResult {
  assessment: Assessment;
  learner: Learner;
  version: TestVersion;
  summary: ReviewSummary;
  reading: SheetReading;
  source: "qr" | "manual";
  // Overall trust score for the scan (mean per-item confidence, 0..1).
  confidence: number;
  quality: ScanQuality;
  // Compressed JPEG snapshot of the scanned frame (evidence archive).
  evidence: string | null;
}

export type StillOutcome =
  | { kind: "ready"; result: ScanResult; switchToAssessment: string | null }
  | { kind: "image"; message: string }
  | { kind: "identity"; resolution: ScanResolution };

// Below this the frame is too blurred to trust (mean abs gradient).
export const MIN_SHARPNESS = 2.4;

export function omrContext(state: QrAssessmentState, assessmentId: string) {
  const items = omrItemsOf(state.items.filter((i) => i.assessmentId === assessmentId));
  const template = buildTemplate(Math.max(1, items.length));
  const validByItem: Record<number, number> = {};
  items.forEach((it, i) => (validByItem[i + 1] = Math.max(2, Math.min(it.choices, 5))));
  return { items, template, validByItem };
}

function meanConfidence(reading: SheetReading): number {
  if (reading.items.length === 0) return 0;
  const sum = reading.items.reduce((acc, r) => acc + r.confidence, 0);
  return Math.round((sum / reading.items.length) * 100) / 100;
}

function tiltAngle(reading: SheetReading): number {
  const corners = reading.corners;
  if (!corners || corners.length < 2) return 45;
  const [tl, tr] = corners;
  return Math.abs(Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180 / Math.PI);
}

function meanBubbleDarkness(reading: SheetReading): number {
  const maxes = reading.items.map((item) => Math.max(...item.fill, 0));
  return maxes.length ? maxes.reduce((sum, value) => sum + value, 0) / maxes.length : 0;
}

function shadowLevel(reading: SheetReading): number {
  const values = reading.items.flatMap((item) => item.fill).filter((n) => Number.isFinite(n));
  if (values.length === 0) return 100;
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  const variance = values.reduce((sum, n) => sum + (n - mean) * (n - mean), 0) / values.length;
  return Math.round(Math.max(0, Math.min(100, Math.sqrt(variance) * 180)));
}

export function processStillImage(
  img: ImageData,
  state: QrAssessmentState,
  activeId: string | null,
  manualId: string | undefined,
  evidence: string | null,
): StillOutcome {
  const qr = readQrSmart(img, true);
  if (!qr) {
    return {
      kind: "image",
      message: "No QR code found. Make sure the QR is fully visible, focused, and glare-free.",
    };
  }
  const res = resolveScanIdentity(qr.data, state, activeId);

  // Decide the learner: from the QR, or a deliberate manual override.
  let learner: Learner | null = null;
  let assessment: Assessment | null = null;
  let version: TestVersion = "A";
  if (res.status === "READY" || res.status === "ASSESSMENT_NOT_ACTIVE") {
    learner = res.learner;
    assessment = res.assessment;
    version = res.version;
  } else if (res.status === "LEARNER_NOT_FOUND" && manualId) {
    const picked = state.learners.find((l) => l.id === manualId);
    if (picked) {
      learner = picked;
      assessment = res.assessment;
      version = res.payload.version;
    }
  }
  if (!learner || !assessment) {
    return { kind: "identity", resolution: res };
  }

  // Read the bubbles using the RESOLVED assessment's own template/key.
  const ctx = omrContext(state, assessment.id);
  if (ctx.items.length === 0) {
    return { kind: "image", message: "This assessment has no letter-choice items for OMR." };
  }
  // Stale-sheet gate: the sheet was printed with a different item count.
  if (res.status !== "QR_PAYLOAD_INVALID" && res.payload.n > 0 && res.payload.n !== ctx.items.length) {
    return {
      kind: "image",
      message:
        `This sheet was printed with ${res.payload.n} scannable item(s), but the assessment now has ` +
        `${ctx.items.length}. The item bank changed after printing — reprint this learner's sheet to score it safely.`,
    };
  }
  const gray = toGray(img);
  const reading = readSheet(gray, ctx.template, ctx.validByItem);
  if (!reading.aligned) {
    return {
      kind: "image",
      message:
        "Found the QR, but not the 4 corner markers. Capture the WHOLE sheet, flat, all corners visible, no glare.",
    };
  }
  if (reading.brightness < 70) {
    return { kind: "image", message: "Found the QR, but the photo is too dark — use brighter light and retake." };
  }
  if (reading.sharpness < MIN_SHARPNESS) {
    return {
      kind: "image",
      message: "The photo is too blurry to score safely. Hold the phone steady, let it focus, and retake.",
    };
  }
  // Two-layer identity: the sheet's shaded VERSION row must match the QR.
  if (reading.version.detected && reading.version.detected !== version) {
    return {
      kind: "image",
      message:
        `Version mismatch: the sheet's shaded VERSION bubble says ${reading.version.detected}, ` +
        `but the QR was printed for version ${version}. This looks like a mixed-up or altered sheet — ` +
        `verify the paper before scoring.`,
    };
  }
  const vk = (state.answerKeys[assessment.id] ?? {})[version] ?? {};
  const summary = buildReview(ctx.items, vk, reading.items);
  const confidence = meanConfidence(reading);
  const quality = scanQuality({
    confidence,
    brightness: reading.brightness,
    sharpness: reading.sharpness,
    aligned: reading.aligned,
    doubtfulItems: summary.unclearCount + summary.multipleCount + summary.lowConfidenceCount,
    shadowLevel: shadowLevel(reading),
    tiltAngle: tiltAngle(reading),
    bubbleDarkness: meanBubbleDarkness(reading),
  });
  return {
    kind: "ready",
    result: {
      assessment,
      learner,
      version,
      summary,
      reading,
      source: manualId ? "manual" : "qr",
      confidence,
      quality,
      evidence,
    },
    // Align app context to the QR's assessment so Results/Analysis match.
    switchToAssessment:
      res.status === "ASSESSMENT_NOT_ACTIVE" && manualId === undefined ? assessment.id : null,
  };
}
