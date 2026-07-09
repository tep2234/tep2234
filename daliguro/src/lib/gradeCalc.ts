import { GradingResult } from '@/types';
import {
  ComponentWeights,
  getDescriptor,
  getIntervention,
  transmuteSY2026,
} from './gradingPolicy';

// ── Three-term DepEd computation engine (SY 2026-2027) ──────────────────────

/**
 * Compute percentage score for one component.
 * PS = (learner total) / (highest possible total) × 100
 */
export function computePS(rawScore: number, highestPossible: number): number {
  if (highestPossible <= 0) return 0;
  return (rawScore / highestPossible) * 100;
}

/**
 * Compute weighted score for one component.
 * WS = PS × weight / 100
 */
export function computeWS(ps: number, weight: number): number {
  return (ps * weight) / 100;
}

/**
 * Full three-term grade computation for one student in one term.
 *
 * @param wwRaw      Learner's total WW raw score
 * @param wwHighest  Highest possible WW raw score
 * @param ptRaw      Learner's total PT raw score
 * @param ptHighest  Highest possible PT raw score
 * @param stTeRaw    Learner's STs-TE raw score (0 when no term exam)
 * @param stTeHighest Highest possible STs-TE (0 when no term exam)
 * @param weights    ComponentWeights from gradingPolicy
 */
export function computeTermGrade(
  wwRaw: number,
  wwHighest: number,
  ptRaw: number,
  ptHighest: number,
  stTeRaw: number,
  stTeHighest: number,
  weights: ComponentWeights,
): GradingResult {
  const wwPS = computePS(wwRaw, wwHighest);
  const ptPS = computePS(ptRaw, ptHighest);
  const stTePS = weights.stTe !== null ? computePS(stTeRaw, stTeHighest) : 0;

  const wwWS = computeWS(wwPS, weights.ww);
  const ptWS = computeWS(ptPS, weights.pt);
  const stTeWS = weights.stTe !== null ? computeWS(stTePS, weights.stTe) : 0;

  const initialGrade = wwWS + ptWS + stTeWS;
  const transmuted = transmuteSY2026(initialGrade);

  return {
    wwPS: round2(wwPS),
    ptPS: round2(ptPS),
    stTePS: round2(stTePS),
    wwWS: round2(wwWS),
    ptWS: round2(ptWS),
    stTeWS: round2(stTeWS),
    initialGrade: round2(initialGrade),
    transmutedGrade: transmuted,
    descriptor: getDescriptor(transmuted),
    intervention: getIntervention(transmuted),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Legacy helpers (kept for backward compatibility) ────────────────────────

export function getHighestScore(scores: (number | null)[]): number {
  const valid = scores.filter((s): s is number => s !== null && !isNaN(s));
  if (valid.length === 0) return 0;
  return Math.max(...valid);
}

export function calcPS(total: number, highest: number): number {
  if (highest === 0) return 0;
  return (total / highest) * 100;
}

export function calcWS(scores: (number | null)[], highestScores: (number | null)[], weight: number): number {
  const studentTotal = scores.reduce<number>((sum, s) => sum + (s ?? 0), 0);
  const highestTotal = highestScores.reduce<number>((sum, s) => sum + (s ?? 0), 0);
  if (highestTotal === 0) return 0;
  return (studentTotal / highestTotal) * weight;
}

export function calcFinalGrade(wwWS: number, ptWS: number, qaWS: number): number {
  const raw = wwWS + ptWS + qaWS;
  return Math.round(raw);
}

export function transmutedGrade(initialGrade: number): number {
  if (initialGrade === 100) return 100;
  if (initialGrade >= 98.40) return 99;
  if (initialGrade >= 96.80) return 98;
  if (initialGrade >= 95.20) return 97;
  if (initialGrade >= 93.60) return 96;
  if (initialGrade >= 92.00) return 95;
  if (initialGrade >= 90.40) return 94;
  if (initialGrade >= 88.80) return 93;
  if (initialGrade >= 87.20) return 92;
  if (initialGrade >= 85.60) return 91;
  if (initialGrade >= 84.00) return 90;
  if (initialGrade >= 82.40) return 89;
  if (initialGrade >= 80.80) return 88;
  if (initialGrade >= 79.20) return 87;
  if (initialGrade >= 77.60) return 86;
  if (initialGrade >= 76.00) return 85;
  if (initialGrade >= 74.40) return 84;
  if (initialGrade >= 72.80) return 83;
  if (initialGrade >= 71.20) return 82;
  if (initialGrade >= 69.60) return 81;
  if (initialGrade >= 68.00) return 80;
  if (initialGrade >= 66.40) return 79;
  if (initialGrade >= 64.80) return 78;
  if (initialGrade >= 63.20) return 77;
  if (initialGrade >= 61.60) return 76;
  if (initialGrade >= 60.00) return 75;
  if (initialGrade >= 56.00) return 74;
  if (initialGrade >= 52.00) return 73;
  if (initialGrade >= 48.00) return 72;
  if (initialGrade >= 44.00) return 71;
  if (initialGrade >= 40.00) return 70;
  if (initialGrade >= 36.00) return 69;
  if (initialGrade >= 32.00) return 68;
  if (initialGrade >= 28.00) return 67;
  if (initialGrade >= 24.00) return 66;
  if (initialGrade >= 20.00) return 65;
  if (initialGrade >= 16.00) return 64;
  if (initialGrade >= 12.00) return 63;
  if (initialGrade >= 8.00) return 62;
  if (initialGrade >= 4.00) return 61;
  return 60;
}

export function gradeColor(grade: number): string {
  if (grade >= 90) return 'text-green-600';
  if (grade >= 85) return 'text-blue-600';
  if (grade >= 80) return 'text-amber-600';
  if (grade >= 75) return 'text-orange-500';
  return 'text-red-600';
}

export function gradeBgColor(grade: number): string {
  if (grade >= 90) return 'bg-green-100 text-green-700';
  if (grade >= 85) return 'bg-blue-100 text-blue-700';
  if (grade >= 80) return 'bg-amber-100 text-amber-700';
  if (grade >= 75) return 'bg-orange-100 text-orange-700';
  return 'bg-red-100 text-red-700';
}
