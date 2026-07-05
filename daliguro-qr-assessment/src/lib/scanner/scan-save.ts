// Turn an accepted scan into an upserted Result record (pure — the caller
// owns prompts, evidence storage, and setState). Results are keyed by
// (assessmentId, learnerId, version); rescans replace the prior attempt and
// extend its audit trail.

import type {
  QrAssessmentState,
  Result,
  ReviewStatus,
  ScanItemMeta,
} from "../types";
import { computeScores, emptyInput } from "../scoring";
import { uid } from "../ids";
import type { ScanResult } from "./still-pipeline";

export interface ScanSaveOutcome {
  results: Result[];
  id: string;
  raw: number;
  total: number;
  pct: number;
}

export function findScanResult(
  results: Result[],
  assessmentId: string,
  learnerId: string,
  version: string,
): Result | undefined {
  return results.find(
    (r) =>
      r.assessmentId === assessmentId &&
      r.learnerId === learnerId &&
      r.version === version,
  );
}

export function upsertScanResult(
  state: QrAssessmentState,
  result: ScanResult,
  responses: Record<string, string>,
  reviewStatus: ReviewStatus,
  auditReason: string | undefined,
): ScanSaveOutcome {
  const a = result.assessment;
  const aItems = state.items
    .filter((i) => i.assessmentId === a.id)
    .sort((x, y) => x.itemNumber - y.itemNumber);
  const vk = (state.answerKeys[a.id] ?? {})[result.version] ?? {};
  const summary = computeScores(aItems, vk, { ...emptyInput(), responses });
  const answers = aItems.map((i) => ({ itemId: i.id, response: responses[i.id] ?? "" }));
  const now = Date.now();
  const existing = findScanResult(state.results, a.id, result.learner.id, result.version);
  const id = existing ? existing.id : uid("R_");

  const scanItems: ScanItemMeta[] = result.reading.items.map((r) => ({
    itemNumber: r.item,
    detected: r.detected,
    status: r.status,
    confidence: r.confidence,
  }));

  const trust = Math.round(result.confidence * 100);
  let action: string;
  if (existing) {
    action = `Rescanned and replaced (trust ${trust}%)`;
  } else if (reviewStatus === "auto") {
    action = `Scanned (trust ${trust}%), auto-accepted`;
  } else if (reviewStatus === "needs_review") {
    action = `Scanned (trust ${trust}%), queued for review`;
  } else {
    action = `Scanned (trust ${trust}%), teacher-reviewed`;
  }

  const saved: Result = {
    id,
    assessmentId: a.id,
    learnerId: result.learner.id,
    version: result.version,
    answers,
    itemScores: summary.itemScores,
    rawScore: summary.rawScore,
    totalScore: summary.totalScore,
    percentage: summary.percentage,
    masteryStatus: summary.masteryStatus,
    reviewed: reviewStatus !== "needs_review",
    source: result.source === "manual" ? "manual" : "scan",
    scanConfidence: result.confidence,
    reviewStatus: existing?.finalizedAt ? "finalized" : reviewStatus,
    finalizedAt: existing ? existing.finalizedAt : null,
    scanItems,
    auditLog: (existing ? existing.auditLog : []).concat({
      at: now,
      action,
      ...(auditReason ? { reason: auditReason } : {}),
    }),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  const results = existing
    ? state.results.map((r) => (r.id === id ? saved : r))
    : state.results.concat(saved);

  return { results, id, raw: summary.rawScore, total: summary.totalScore, pct: summary.percentage };
}
