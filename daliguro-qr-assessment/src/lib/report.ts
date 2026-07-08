// Smart Item Analysis Report — pure computations for the professional,
// DepEd-style assessment report. Built on top of analysis.ts / insights.ts;
// adds the "number of takers" framing, DepEd mastery labels, frequency-of-error
// bands, per-item remarks + recommended action, competency roll-ups, and the
// learner remediation list. No React here.

import type {
  Assessment,
  Item,
  Learner,
  MasteryStatus,
  Result,
} from "./types";
import { masteryBand } from "./scoring";
import {
  analyzeItems,
  commonWrongAnswers,
  type ItemAnalysisRow,
} from "./analysis";
import {
  attentionFor,
  classStats,
  discriminationIndex,
  itemQualityFlags,
  PASSING_PERCENT,
} from "./insights";

// ---- DepEd mastery labels ----------------------------------
// Maps the app's mastery bands to the labels teachers see on official item
// analysis reports. Same 80/60/40 cutoffs, familiar wording.

export type DepEdMastery = "Mastered" | "Nearly Mastered" | "Least Mastered" | "Not Mastered";

const DEPED_LABEL: Record<MasteryStatus, DepEdMastery> = {
  Mastered: "Mastered",
  "Near Mastery": "Nearly Mastered",
  "Needs Reinforcement": "Least Mastered",
  "Critical Support": "Not Mastered",
};

export const DEPED_MASTERY_ORDER: DepEdMastery[] = [
  "Mastered",
  "Nearly Mastered",
  "Least Mastered",
  "Not Mastered",
];

// Green / Blue / Orange / Red — with a grayscale-safe hatch id for B/W print.
export const DEPED_COLOR: Record<DepEdMastery, string> = {
  Mastered: "#16a34a",
  "Nearly Mastered": "#0891b2",
  "Least Mastered": "#d97706",
  "Not Mastered": "#dc2626",
};

export function depedMasteryLabel(pct: number): DepEdMastery {
  return DEPED_LABEL[masteryBand(pct)];
}

// Light background tints for the color-coded mastery roster (print-safe pastels).
export const DEPED_TINT: Record<DepEdMastery, string> = {
  Mastered: "#dcfce7",
  "Nearly Mastered": "#cffafe",
  "Least Mastered": "#fef3c7",
  "Not Mastered": "#fee2e2",
};

// DepEd Mean Percentage Score mastery target.
export const MPS_TARGET = 75;

// One-line interpretation of an MPS value against the 75% mastery target.
export function mpsInterpretation(mps: number): string {
  if (mps >= 90) return "Outstanding — the class has mastered the competencies.";
  if (mps >= MPS_TARGET) return `Proficient — meets the DepEd ${MPS_TARGET}% mastery target.`;
  if (mps >= 50) return `Approaching — below the ${MPS_TARGET}% target; targeted remediation needed.`;
  return "Needs intensive reteaching before moving to the next competency.";
}

// ---- Frequency-of-error bands ------------------------------

export type ErrorBand = "No Error" | "Minimal Error" | "Moderate Error" | "High Error" | "Critical Error";

export const ERROR_BAND_ORDER: ErrorBand[] = [
  "No Error",
  "Minimal Error",
  "Moderate Error",
  "High Error",
  "Critical Error",
];

export function errorBand(freqOfError: number): ErrorBand {
  if (freqOfError <= 0) return "No Error";
  if (freqOfError <= 25) return "Minimal Error";
  if (freqOfError <= 50) return "Moderate Error";
  if (freqOfError <= 75) return "High Error";
  return "Critical Error";
}

// ---- Report metadata (teacher-entered header fields) -------

export interface ReportMeta {
  schoolName: string;
  department: string;
  schoolYear: string;
  quarter: string;
  typeOfTest: string;
  dateAdministered: string;
  dateChecked: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
}

export function emptyReportMeta(a: Assessment): ReportMeta {
  return {
    schoolName: "",
    department: "",
    schoolYear: a.schoolYear,
    quarter: a.term + " Quarter",
    typeOfTest: a.component,
    dateAdministered: "",
    dateChecked: "",
    preparedBy: a.teacherName,
    reviewedBy: "",
    approvedBy: "",
  };
}

// ---- Per-item report rows ----------------------------------

export interface ReportItemRow {
  itemNumber: number;
  competency: string;
  correct: number;
  errors: number;
  takers: number;
  percentCorrect: number;
  freqOfError: number;
  mastery: DepEdMastery;
  difficulty: ItemAnalysisRow["difficulty"];
  mostWrong: string; // most-chosen wrong response ("" if none)
  errorRemark: ErrorBand;
  recommendedAction: string;
  qualityFlags: string[];
}

