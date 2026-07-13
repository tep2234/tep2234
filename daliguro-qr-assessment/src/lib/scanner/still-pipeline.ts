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
import {
  evaluateQualityGates,
  primaryQualityGuidance,
  type CaptureQualityReasonCode,
} from "./quality-gates";

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
  | { kind: "image"; message: string; reasonCodes?: StillImageReasonCode[] }
  | { kind: "identity"; resolution: ScanResolution };

export type StillImageReasonCode =
  | CaptureQualityReasonCode
  | "QR_NOT_FOUND"
  | "NO_OMR_ITEMS"
  | "ITEM_COUNT_MISMATCH"
  | "VERSION_MARK_MISSING"
  | "VERSION_MARK_UNCLEAR"
  | "VERSION_MARK_MULTIPLE"
  | "VERSION_MISMATCH";

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

function versionMissingReason(status: SheetReading["version"]["status"]): StillImageReasonCode {
  if (status === "multiple") return "VERSION_MARK_MULTIPLE";
  if (status === "unclear") return "VERSION_MARK_UNCLEAR";
  return "VERSION_MARK_MISSING";
}

export function processStillImage(
  img: ImageData,
  state: QrAssessmentState,
  activeId: string | null,
  evidence: string | null,
): StillOutcome {
  const qr = readQrSmart(img, true);
  if (!qr) {
    return {
      kind: "image",
      message: "No QR code found. Make sure the QR is fully visible, focused, and glare-free.",
      reasonCodes: ["QR_NOT_FOUND"],
    };
  }
  const res = resolveScanIdentity(qr.data, state, activeId);

  // Identity is always taken from the validated QR. Unknown learners must be
  // resolved through the separate Manual checking workflow, never reassigned
  // inside a camera scan.
  if (res.status !== "READY" && res.status !== "ASSESSMENT_NOT_ACTIVE") {
    return { kind: "identity", resolution: res };
  }
  const { learner, assessment, version, payload } = res;

  // Read the bubbles using the RESOLVED assessment's own template/key.
  const ctx = omrContext(state, assessment.id);
  if (ctx.items.length === 0) {
    return {
      kind: "image",
      message: "This assessment has no letter-choice items for OMR.",
      reasonCodes: ["NO_OMR_ITEMS"],
    };
  }
  // Stale-sheet gate: the sheet was printed with a different item count.
  if (payload.n !== ctx.items.length) {
    return {
      kind: "image",
      message:
        `This sheet was printed with ${payload.n} scannable item(s), but the assessment now has ` +
        `${ctx.items.length}. The item bank changed after printing — reprint this learner's sheet to score it safely.`,
      reasonCodes: ["ITEM_COUNT_MISMATCH"],
    };
  }
  const gray = toGray(img);
  const reading = readSheet(gray, ctx.template, ctx.validByItem);
  const captureGates = evaluateQualityGates({
    aligned: reading.aligned,
    brightness: reading.brightness,
    sharpness: reading.sharpness,
    shadowLevel: reading.shadowLevel,
    tiltAngle: tiltAngle(reading),
    bubbleDarkness: reading.printContrast,
    glareLevel: reading.glareLevel,
    obscuredBubbleCount: reading.obscuredBubbleCount,
  });
  if (captureGates.disposition === "retake") {
    return {
      kind: "image",
      message: primaryQualityGuidance(captureGates),
      reasonCodes: captureGates.hardBlockers,
    };
  }
  // Two-layer identity is mandatory: an absent, faint, or double-shaded
  // VERSION row is not equivalent to a match and must never auto-score.
  if (!reading.version.detected) {
    const reasonCode = versionMissingReason(reading.version.status);
    const detail =
      reading.version.status === "multiple"
        ? "More than one VERSION bubble appears shaded."
        : reading.version.status === "unclear"
          ? "The shaded VERSION bubble is too faint or ambiguous."
          : "The required shaded VERSION bubble was not found.";
    return {
      kind: "image",
      message: `${detail} Reprint the sheet or retake a clear, glare-free photo before scoring.`,
      reasonCodes: [reasonCode],
    };
  }
  // Two-layer identity: the sheet's shaded VERSION row must match the QR.
  if (reading.version.detected !== version) {
    return {
      kind: "image",
      message:
        `Version mismatch: the sheet's shaded VERSION bubble says ${reading.version.detected}, ` +
        `but the QR was printed for version ${version}. This looks like a mixed-up or altered sheet — ` +
        `verify the paper before scoring.`,
      reasonCodes: ["VERSION_MISMATCH"],
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
    doubtfulItems: summary.unclearCount + summary.multipleCount + summary.unreadableCount + summary.lowConfidenceCount,
    shadowLevel: reading.shadowLevel,
    tiltAngle: tiltAngle(reading),
    bubbleDarkness: reading.printContrast,
    glareLevel: reading.glareLevel,
    obscuredBubbleCount: reading.obscuredBubbleCount,
  });
  return {
    kind: "ready",
    result: {
      assessment,
      learner,
      version,
      summary,
      reading,
      source: "qr",
      confidence,
      quality,
      evidence,
    },
    // Align app context to the QR's assessment so Results/Analysis match.
    switchToAssessment:
      res.status === "ASSESSMENT_NOT_ACTIVE" ? assessment.id : null,
  };
}
