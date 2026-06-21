// Phase 8 — scoring logic. Pure functions, no React, easy to test.

import type { Item, ItemScore, MasteryStatus, VersionKey } from "./types";
import {
  acceptedMatch,
  isManual,
  isObjective,
  normalizeText,
  usesAcceptedAnswers,
} from "./items";

// Teacher inputs collected during checking.
export interface CheckingInput {
  // itemId -> raw response (letter, T/F, or free text)
  responses: Record<string, string>;
  // itemId -> manually entered score (manual items)
  manualScores: Record<string, number>;
  // itemId -> override score for auto-scored items
  overrides: Record<string, number>;
  // itemId -> optional remarks
  remarks: Record<string, string>;
}

export function emptyInput(): CheckingInput {
  return { responses: {}, manualScores: {}, overrides: {}, remarks: {} };
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function masteryBand(percentage: number): MasteryStatus {
  if (percentage >= 85) return "Mastered";
  if (percentage >= 75) return "Nearly Mastered";
  if (percentage >= 60) return "Needs Improvement";
  return "Critical Intervention";
}

const MASTERY_COLORS: Record<MasteryStatus, string> = {
  Mastered: "#16a34a",
  "Nearly Mastered": "#0891b2",
  "Needs Improvement": "#d97706",
  "Critical Intervention": "#dc2626",
};

export function masteryColor(status: MasteryStatus): string {
  return MASTERY_COLORS[status];
}

// Accepted answers for a text item: explicit list plus optional correctAnswer.
function acceptedFor(item: Item): string[] {
  const list = item.acceptedAnswers.filter((s) => s.trim().length > 0);
  if (item.correctAnswer.trim()) list.push(item.correctAnswer);
  return list;
}

// Score a single item. `keyAnswer` is the per-version key for objective items.
export function scoreItem(
  item: Item,
  keyAnswer: string,
  input: CheckingInput,
): ItemScore {
  const response = (input.responses[item.id] ?? "").trim();
  const remarks = input.remarks[item.id] ?? "";
  const blank = response === "";

  // Manual items: teacher-entered score only.
  if (isManual(item.type)) {
    const manual = clamp(Number(input.manualScores[item.id] ?? 0), 0, item.points);
    return {
      itemId: item.id,
      itemNumber: item.itemNumber,
      type: item.type,
      points: item.points,
      awarded: manual,
      correct: false,
      blank,
      manual: true,
      overridden: false,
      remarks,
    };
  }

  // Decide correctness for auto-scored items.
  let correct = false;
  if (!blank) {
    if (isObjective(item.type)) {
      correct = keyAnswer.trim() !== "" && normalizeText(response) === normalizeText(keyAnswer);
    } else if (usesAcceptedAnswers(item.type)) {
      correct = acceptedMatch(response, acceptedFor(item));
    }
  }

  // Auto score, then apply an optional teacher override.
  const autoAwarded = correct ? item.points : 0;
  const hasOverride = Object.prototype.hasOwnProperty.call(input.overrides, item.id);
  const awarded = hasOverride
    ? clamp(Number(input.overrides[item.id]), 0, item.points)
    : autoAwarded;

  return {
    itemId: item.id,
    itemNumber: item.itemNumber,
    type: item.type,
    points: item.points,
    awarded,
    correct,
    blank,
    manual: false,
    overridden: hasOverride,
    remarks,
  };
}

export interface ScoreSummary {
  itemScores: ItemScore[];
  rawScore: number;
  totalScore: number;
  percentage: number;
  correctCount: number;
  incorrectCount: number;
  blankCount: number;
  masteryStatus: MasteryStatus;
}

export function computeScores(
  items: Item[],
  versionKey: VersionKey,
  input: CheckingInput,
): ScoreSummary {
  const itemScores = items
    .slice()
    .sort((a, b) => a.itemNumber - b.itemNumber)
    .map((item) => scoreItem(item, versionKey[item.id] ?? "", input));

  let rawScore = 0;
  let totalScore = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let blankCount = 0;

  itemScores.forEach((s) => {
    rawScore += s.awarded;
    totalScore += s.points;
    // Correct/incorrect/blank only meaningful for auto-scored items.
    if (!s.manual) {
      if (s.blank) blankCount += 1;
      else if (s.correct) correctCount += 1;
      else incorrectCount += 1;
    }
  });

  const percentage =
    totalScore > 0 ? Math.round((rawScore / totalScore) * 1000) / 10 : 0;

  return {
    itemScores,
    rawScore,
    totalScore,
    percentage,
    correctCount,
    incorrectCount,
    blankCount,
    masteryStatus: masteryBand(percentage),
  };
}