function actionFor(mastery: DepEdMastery, band: ErrorBand): string {
  if (mastery === "Mastered") return "Maintain; use for enrichment.";
  if (mastery === "Nearly Mastered") return "Brief review of the missed points.";
  if (mastery === "Least Mastered") return "Guided remediation with worked examples.";
  return band === "Critical Error"
    ? "Reteach the concept; check the item for key/wording issues."
    : "Reteach with step-by-step guidance and a follow-up check.";
}

// Number of takers = learners with a saved result for this assessment.
export function reportItems(
  items: Item[],
  results: Result[],
): ReportItemRow[] {
  const takers = results.length;
  const rows = analyzeItems(items, results);
  const wrong = commonWrongAnswers(items, results);
  return rows.map((r) => {
    const attempts = r.attempts || takers;
    const correct = r.correct;
    const errors = Math.max(0, attempts - correct - r.blank) + r.blank; // wrong + blank
    const pct = attempts > 0 ? Math.round((correct / attempts) * 1000) / 10 : 0;
    const freq = attempts > 0 ? Math.round(((attempts - correct) / attempts) * 1000) / 10 : 0;
    const band = errorBand(freq);
    const mastery = depedMasteryLabel(pct);
    const disc = discriminationIndex(r.item.id, results);
    return {
      itemNumber: r.item.itemNumber,
      competency: r.competency,
      correct,
      errors,
      takers: attempts,
      percentCorrect: pct,
      freqOfError: freq,
      mastery,
      difficulty: r.difficulty,
      mostWrong: wrong.get(r.item.id)?.[0]?.response ?? "",
      errorRemark: band,
      recommendedAction: actionFor(mastery, band),
      qualityFlags: itemQualityFlags(r, disc, wrong.get(r.item.id)),
    };
  });
}

// ---- Competency roll-up ------------------------------------

export interface ReportCompetencyRow {
  competency: string;
  items: number[];
  avgPercentCorrect: number;
  mastery: DepEdMastery;
  errorRate: number;
  affectedLearners: number; // learners below the passing threshold on this competency
  recommendedAction: string;
}

export function reportCompetencies(
  items: Item[],
  results: Result[],
): ReportCompetencyRow[] {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const groups = new Map<string, { itemNums: Set<number>; possible: number; earned: number }>();
  results.forEach((r) => {
    r.itemScores.forEach((s) => {
      const item = itemsById.get(s.itemId);
      if (!item) return;
      const comp = item.competency.trim() || "Untagged Competency";
      const g = groups.get(comp) ?? { itemNums: new Set(), possible: 0, earned: 0 };
      g.itemNums.add(item.itemNumber);
      g.possible += s.points;
      g.earned += s.awarded;
      groups.set(comp, g);
    });
  });

  // Per-learner weak-competency count (below passing on that competency).
  const affected = new Map<string, number>();
  results.forEach((r) => {
    const per = new Map<string, { possible: number; earned: number }>();
    r.itemScores.forEach((s) => {
      const item = itemsById.get(s.itemId);
      if (!item) return;
      const comp = item.competency.trim() || "Untagged Competency";
      const g = per.get(comp) ?? { possible: 0, earned: 0 };
      g.possible += s.points;
      g.earned += s.awarded;
      per.set(comp, g);
    });
    per.forEach((g, comp) => {
      const pct = g.possible > 0 ? (g.earned / g.possible) * 100 : 0;
      if (pct < PASSING_PERCENT) affected.set(comp, (affected.get(comp) ?? 0) + 1);
    });
  });

  return [...groups.entries()]
    .map(([competency, g]) => {
      const pct = g.possible > 0 ? Math.round((g.earned / g.possible) * 1000) / 10 : 0;
      const mastery = depedMasteryLabel(pct);
      return {
        competency,
        items: [...g.itemNums].sort((a, b) => a - b),
        avgPercentCorrect: pct,
        mastery,
        errorRate: Math.round((100 - pct) * 10) / 10,
        affectedLearners: affected.get(competency) ?? 0,
        recommendedAction:
          mastery === "Mastered" || mastery === "Nearly Mastered"
            ? "Proceed; light reinforcement as needed."
            : "Reteach with guided examples and a short practice quiz.",
      };
    })
    .sort((a, b) => a.avgPercentCorrect - b.avgPercentCorrect);
}

// ---- Learner remediation list ------------------------------

