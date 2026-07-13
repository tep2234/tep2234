// Turn OMR readings (+ teacher corrections) into a reviewable, scored result.
// Reuses computeScores so OMR scoring is identical to manual checking.

import type { Item, MasteryStatus, VersionKey } from "../types";
import { computeScores, emptyInput, masteryBand } from "../scoring";
import type { ItemReading, ItemStatus } from "./omr-detect";

export const REVIEW_CONFIDENCE = 0.72;
export const BLANK_REVIEW_CONFIDENCE = 0.55;
export type ReviewDecisions = Record<number, string>;

export interface ReviewRow {
  item: Item;
  itemNumber: number;
  detected: string | null; // effective letter after corrections ("" -> blank)
  suggested: string | null; // raw scanner suggestion, even when unresolved
  status: ItemStatus;
  resolved: boolean; // teacher corrected this row
  needsReview: boolean;
  confidence: number;
  fill: number[];
  unreadableChoices: number[];
  correctAnswer: string;
  isCorrect: boolean;
  points: number;
  awarded: number;
}

export interface ReviewSummary {
  rows: ReviewRow[];
  rawScore: number;
  totalScore: number;
  percentage: number;
  masteryStatus: MasteryStatus;
  correctCount: number;
  wrongCount: number;
  blankCount: number;
  unclearCount: number;
  multipleCount: number;
  unreadableCount: number;
  lowConfidenceCount: number;
  unresolvedCount: number;
  // True while any visual row is still unresolved — blocks save.
  needsReview: boolean;
}

// `items` must be the OMR items in itemNumber order; reading.item is 1..N and
// lines up with that order. `corrections` maps itemNumber -> letter ("" = blank).
export function buildReview(
  items: Item[],
  versionKey: VersionKey,
  readings: ItemReading[],
  corrections: ReviewDecisions = {},
): ReviewSummary {
  const ordered = [...items].sort((a, b) => a.itemNumber - b.itemNumber);
  const readingByNumber = new Map(readings.map((r) => [r.item, r]));

  // Effective response per item id, for the shared scorer.
  const responses: Record<string, string> = {};
  ordered.forEach((item, idx) => {
    const reading = readingByNumber.get(idx + 1);
    const corrected = corrections[idx + 1];
    let letter = "";
    if (corrected !== undefined) {
      letter = corrected;
    } else if (
      reading &&
      reading.status === "selected" &&
      reading.confidence >= REVIEW_CONFIDENCE &&
      reading.detected
    ) {
      letter = reading.detected;
    }
    responses[item.id] = letter;
  });

  const input = { ...emptyInput(), responses };
  const summary = computeScores(ordered, versionKey, input);
  const scoreByItem = new Map(summary.itemScores.map((s) => [s.itemId, s]));

  let correctCount = 0;
  let wrongCount = 0;
  let blankCount = 0;
  let unclearCount = 0;
  let multipleCount = 0;
  let unreadableCount = 0;
  let lowConfidenceCount = 0;
  let unresolvedCount = 0;
  let needsReview = false;

  const rows: ReviewRow[] = ordered.map((item, idx) => {
    const number = idx + 1;
    const reading = readingByNumber.get(number);
    const corrected = corrections[number];
    const resolved = corrected !== undefined;
    const effective = responses[item.id] || null;
    // A missing detector row is missing evidence, not a trustworthy blank.
    // Keep it unresolved until the teacher explicitly records a decision.
    const confidence = reading?.confidence ?? 0;
    const suggested = reading?.detected ?? null;

    let status: ItemStatus;
    if (resolved) {
      status = effective ? "selected" : "blank";
    } else {
      status = reading ? reading.status : "unclear";
    }
    const rowNeedsReview =
      !resolved &&
      (
        status === "unclear" ||
        status === "multiple" ||
        status === "unreadable" ||
        (status === "selected" && confidence < REVIEW_CONFIDENCE) ||
        (status === "blank" && confidence < BLANK_REVIEW_CONFIDENCE)
      );
    if (rowNeedsReview) {
      needsReview = true;
    }

    const sc = scoreByItem.get(item.id);
    const correctAnswer = versionKey[item.id] ?? "";
    const isCorrect = !!sc?.correct;

    if (rowNeedsReview) unresolvedCount += 1;
    else if (isCorrect) correctCount += 1;
    else if (effective) wrongCount += 1;
    else blankCount += 1;
    if (status === "unclear") unclearCount += 1;
    if (status === "multiple") multipleCount += 1;
    if (status === "unreadable") unreadableCount += 1;
    if (!resolved && status === "selected" && confidence < REVIEW_CONFIDENCE) lowConfidenceCount += 1;
    if (!resolved && status === "blank" && confidence < BLANK_REVIEW_CONFIDENCE) lowConfidenceCount += 1;

    return {
      item,
      itemNumber: number,
      detected: effective,
      suggested,
      status,
      resolved,
      needsReview: rowNeedsReview,
      confidence,
      fill: reading?.fill ?? [0, 0, 0, 0],
      unreadableChoices: reading?.unreadableChoices ?? [],
      correctAnswer,
      isCorrect,
      points: item.points,
      awarded: sc?.awarded ?? 0,
    };
  });

  const scoreableRows = rows.filter((row) => !row.needsReview);
  const rawScore = scoreableRows.reduce((sum, row) => sum + row.awarded, 0);
  const totalScore = scoreableRows.reduce((sum, row) => sum + row.points, 0);
  const percentage = totalScore > 0 ? Math.round((rawScore / totalScore) * 1000) / 10 : 0;

  return {
    rows,
    rawScore,
    totalScore,
    percentage,
    masteryStatus: masteryBand(percentage),
    correctCount,
    wrongCount,
    blankCount,
    unclearCount,
    multipleCount,
    unreadableCount,
    lowConfidenceCount,
    unresolvedCount,
    needsReview,
  };
}
