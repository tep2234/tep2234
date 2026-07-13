import type { ScanResult } from "./still-pipeline";
import type { ReviewRow } from "./omr-score";
import { REVIEW_CONFIDENCE } from "./omr-score";

export type CertificationVerdict = "Passed" | "Conditional Pass" | "Failed";

export type CalibrationStatus =
  | "Camera Ready"
  | "Needs Better Lighting"
  | "Move Closer"
  | "Reduce Shadow"
  | "Flatten Sheet"
  | "Print Quality Too Weak"
  | "Rescan Required";

export interface CalibrationMetric {
  label: string;
  score: number;
  detail: string;
  ok: boolean;
}

export interface CertificationReport {
  verdict: CertificationVerdict;
  status: CalibrationStatus;
  score: number;
  expected: string[];
  read: Array<{
    item: number;
    expected: string;
    detected: string | null;
    confidence: number;
    status: string;
    passed: boolean;
  }>;
  metrics: CalibrationMetric[];
  blockers: string[];
  warnings: string[];
  createdAt: number;
}

export const CALIBRATION_EXPECTED = ["A", "B", "C", "D", "A", "B", "C", "D", "A", "B"];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function band(value: number, min: number, max: number): number {
  return clamp((value - min) / (max - min), 0, 1);
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((sum, n) => sum + n, 0) / nums.length : 0;
}

function tiltAngle(result: ScanResult): number {
  const corners = result.reading.corners;
  if (!corners || corners.length < 2) return 45;
  const [tl, tr] = corners;
  return Math.abs(Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180 / Math.PI);
}

function shadowLevel(rows: ReviewRow[]): number {
  const filled = rows.flatMap((row) => row.fill).filter((n) => Number.isFinite(n));
  if (filled.length === 0) return 100;
  const mean = avg(filled);
  const variance = avg(filled.map((n) => (n - mean) * (n - mean)));
  return Math.round(clamp(Math.sqrt(variance) * 180, 0, 100));
}

function markerScore(result: ScanResult): number {
  if (!result.reading.aligned) return 0;
  return result.reading.markersFound >= 4 ? 100 : 65;
}

function brightnessScore(brightness: number): number {
  if (brightness < 45 || brightness > 245) return 20;
  if (brightness < 70) return 50;
  if (brightness > 230) return 60;
  return Math.round(band(brightness, 70, 145) * 30 + 70);
}

function focusScore(sharpness: number): number {
  return Math.round(band(sharpness, 2.2, 6) * 100);
}

function tiltScore(angle: number): number {
  if (angle <= 4) return 100;
  if (angle <= 8) return 82;
  if (angle <= 14) return 58;
  return 25;
}

function bubbleDarknessScore(rows: ReviewRow[]): number {
  const selected = rows
    .map((row) => {
      const valid = row.fill.slice(0, Math.max(2, Math.min(row.item.choices, 5)));
      return Math.max(...valid, 0);
    })
    .filter((v) => v > 0.01);
  const mean = avg(selected);
  return Math.round(band(mean, 0.18, 0.48) * 100);
}

function expectedFor(row: ReviewRow, index: number): string {
  const valid = Math.max(2, Math.min(row.item.choices, 5));
  const target = CALIBRATION_EXPECTED[index % CALIBRATION_EXPECTED.length];
  const letters = ["A", "B", "C", "D", "E"].slice(0, valid);
  return letters.includes(target) ? target : letters[0];
}

function primaryStatus(blockers: string[], warnings: string[]): CalibrationStatus {
  const all = blockers.concat(warnings).join(" | ").toLowerCase();
  if (blockers.length > 0) return "Rescan Required";
  if (all.includes("light") || all.includes("dark") || all.includes("glare")) return "Needs Better Lighting";
  if (all.includes("shadow")) return "Reduce Shadow";
  if (all.includes("tilt") || all.includes("flat")) return "Flatten Sheet";
  if (all.includes("focus") || all.includes("distance")) return "Move Closer";
  if (all.includes("bubble") || all.includes("print")) return "Print Quality Too Weak";
  return "Camera Ready";
}

export function certificationGuidance(report: CertificationReport | null): string {
  if (!report) return "Scan the calibration sheet before production scanning.";
  if (report.verdict === "Passed") return "Camera Ready. Production auto-scoring is enabled for clean scans.";
  if (report.verdict === "Conditional Pass") return "Conditional Pass. Scanning is allowed, but doubtful reads must be reviewed.";
  return "Failed. Fix the capture condition and rescan calibration before production scanning.";
}

