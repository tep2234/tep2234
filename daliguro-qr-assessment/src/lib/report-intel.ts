// Reports & Assessment Intelligence — pure aggregations for the executive
// dashboard (scoped to the active assessment). Built on analysis.ts / insights.ts
// so there is ONE source of truth for scoring and item analysis. No React here.

import type { Item, Result } from "./types";
import { analyzeItems } from "./analysis";
import { discriminationIndex } from "./insights";
import { hasUnresolvedScanEvidence, isTrustedResult } from "./result-trust";

// ---- Mastery bands (dashboard: 90 / 75 / 50) ----------------
export type IntelMastery = "Mastered" | "Approaching Mastery" | "Developing" | "Beginning";

export function intelMastery(pct: number): IntelMastery {
  if (pct >= 90) return "Mastered";
  if (pct >= 75) return "Approaching Mastery";
  if (pct >= 50) return "Developing";
  return "Beginning";
}

export const INTEL_MASTERY_COLOR: Record<IntelMastery, string> = {
  Mastered: "#16a34a",
  "Approaching Mastery": "#4f46e5",
  Developing: "#d97706",
  Beginning: "#dc2626",
};

// ---- MPS performance level ----------------------------------
export type PerfLevel = "Outstanding" | "Very Satisfactory" | "Satisfactory" | "Fair" | "Poor";

export function perfLevel(mps: number): PerfLevel {
  if (mps >= 90) return "Outstanding";
  if (mps >= 75) return "Very Satisfactory";
  if (mps >= 50) return "Satisfactory";
  if (mps >= 25) return "Fair";
  return "Poor";
}

export const PERF_COLOR: Record<PerfLevel, string> = {
  Outstanding: "#16a34a",
  "Very Satisfactory": "#0891b2",
  Satisfactory: "#4f46e5",
  Fair: "#d97706",
  Poor: "#dc2626",
};

// ---- Score distribution across % ranges ---------------------
export interface DistBucket { label: string; lo: number; hi: number; count: number; }

export function scoreDistribution(results: Result[]): DistBucket[] {
  const buckets: DistBucket[] = [
    { label: "0–19", lo: 0, hi: 19, count: 0 },
    { label: "20–39", lo: 20, hi: 39, count: 0 },
    { label: "40–59", lo: 40, hi: 59, count: 0 },
    { label: "60–79", lo: 60, hi: 79, count: 0 },
    { label: "80–100", lo: 80, hi: 100, count: 0 },
  ];
  results.forEach((r) => {
    const b = buckets.find((x) => r.percentage >= x.lo && r.percentage <= x.hi);
    if (b) b.count += 1;
  });
  return buckets;
}

// ---- Item difficulty (P-value) ------------------------------
// P-value = correct responses / valid attempts. DepEd-style buckets.
export type Difficulty3 = "Easy" | "Moderate" | "Difficult";

export function difficulty3(pValue: number): Difficulty3 {
  if (pValue >= 0.7) return "Easy";
  if (pValue >= 0.3) return "Moderate";
  return "Difficult";
}

export interface DifficultySummary { easy: number; moderate: number; difficult: number; }

export function difficultySummary(items: Item[], results: Result[]): DifficultySummary {
  const rows = analyzeItems(items, results);
  const s: DifficultySummary = { easy: 0, moderate: 0, difficult: 0 };
  rows.forEach((r) => {
    const attempts = r.attempts;
    const p = attempts > 0 ? r.correct / attempts : 0;
    const d = difficulty3(p);
    if (d === "Easy") s.easy += 1;
    else if (d === "Moderate") s.moderate += 1;
    else s.difficult += 1;
  });
  return s;
}

// ---- Discrimination index buckets ---------------------------
// High >= 0.30, Moderate 0.20–0.29, Low < 0.20. A null index (too few takers to
// compute) is counted as Low/undetermined so the totals always add up.
export interface DiscriminationSummary { high: number; moderate: number; low: number; }

export function discriminationSummary(items: Item[], results: Result[]): DiscriminationSummary {
  const s: DiscriminationSummary = { high: 0, moderate: 0, low: 0 };
  items.forEach((it) => {
    const d = discriminationIndex(it.id, results);
    if (d === null) { s.low += 1; return; }
    if (d >= 0.3) s.high += 1;
    else if (d >= 0.2) s.moderate += 1;
    else s.low += 1;
  });
  return s;
}

// ---- Scan reliability metrics -------------------------------
export interface Reliability {
  totalScanned: number;
  scanResults: number;   // results that came from a scan (vs. manual)
  finalized: number;     // locked results
  needsReview: number;   // saved but need confirmation
  autoFinalizedPct: number; // clean (not needs_review) / total, as %
  scanAccuracy: number;  // avg scanConfidence over scan results, as %
  reviewAdjusted: number; // scans a teacher reviewed/corrected
  resultsLost: number;   // always 0 — every scan produces a saved state
}

export function reliability(results: Result[]): Reliability {
  const scans = results.filter((r) => r.source === "scan");
  const conf = scans.filter((r) => r.scanConfidence != null);
  const scanAccuracy = conf.length
    ? Math.round((conf.reduce((s, r) => s + (r.scanConfidence ?? 0), 0) / conf.length) * 1000) / 10
    : 0;
  const needsReview = results.filter((r) => r.reviewStatus === "needs_review").length;
  const finalized = results.filter((r) => r.finalizedAt != null && isTrustedResult(r)).length;
  const reviewAdjusted = scans.filter((r) => r.reviewStatus === "reviewed").length;
  const cleanAccepted = results.filter(isTrustedResult).length;
  const autoFinalizedPct = results.length ? Math.round((cleanAccepted / results.length) * 1000) / 10 : 0;
  return {
    totalScanned: results.length,
    scanResults: scans.length,
    finalized,
    needsReview,
    autoFinalizedPct,
    scanAccuracy,
    reviewAdjusted,
    resultsLost: 0,
  };
}

// ---- Per-learner verification status ------------------------
export type Verification = "Verified" | "Needs Review" | "Adjusted" | "Pending";

export function verificationOf(r: Result): Verification {
  if (r.finalizedAt != null && isTrustedResult(r)) return "Verified";
  if (r.reviewStatus === "needs_review" || hasUnresolvedScanEvidence(r)) return "Needs Review";
  if (r.reviewStatus === "reviewed") return "Adjusted";
  return "Pending";
}

export const VERIFICATION_COLOR: Record<Verification, string> = {
  Verified: "#16a34a",
  "Needs Review": "#d97706",
  Adjusted: "#0891b2",
  Pending: "#64748b",
};
