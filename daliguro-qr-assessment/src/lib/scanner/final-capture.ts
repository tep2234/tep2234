// Final-capture safety boundary shared by live scanner paths. Preview frames
// are only permission to take a still; the exact still used for scoring must
// independently retain the same identity, geometry, lighting, and focus.

import type { ScanDetection } from "../sync/pairing";
import {
  advanceFrameStability,
  type FrameStabilityState,
  type NormalizedSheetGeometry,
} from "./frame-stability";
import {
  isDoubtful,
  scanSignature,
  type FrameAnalysis,
  type MobileScan,
} from "./mobile-analyze";

export interface StableCaptureExpectation {
  identity: string;
  state: FrameStabilityState;
}

export interface FinalCaptureObservation {
  identity: string | null;
  geometry: NormalizedSheetGeometry | null;
  luminance: number;
  sharpness: number;
  // Pixel width the final sharpness was measured at. Lets the stability check
  // compare a low-res preview baseline against the high-res final still fairly.
  sharpnessWidth?: number;
  observedAt: number;
}

export type FinalCaptureFailureCode =
  | "FINAL_IDENTITY_MISSING"
  | "FINAL_IDENTITY_CHANGED"
  | "FINAL_GEOMETRY_MISSING"
  | "FINAL_CAPTURE_UNSTABLE"
  | "FINAL_ANALYSIS_REJECTED"
  | "FINAL_SCAN_SCOPE_CHANGED";

export type FinalCaptureStability =
  | { ok: true }
  | { ok: false; code: FinalCaptureFailureCode; message: string };

export function verifyFinalCaptureStability(
  expected: StableCaptureExpectation,
  observed: FinalCaptureObservation,
): FinalCaptureStability {
  if (!observed.identity) {
    return {
      ok: false,
      code: "FINAL_IDENTITY_MISSING",
      message: "The QR disappeared during final capture. Hold the same sheet still and try again.",
    };
  }
  if (observed.identity !== expected.identity) {
    return {
      ok: false,
      code: "FINAL_IDENTITY_CHANGED",
      message: "A different sheet or QR appeared during final capture. Restart the stable hold.",
    };
  }
  if (!observed.geometry) {
    return {
      ok: false,
      code: "FINAL_GEOMETRY_MISSING",
      message: "The sheet moved outside the frame during final capture. Show all four corner targets.",
    };
  }
  const decision = advanceFrameStability(expected.state, {
    identity: observed.identity,
    geometry: observed.geometry,
    luminance: observed.luminance,
    sharpness: observed.sharpness,
    sharpnessWidth: observed.sharpnessWidth,
    observedAt: observed.observedAt,
    freshIdentity: true,
  });
  if (!decision.ready) {
    return {
      ok: false,
      code: "FINAL_CAPTURE_UNSTABLE",
      message: "Movement, focus, or lighting changed during final capture. Hold still for four new stable frames.",
    };
  }
  return { ok: true };
}

function sameEvidence(left: ScanDetection, right: ScanDetection): boolean {
  return left.item === right.item && left.answer === right.answer && left.status === right.status;
}

function conservativeReading(preview: ScanDetection, final: ScanDetection): ScanDetection {
  const unreadableChoices = Array.from(
    new Set([...(preview.unreadableChoices ?? []), ...(final.unreadableChoices ?? [])]),
  ).sort((left, right) => left - right);
  if (sameEvidence(preview, final)) {
    return {
      ...final,
      confidence: Math.min(preview.confidence, final.confidence),
      ...(unreadableChoices.length > 0 ? { unreadableChoices } : {}),
    };
  }
  const status =
    preview.status === "unreadable" || final.status === "unreadable"
      ? "unreadable"
      : preview.status === "multiple" ||
          final.status === "multiple" ||
          (preview.answer && final.answer && preview.answer !== final.answer)
        ? "multiple"
        : "unclear";
  return {
    ...final,
    status,
    // Keep the final still's suggestion visible for teacher review, but make
    // the uncertainty impossible to score as a definite automatic response.
    confidence: Math.min(preview.confidence, final.confidence, 0.49),
    ...(unreadableChoices.length > 0 ? { unreadableChoices } : {}),
  };
}

export type FinalMobileCapture =
  | { ok: true; scan: MobileScan; evidenceDisagreed: boolean }
  | { ok: false; code: FinalCaptureFailureCode; message: string };

export function verifyFinalMobileCapture(
  expected: StableCaptureExpectation,
  previewConsensus: MobileScan,
  finalAnalysis: FrameAnalysis,
  capturedAt: number,
): FinalMobileCapture {
  const finalScan = finalAnalysis.result.scan;
  if (!finalScan || !finalAnalysis.qrText) {
    return {
      ok: false,
      code: "FINAL_ANALYSIS_REJECTED",
      message: finalAnalysis.result.message || "The final still could not be verified. Retake the sheet.",
    };
  }
  const stability = verifyFinalCaptureStability(expected, {
    identity: finalAnalysis.qrText,
    geometry: finalScan.geometry,
    luminance: finalScan.frameBrightness,
    sharpness: finalScan.frameSharpness,
    sharpnessWidth: finalScan.frameWidth,
    observedAt: capturedAt,
  });
  if (!stability.ok) return stability;
  if (
    finalScan.learnerId !== previewConsensus.learnerId ||
    finalScan.version !== previewConsensus.version ||
    finalScan.totalItems !== previewConsensus.totalItems ||
    finalScan.detected.length !== previewConsensus.detected.length
  ) {
    return {
      ok: false,
      code: "FINAL_SCAN_SCOPE_CHANGED",
      message: "The final still no longer matches the previewed learner, version, or item count. Retake the sheet.",
    };
  }

  let evidenceDisagreed = false;
  const detected = finalScan.detected.map((reading, index) => {
    const preview = previewConsensus.detected[index];
    if (!preview || preview.item !== reading.item || !sameEvidence(preview, reading)) {
      evidenceDisagreed = true;
    }
    return preview ? conservativeReading(preview, reading) : reading;
  });
  const hasDoubt = detected.some(isDoubtful);
  const reviewCount = detected.filter(isDoubtful).length;
  const quality = evidenceDisagreed || hasDoubt
    ? {
        ...finalScan.quality,
        label: "Review" as const,
        disposition: "review" as const,
        autoEligible: false,
        reasonCodes: Array.from(
          new Set(
            finalScan.quality.reasonCodes.concat(
              evidenceDisagreed ? "FRAME_EVIDENCE_DISAGREEMENT" : "DOUBTFUL_MARKS",
            ),
          ),
        ),
        issues: Array.from(
          new Set(
            finalScan.quality.issues.concat(
              evidenceDisagreed
                ? "final still disagreed with stable preview evidence"
                : "stable preview contained uncertain evidence",
            ),
          ),
        ),
      }
    : finalScan.quality;

  return {
    ok: true,
    evidenceDisagreed,
    scan: {
      ...finalScan,
      detected,
      confidence: detected.length
        ? detected.reduce((sum, reading) => sum + reading.confidence, 0) / detected.length
        : 0,
      quality,
      hasDoubt,
      reviewCount,
      signature: scanSignature(finalScan.learnerId, finalScan.version, detected),
    },
  };
}
