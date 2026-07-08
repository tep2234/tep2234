// SmartScan quality scoring. This does not decide the academic score; it rates
// whether the camera capture is trustworthy enough for auto-accept vs. review.

export type ScanQualityLabel = "Excellent" | "Good" | "Review" | "Retake";

export interface ScanQuality {
  score: number; // 0..100
  label: ScanQualityLabel;
  issues: string[];
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
  const score = Math.round(clamp(raw, 0, 100));
  const issues: string[] = [];
  if (!args.aligned) issues.push("corner targets not aligned");
  if (args.brightness < 70) issues.push("low light");
  if (args.brightness > 230) issues.push("possible glare");
  if (args.sharpness < 2.4) issues.push("soft focus");
  if ((args.shadowLevel ?? 0) > 42) issues.push("uneven shadow");
  if ((args.tiltAngle ?? 0) > 8) issues.push("sheet tilted");
  if (args.bubbleDarkness != null && args.bubbleDarkness < 0.18) issues.push("print or mark contrast too weak");
  if (confidence < 0.75) issues.push("weak bubble confidence");
  if (args.doubtfulItems > 0) issues.push(`${args.doubtfulItems} doubtful mark${args.doubtfulItems === 1 ? "" : "s"}`);

  let label: ScanQualityLabel;
  if (score >= 88 && issues.length === 0) label = "Excellent";
  else if (score >= 74 && args.doubtfulItems === 0) label = "Good";
  else if (score >= 55 || (args.aligned && confidence >= 0.55)) label = "Review";
  else label = "Retake";
  return { score, label, issues };
}
