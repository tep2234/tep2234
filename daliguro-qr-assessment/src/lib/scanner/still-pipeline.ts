// The SmartScan still-image pipeline, as a pure function (no React, no DOM
// beyond ImageData). Three independent stages — image quality, identity
// (QR + version bubble + item-count cross-checks), bubble read — producing an
// explicit outcome the UI can route. Extracted from the scanner component so
// it stays under test and the component stays small.

import type { Assessment, Item, Learner, QrAssessmentState, TestVersion } from "../types";
import { buildTemplate, omrItemsOf, type Point } from "./omr-template";
import { findCornerMarkers, readSheet, toGray, type SheetReading } from "./omr-detect";
import { buildReview, type ReviewSummary } from "./omr-score";
import { resolveScanIdentity, type ScanResolution } from "./resolve";
import { readQrWholeFrame } from "./qr-detect";
import { readQrFromSheetZone } from "./qr-zone-rescue";
import { scanQuality, type ScanQuality } from "./scan-quality";
import {
  evaluateQualityGates,
  primaryQualityGuidance,
  type CaptureQualityReasonCode,
} from "./quality-gates";

export type CaptureProvenance = "gallery" | "camera-final" | "manual-capture";

export interface ScanResult {
  assessment: Assessment;
  learner: Learner;
  version: TestVersion;
  summary: ReviewSummary;
  reading: SheetReading;
  source: "qr" | "manual";
  captureSource: CaptureProvenance;
  // Overall trust score for the scan (mean per-item confidence, 0..1).
  confidence: number;
  quality: ScanQuality;
  // Compressed JPEG snapshot of the scanned frame (evidence archive).
  evidence: string | null;
}

// A fully read sheet whose QR never decoded. Answers are PRESERVED (mandate:
// QR failure must never discard readable answers); identity is resolved by
// the teacher through the visible sheet code or explicit learner selection.
export interface PreservedSheet {
  assessmentId: string;
  version: TestVersion;
  itemFingerprint: string;
  reading: SheetReading;
}

export type StillOutcome =
  | { kind: "ready"; result: ScanResult; switchToAssessment: string | null }
  | { kind: "image"; message: string; reasonCodes?: StillImageReasonCode[] }
  | { kind: "identity"; resolution: ScanResolution }
  | { kind: "unidentified"; preserved: PreservedSheet; message: string; reasonCodes: StillImageReasonCode[] };

export type StillImageReasonCode =
  | CaptureQualityReasonCode
  | "QR_NOT_FOUND"
  | "NO_OMR_ITEMS"
  | "ITEM_COUNT_MISMATCH"
  | "ITEM_TEMPLATE_MISMATCH"
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

