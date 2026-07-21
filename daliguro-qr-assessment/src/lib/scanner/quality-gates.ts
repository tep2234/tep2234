// Safety policy for scanner capture quality. Critical image defects are
// independent hard gates: a high weighted score or high bubble confidence can
// never cancel one of these failures.

export type CaptureQualityReasonCode =
  | "SHEET_NOT_ALIGNED"
  | "IMAGE_TOO_DARK"
  | "IMAGE_OVEREXPOSED"
  | "GLARE_DETECTED"
  | "IMAGE_TOO_BLURRY"
  | "UNEVEN_LIGHTING"
  | "EXCESSIVE_TILT"
  | "WEAK_PRINT_CONTRAST"
  | "BUBBLE_REGION_UNREADABLE"
  | "LOW_BUBBLE_CONFIDENCE"
  | "DOUBTFUL_MARKS"
  | "FRAME_EVIDENCE_DISAGREEMENT";

export type QualityDisposition = "accept" | "review" | "retake";
export type QualityGateSeverity = "review" | "retake";

export interface QualityGateInput {
  aligned: boolean;
  brightness: number;
  sharpness: number;
  shadowLevel?: number;
  tiltAngle?: number;
  bubbleDarkness?: number;
  glareLevel?: number;
  obscuredBubbleCount?: number;
  confidence?: number;
  doubtfulItems?: number;
}

export interface QualityGateReason {
  code: CaptureQualityReasonCode;
  severity: QualityGateSeverity;
  issue: string;
  guidance: string;
}

export interface QualityGateResult {
  disposition: QualityDisposition;
  autoEligible: boolean;
  reasons: QualityGateReason[];
  reasonCodes: CaptureQualityReasonCode[];
  hardBlockers: CaptureQualityReasonCode[];
}

// Conservative Phase 1 thresholds. They intentionally remain centralized so
// future device certification can version/calibrate them without scattering
// policy across camera UIs.
export const QUALITY_GATE_THRESHOLDS = {
  minimumBrightness: 70,
  maximumBrightness: 245,
  maximumGlareLevel: 8,
  minimumSharpness: 2.4,
  maximumShadowLevel: 42,
  maximumTiltAngle: 8,
  minimumPrintContrast: 0.18,
  minimumConfidence: 0.75,
} as const;

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function retake(
  code: CaptureQualityReasonCode,
  issue: string,
  guidance: string,
): QualityGateReason {
  return { code, severity: "retake", issue, guidance };
}

function review(
  code: CaptureQualityReasonCode,
  issue: string,
  guidance: string,
): QualityGateReason {
  return { code, severity: "review", issue, guidance };
}

export function evaluateQualityGates(input: QualityGateInput): QualityGateResult {
  const t = QUALITY_GATE_THRESHOLDS;
  const reasons: QualityGateReason[] = [];

  if (!input.aligned) {
    reasons.push(retake("SHEET_NOT_ALIGNED", "corner targets not aligned", "Show the whole flat sheet with all four corner targets visible."));
  }
  if (!Number.isFinite(input.brightness) || input.brightness < t.minimumBrightness) {
    reasons.push(retake("IMAGE_TOO_DARK", "low light", "Use brighter, even light and retake the photo."));
  } else if (input.brightness > t.maximumBrightness) {
    reasons.push(retake("IMAGE_OVEREXPOSED", "possible glare", "Reduce glare or flash, change the camera angle, and retake."));
  }
  if (finite(input.glareLevel) && input.glareLevel > t.maximumGlareLevel) {
    reasons.push(retake("GLARE_DETECTED", "glare over answer area", "Move away from reflected light or disable the torch, then retake."));
  }
  if (!Number.isFinite(input.sharpness) || input.sharpness < t.minimumSharpness) {
    reasons.push(retake("IMAGE_TOO_BLURRY", "soft focus", "Hold the phone steady, let it focus, and retake."));
  }
  if (finite(input.shadowLevel) && input.shadowLevel > t.maximumShadowLevel) {
    reasons.push(retake("UNEVEN_LIGHTING", "uneven shadow", "Reposition the sheet or light so the answer area is evenly lit."));
  }
  if (finite(input.tiltAngle) && input.tiltAngle > t.maximumTiltAngle) {
    reasons.push(retake("EXCESSIVE_TILT", "sheet tilted", "Place the sheet flat and hold the camera parallel to it."));
  }
  if (finite(input.bubbleDarkness) && input.bubbleDarkness < t.minimumPrintContrast) {
    reasons.push(retake("WEAK_PRINT_CONTRAST", "print or mark contrast too weak", "Move closer, improve focus and lighting, or reprint the sheet."));
  }
  if (finite(input.obscuredBubbleCount) && input.obscuredBubbleCount > 0) {
    reasons.push(
      review(
        "BUBBLE_REGION_UNREADABLE",
        `${input.obscuredBubbleCount} bubble region${input.obscuredBubbleCount === 1 ? " is" : "s are"} unreadable`,
        "One or more answer choices cannot be verified. Rescan, or explicitly resolve every affected item in teacher review before scoring.",
      ),
    );
  }
  if (finite(input.confidence) && input.confidence < t.minimumConfidence) {
    reasons.push(review("LOW_BUBBLE_CONFIDENCE", "weak bubble confidence", "Confirm the low-confidence answers before saving."));
  }
  if (finite(input.doubtfulItems) && input.doubtfulItems > 0) {
    reasons.push(
      review(
        "DOUBTFUL_MARKS",
        `${input.doubtfulItems} doubtful mark${input.doubtfulItems === 1 ? "" : "s"}`,
        "Confirm every unreadable, ambiguous, multiple, or low-confidence mark before saving.",
      ),
    );
  }

  const hardBlockers = reasons.filter((reason) => reason.severity === "retake").map((reason) => reason.code);
  const disposition: QualityDisposition = hardBlockers.length > 0 ? "retake" : reasons.length > 0 ? "review" : "accept";
  return {
    disposition,
    autoEligible: disposition === "accept",
    reasons,
    reasonCodes: reasons.map((reason) => reason.code),
    hardBlockers,
  };
}

export function primaryQualityGuidance(result: QualityGateResult): string {
  return result.reasons[0]?.guidance ?? "Capture quality passed.";
}
