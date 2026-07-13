// SmartScan quality scoring. This does not decide the academic score; it rates
// whether the camera capture is trustworthy enough for auto-accept vs. review.

import {
  evaluateQualityGates,
  type CaptureQualityReasonCode,
  type QualityDisposition,
} from "./quality-gates";

export type ScanQualityLabel = "Excellent" | "Good" | "Review" | "Retake";

export interface ScanQuality {
  score: number; // 0..100
  label: ScanQualityLabel;
  issues: string[];
  // Structured safety decision. Consumers must use autoEligible for automatic
  // acceptance; score is presentation-only and cannot override hard blockers.
  disposition: QualityDisposition;
  autoEligible: boolean;
  reasonCodes: CaptureQualityReasonCode[];
  hardBlockers: CaptureQualityReasonCode[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function band(value: number, min: number, max: number): number {
  return clamp((value - min) / (max - min), 0, 1);
}

export function scanQuality(args: {
  confidence: number;
  brightness: number;
  sharpness: number;
  aligned: boolean;
  doubtfulItems: number;
  shadowLevel?: number;
  tiltAngle?: number;
  bubbleDarkness?: number;
  glareLevel?: number;
  obscuredBubbleCount?: number;
}): ScanQuality {
  const confidence = clamp(args.confidence, 0, 1);
  const light = band(args.brightness, 55, 145);
  const focus = band(args.sharpness, 1.6, 5.5);
  const alignment = args.aligned ? 1 : 0;
  const doubtPenalty = clamp(args.doubtfulItems / 4, 0, 1);
  const shadow = args.shadowLevel == null ? 1 : 1 - clamp(args.shadowLevel / 100, 0, 1);
  const tilt = args.tiltAngle == null ? 1 : 1 - clamp(Math.max(0, args.tiltAngle - 4) / 16, 0, 1);
  const print = args.bubbleDarkness == null ? 1 : band(args.bubbleDarkness, 0.18, 0.46);
  const raw =
    confidence * 38 +
    light * 12 +
    focus * 15 +
    alignment * 12 +
    shadow * 8 +
    tilt * 7 +
    print * 4 +
    (1 - doubtPenalty) * 4;
  const gates = evaluateQualityGates({
    aligned: args.aligned,
    brightness: args.brightness,
    sharpness: args.sharpness,
    shadowLevel: args.shadowLevel,
    tiltAngle: args.tiltAngle,
    bubbleDarkness: args.bubbleDarkness,
    glareLevel: args.glareLevel,
    obscuredBubbleCount: args.obscuredBubbleCount,
    confidence,
    doubtfulItems: args.doubtfulItems,
  });
  // Keep a useful relative presentation score, but cap unsafe results below
  // the historic automatic thresholds as defense in depth for older callers.
  let score = Math.round(clamp(raw, 0, 100));
  if (gates.disposition === "retake") score = Math.min(score, 54);
  const issues = gates.reasons.map((reason) => reason.issue);

  let label: ScanQualityLabel;
  if (gates.disposition === "retake") label = "Retake";
  else if (gates.disposition === "review") label = "Review";
  else if (score >= 88) label = "Excellent";
  else label = "Good";
  return {
    score,
    label,
    issues,
    disposition: gates.disposition,
    autoEligible: gates.autoEligible,
    reasonCodes: gates.reasonCodes,
    hardBlockers: gates.hardBlockers,
  };
}
