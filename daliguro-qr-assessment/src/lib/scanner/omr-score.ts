// Turn OMR readings (+ teacher corrections) into a reviewable, scored result.
// Reuses computeScores so OMR scoring is identical to manual checking.

import type { Item, MasteryStatus, VersionKey } from "../types";
import { computeScores, emptyInput } from "../scoring";
import type { ItemReading, ItemStatus } from "./omr-detect";

export interface ReviewRow {
  item: Item;
  itemNumber: number;
  detected: string | null; // effective letter after corrections ("" -> blank)
  status: ItemStatus;
  resolved: boolean; // teacher corrected this row
  confidence: number;
  fill: number[];
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
  // True while any unclear/multiple row is still unresolved — blocks save.
  needsReview: boolean;
}

// `items` must be the OMR items in itemNumber order; reading.item is 1..N and
// lines up with that order. `corrections` maps itemNumber -> letter ("" = blank).
export function buildReview(
  items: Item[],
  versionKey: VersionKey,
  readings: ItemReading[],
  corrections: Record<number, string> = {},
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
    } else if (reading && reading.status === "selected" && reading.detected) {
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
  let needsReview = false;

  const rows: ReviewRow[] = ordered.map((item, idx) => {
    const number = idx + 1;
    const reading = readingByNumber.get(number);
    const corrected = corrections[number];
    const resolved = corrected !== undefined;
    const effective = responses[item.id] || null;

    let status: ItemStatus;
    if (resolved) {
      status = effective ? "selected" : "blank";
    } else {
      status = reading ? reading.status : "blank";
    }
    if (!resolved && (status === "unclear" || status === "multiple")) {
      needsReview = true;
    }

    const sc = scoreByItem.get(item.id);
    const correctAnswer = versionKey[item.id] ?? "";
    const isCorrect = !!sc?.correct;

    if (isCorrect) correctCount += 1;
    else if (effective) wrongCount += 1;
    else blankCount += 1;
    if (status === "unclear") unclearCount += 1;
    if (status === "multiple") multipleCount += 1;

    return {
      item,
      itemNumber: number,
      detected: effective,
      status,
      resolved,
      confidence: reading?.confidence ?? 1,
      fill: reading?.fill ?? [0, 0, 0, 0],
      correctAnswer,
      isCorrect,
      points: item.points,
      awarded: sc?.awarded ?? 0,
    };
  });

  return {
    rows,
    rawScore: summary.rawScore,
    totalScore: summary.totalScore,
    percentage: summary.percentage,
    masteryStatus: summary.masteryStatus,
    correctCount,
    wrongCount,
    blankCount,
    unclearCount,
    multipleCount,
    needsReview,
  };
}