export interface ReportLearnerRow {
  name: string;
  lrn: string;
  score: string; // raw/total
  percentage: number;
  mastery: DepEdMastery;
  weakCompetencies: string[];
  missedItems: number[];
  attentionFlag: string;
  intervention: string;
}

export function reportLearners(
  items: Item[],
  results: Result[],
  learners: Learner[],
): ReportLearnerRow[] {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const byId = new Map(learners.map((l) => [l.id, l]));
  const numberOf = new Map(items.map((i) => [i.id, i.itemNumber]));

  return results
    .map((r) => {
      const l = byId.get(r.learnerId);
      const weak: string[] = [];
      const per = new Map<string, { possible: number; earned: number }>();
      r.itemScores.forEach((s) => {
        const item = itemsById.get(s.itemId);
        if (!item) return;
        const comp = item.competency.trim() || "Untagged Competency";
        const g = per.get(comp) ?? { possible: 0, earned: 0 };
        g.possible += s.points;
        g.earned += s.awarded;
        per.set(comp, g);
      });
      per.forEach((g, comp) => {
        if (g.possible > 0 && (g.earned / g.possible) * 100 < PASSING_PERCENT) weak.push(comp);
      });
      const missed = r.itemScores
        .filter((s) => !s.manual && !s.correct)
        .map((s) => numberOf.get(s.itemId) ?? s.itemNumber)
        .sort((a, b) => a - b);
      const mastery = depedMasteryLabel(r.percentage);
      return {
        name: l ? l.fullName : "(unknown learner)",
        lrn: l ? l.lrn : "",
        score: r.rawScore + "/" + r.totalScore,
        percentage: r.percentage,
        mastery,
        weakCompetencies: weak,
        missedItems: missed,
        attentionFlag: attentionFor(r, itemsById).flag,
        intervention:
          mastery === "Not Mastered"
            ? "Guided remediation + follow-up quiz."
            : mastery === "Least Mastered"
              ? "Targeted practice on weak competencies."
              : mastery === "Nearly Mastered"
                ? "Short review of missed items."
                : "Enrichment / peer tutoring.",
      };
    })
    .sort((a, b) => a.percentage - b.percentage);
}

// ---- Report-level summary ----------------------------------

export interface ReportSummary {
  totalLearners: number;
  takers: number;
  absent: number;
  average: number;
  highest: number;
  lowest: number;
  passingRate: number;
  overallMastery: number; // earned/possible across all results
  overallMasteryLabel: DepEdMastery;
  masteryCounts: Record<DepEdMastery, number>;
  errorCounts: Record<ErrorBand, number>;
  mostMissedItem: number | null;
  weakestCompetency: string | null;
  forRemediation: number; // learners below passing
  numItems: number;
}

export function reportSummary(
  items: Item[],
  results: Result[],
  totalLearners: number,
): ReportSummary {
  const stats = classStats(results);
  let possible = 0;
  let earned = 0;
  results.forEach((r) => {
    possible += r.totalScore;
    earned += r.rawScore;
  });
  const overall = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : 0;

  const masteryCounts: Record<DepEdMastery, number> = {
    Mastered: 0,
    "Nearly Mastered": 0,
    "Least Mastered": 0,
    "Not Mastered": 0,
  };
  results.forEach((r) => {
    masteryCounts[depedMasteryLabel(r.percentage)] += 1;
  });

  const itemRows = reportItems(items, results);
  const errorCounts: Record<ErrorBand, number> = {
    "No Error": 0,
    "Minimal Error": 0,
    "Moderate Error": 0,
    "High Error": 0,
    "Critical Error": 0,
  };
  itemRows.forEach((r) => {
    errorCounts[r.errorRemark] += 1;
  });

  const mostMissed = itemRows.length
    ? [...itemRows].sort((a, b) => a.percentCorrect - b.percentCorrect)[0]
    : null;
  const comps = reportCompetencies(items, results);
  const weakest = comps.length ? comps[0] : null;

  return {
    totalLearners,
    takers: results.length,
    absent: Math.max(0, totalLearners - results.length),
    average: stats.average,
    highest: stats.highest,
    lowest: stats.lowest,
    passingRate: stats.passingRate,
    overallMastery: overall,
    overallMasteryLabel: depedMasteryLabel(overall),
    masteryCounts,
    errorCounts,
    mostMissedItem: mostMissed ? mostMissed.itemNumber : null,
    weakestCompetency: weakest ? weakest.competency : null,
    forRemediation: results.filter((r) => r.percentage < PASSING_PERCENT).length,
    numItems: items.length,
  };
}