// A preserved reading is positional, so item count alone cannot prove it is
// still safe to score. Bind it to the ordered, scoring-relevant item template
// that existed at capture time and reject reorder/replacement/edit drift.
function itemTemplateFingerprint(items: Item[]): string {
  return JSON.stringify(items.map((item) => ({
    id: item.id,
    itemNumber: item.itemNumber,
    type: item.type,
    question: item.question,
    correctAnswer: item.correctAnswer,
    acceptedAnswers: item.acceptedAnswers,
    points: item.points,
    choices: item.choices,
  })));
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

// When the QR is unreadable but the four markers were found and the sheet
// read cleanly against the ACTIVE assessment, preserve the answers for
// teacher-driven identity recovery instead of discarding the scan. Every
// hard gate still applies: quality retake-blockers, a clear single VERSION
// mark, and the version being enabled — anything less falls back to a plain
// image failure. Identity is NEVER guessed here.
function preserveUnidentifiedSheet(
  gray: ReturnType<typeof toGray>,
  corners: Point[],
  state: QrAssessmentState,
  activeId: string | null,
): StillOutcome | null {
  const active = activeId ? state.assessments.find((a) => a.id === activeId) : undefined;
  if (!active) return null;
  const ctx = omrContext(state, active.id);
  if (ctx.items.length === 0) return null;
  const reading = readSheet(gray, ctx.template, ctx.validByItem, corners);
  if (!reading.aligned) return null;
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
  if (captureGates.disposition === "retake") return null;
  // Membership check doubles as the TestVersion narrowing.
  const version = active.versions.find((v) => v === reading.version.detected);
  if (!version) return null;
  return {
    kind: "unidentified",
    preserved: {
      assessmentId: active.id,
      version,
      itemFingerprint: itemTemplateFingerprint(ctx.items),
      reading,
    },
    message:
      "The QR would not decode, but every answer was captured and preserved. " +
      "Identify the learner below (or type the sheet code printed under the QR into the paste box) to finish checking — nothing was lost.",
    reasonCodes: ["QR_NOT_FOUND"],
  };
}

export function processStillImage(
  img: ImageData,
  state: QrAssessmentState,
  activeId: string | null,
  evidence: string | null,
  captureSource: CaptureProvenance = "gallery",
): StillOutcome {
  // Keep the initial pass deliberately cheap. A scorable sheet must expose
  // its four alignment markers anyway, so a miss goes directly to the
  // geometry-guided, bounded QR-zone decoder instead of running a multi-crop
  // full-frame tournament on the UI thread.
  const qr = readQrWholeFrame(img);
  let qrData = qr?.data ?? null;
  let rescuedCorners: Point[] | null = null;
  if (!qrData) {
    // Decoder tournament, geometry-guided stage: markers first, then re-decode
    // the QR from its known zone at full resolution (+2x upscale). This is
    // where dense/small QRs that fail the whole-frame pass get recovered.
    const grayForRescue = toGray(img);
    rescuedCorners = findCornerMarkers(grayForRescue);
    if (rescuedCorners) {
      const rescued = readQrFromSheetZone(img, rescuedCorners);
      if (rescued) qrData = rescued.data;
      else {
        const preserved = preserveUnidentifiedSheet(grayForRescue, rescuedCorners, state, activeId);
        if (preserved) return preserved;
      }
    }
    if (!qrData) {
      return {
        kind: "image",
        message: "No QR code found. Make sure the QR is fully visible, focused, and glare-free.",
        reasonCodes: ["QR_NOT_FOUND"],
      };
    }
  }
  const res = resolveScanIdentity(qrData, state, activeId);

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
  // Reuse corners already found during QR rescue instead of re-searching.
  const reading = readSheet(gray, ctx.template, ctx.validByItem, rescuedCorners ?? undefined);
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
      captureSource,
      confidence,
      quality,
      evidence,
    },
    // Align app context to the QR's assessment so Results/Analysis match.
    switchToAssessment:
      res.status === "ASSESSMENT_NOT_ACTIVE" ? assessment.id : null,
  };
}

// Complete a preserved (QR-less) sheet after the teacher EXPLICITLY selected
// the learner. Scores through the exact same review/quality machinery as a
// QR scan, but marked source:"manual" so the record is attributable to a
// teacher identity decision, and it still lands in the normal review flow.
export function completeUnidentifiedScan(
  preserved: PreservedSheet,
  state: QrAssessmentState,
  learnerId: string,
  evidence: string | null,
  captureSource: CaptureProvenance,
): StillOutcome {
  const assessment = state.assessments.find((a) => a.id === preserved.assessmentId);
  if (!assessment) {
    return { kind: "image", message: "The assessment for this preserved scan is no longer loaded.", reasonCodes: [] };
  }
  const learner = state.learners.find((l) => l.id === learnerId);
  if (!learner) {
    return { kind: "image", message: "Selected learner is not loaded on this device.", reasonCodes: [] };
  }
  const ctx = omrContext(state, assessment.id);
  if (ctx.items.length === 0) {
    return { kind: "image", message: "This assessment has no letter-choice items for OMR.", reasonCodes: ["NO_OMR_ITEMS"] };
  }
  const { reading, version } = preserved;
  if (!assessment.versions.includes(version)) {
    return { kind: "image", message: "This preserved scan uses a version that is no longer enabled.", reasonCodes: [] };
  }
  if (reading.items.length !== ctx.items.length) {
    return {
      kind: "image",
      message: "The assessment items changed after this sheet was captured. Reprint and rescan the current sheet.",
      reasonCodes: ["ITEM_COUNT_MISMATCH"],
    };
  }
  if (preserved.itemFingerprint !== itemTemplateFingerprint(ctx.items)) {
    return {
      kind: "image",
      message: "The assessment items changed after this sheet was captured. Reprint and rescan the current sheet.",
      reasonCodes: ["ITEM_TEMPLATE_MISMATCH"],
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
      source: "manual",
      captureSource,
      confidence,
      quality,
      evidence,
    },
    switchToAssessment: null,
  };
}