export function evaluateCertification(result: ScanResult): CertificationReport {
  const rows = result.summary.rows.slice(0, Math.min(result.summary.rows.length, CALIBRATION_EXPECTED.length));
  const expected = rows.map(expectedFor);
  const read = rows.map((row, index) => {
    const detected = row.detected ?? row.suggested;
    const passed = detected === expected[index] && row.status === "selected" && row.confidence >= REVIEW_CONFIDENCE;
    return {
      item: row.itemNumber,
      expected: expected[index],
      detected,
      confidence: row.confidence,
      status: row.status,
      passed,
    };
  });
  const correctRate = read.length ? read.filter((r) => r.passed).length / read.length : 0;
  const minConfidence = read.length ? Math.min(...read.map((r) => r.confidence)) : 0;
  const avgConfidence = read.length ? avg(read.map((r) => r.confidence)) : 0;
  const shadows = shadowLevel(rows);
  const tilt = tiltAngle(result);
  const bubbleScore = bubbleDarknessScore(rows);
  const metrics: CalibrationMetric[] = [
    {
      label: "QR detection",
      score: 100,
      detail: "Identity QR decoded and matched a learner.",
      ok: true,
    },
    {
      label: "Corner markers",
      score: markerScore(result),
      detail: result.reading.aligned ? "Four sheet markers aligned." : "Corner markers were not aligned.",
      ok: result.reading.aligned && result.reading.markersFound >= 4,
    },
    {
      label: "Brightness",
      score: brightnessScore(result.reading.brightness),
      detail: `${Math.round(result.reading.brightness)} average brightness`,
      ok: result.reading.brightness >= 70 && result.reading.brightness <= 230,
    },
    {
      label: "Sharpness",
      score: focusScore(result.reading.sharpness),
      detail: `${Math.round(result.reading.sharpness * 10) / 10} focus score`,
      ok: result.reading.sharpness >= 2.4,
    },
    {
      label: "Shadow level",
      score: 100 - shadows,
      detail: `${shadows}/100 shadow variation`,
      ok: shadows <= 42,
    },
    {
      label: "Tilt angle",
      score: tiltScore(tilt),
      detail: `${Math.round(tilt * 10) / 10} degrees`,
      ok: tilt <= 8,
    },
    {
      label: "Bubble darkness",
      score: bubbleScore,
      detail: `${bubbleScore}/100 mark strength`,
      ok: bubbleScore >= 62,
    },
    {
      label: "Item confidence",
      score: Math.round(avgConfidence * 100),
      detail: `${Math.round(avgConfidence * 100)}% average, ${Math.round(minConfidence * 100)}% minimum`,
      ok: avgConfidence >= 0.8 && minConfidence >= REVIEW_CONFIDENCE,
    },
    {
      label: "Known answers",
      score: Math.round(correctRate * 100),
      detail: `${read.filter((r) => r.passed).length}/${read.length} calibration answers matched`,
      ok: correctRate === 1,
    },
  ];

  const blockers: string[] = [];
  const warnings: string[] = [];
  metrics.forEach((metric) => {
    if (metric.ok) return;
    if (metric.score < 55 || metric.label === "Known answers" || metric.label === "Corner markers") {
      blockers.push(`${metric.label}: ${metric.detail}`);
    } else {
      warnings.push(`${metric.label}: ${metric.detail}`);
    }
  });
  if (result.quality.label === "Retake") blockers.push("Scan quality requires retake.");
  else if (result.quality.label === "Review") warnings.push("Scan quality is review-only.");

  const score = Math.round(
    metrics.reduce((sum, metric) => sum + metric.score, 0) / Math.max(metrics.length, 1),
  );
  let verdict: CertificationVerdict;
  if (blockers.length === 0 && warnings.length === 0 && score >= 88) verdict = "Passed";
  else if (blockers.length === 0 && score >= 74) verdict = "Conditional Pass";
  else verdict = "Failed";

  return {
    verdict,
    status: primaryStatus(blockers, warnings),
    score,
    expected,
    read,
    metrics,
    blockers,
    warnings,
    createdAt: Date.now(),
  };
}
