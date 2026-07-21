// Turn an accepted scan into an upserted Result record (pure — the caller
// owns prompts, evidence storage, and setState). Results are keyed by
// (assessmentId, learnerId, version); rescans replace the prior attempt and
// extend its audit trail.

import type {
  AuditEntry,
  Item,
  ItemScore,
  QrAssessmentState,
  Result,
  ReviewStatus,
  ScanItemMeta,
  TestVersion,
} from "../types";
import { computeScores, emptyInput, masteryBand } from "../scoring";
import { scanItemRequiresDecision } from "../result-trust";
import type { ReviewDecisions } from "./omr-score";
import { uid, uuidV4 } from "../ids";
import type { ScanResult } from "./still-pipeline";
import { CHOICES, omrItemsOf } from "./omr-template";

export interface ScanSaveOutcome {
  results: Result[];
  id: string;
  raw: number;
  total: number;
  pct: number;
}

export interface ScanDecisionResolution {
  scanItems: ScanItemMeta[];
  audits: AuditEntry[];
  unresolvedByItemId: Map<string, ScanItemMeta["status"]>;
  decisionValuesByItemId: Map<string, string>;
}

function hasOwnDecision(decisions: ReviewDecisions, rowNumber: number): boolean {
  return Object.prototype.hasOwnProperty.call(decisions, rowNumber);
}

function validDecision(item: Item, value: unknown): value is string {
  if (value === "") return true;
  return (
    typeof value === "string" &&
    CHOICES.slice(0, Math.max(2, Math.min(item.choices, CHOICES.length))).includes(
      value as (typeof CHOICES)[number],
    )
  );
}

// Apply only explicit, valid teacher decisions to the immutable detector
// snapshot. Missing detector rows are synthesized as uncertain evidence, never
// as trusted blanks. The returned audit rows are append-only event records.
export function resolveScanItemDecisions(args: {
  scanItems: ScanItemMeta[];
  omrItems: Item[];
  decisions: ReviewDecisions;
  eventIds?: Record<number, string>;
  actorId: string;
  scanId: string | null;
  source: NonNullable<AuditEntry["source"]>;
}): ScanDecisionResolution {
  const byRow = new Map(args.scanItems.map((item) => [item.itemNumber, item]));
  const audits: AuditEntry[] = [];
  const unresolvedByItemId = new Map<string, ScanItemMeta["status"]>();
  const decisionValuesByItemId = new Map<string, string>();

  const scanItems = args.omrItems.map((item, index) => {
    const rowNumber = index + 1;
    const original: ScanItemMeta = byRow.get(rowNumber) ?? {
      itemNumber: rowNumber,
      detected: null,
      status: "unclear",
      confidence: 0,
      fill: [],
    };
    const candidate = args.decisions[rowNumber];
    const decided = hasOwnDecision(args.decisions, rowNumber) && validDecision(item, candidate);
    if (!decided) {
      if (scanItemRequiresDecision(original)) {
        unresolvedByItemId.set(item.id, original.status);
      }
      return original;
    }

    const correctedValue = candidate;
    decisionValuesByItemId.set(item.id, correctedValue);
    audits.push({
      eventId: args.eventIds?.[rowNumber] ?? uuidV4(),
      at: Date.now(),
      action: "OMR item explicitly resolved",
      reason:
        original.status === "unreadable"
          ? "Unreadable camera evidence required an explicit teacher decision."
          : scanItemRequiresDecision(original)
            ? "Uncertain camera evidence required an explicit teacher decision."
            : "Teacher explicitly changed or confirmed the detected answer.",
      itemId: item.id,
      itemNumber: item.itemNumber,
      originalStatus: original.status,
      originalValue: original.detected ?? "",
      correctedValue,
      actorId: args.actorId,
      source: args.source,
      scanId: args.scanId,
    });
    return {
      ...original,
      detected: correctedValue || null,
      status: correctedValue ? "selected" as const : "blank" as const,
      confidence: 1,
      unreadableChoices: [],
    };
  });

  return { scanItems, audits, unresolvedByItemId, decisionValuesByItemId };
}

export function scoreExcludingUnresolved(
  itemScores: ItemScore[],
  unresolvedByItemId: ReadonlyMap<string, ScanItemMeta["status"]>,
) {
  const scores = itemScores.map((score) => {
    const unresolvedStatus = unresolvedByItemId.get(score.itemId);
    return unresolvedStatus
      ? {
          ...score,
          awarded: 0,
          correct: false,
          blank: false,
          unresolved: true,
          unresolvedStatus,
        }
      : { ...score, unresolved: false, unresolvedStatus: undefined };
  });
  const resolved = scores.filter((score) => !score.unresolved);
  const raw = resolved.reduce((sum, score) => sum + score.awarded, 0);
  const total = resolved.reduce((sum, score) => sum + score.points, 0);
  const pct = total > 0 ? Math.round((raw / total) * 1000) / 10 : 0;
  return { itemScores: scores, raw, total, pct, masteryStatus: masteryBand(pct) };
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
  decisions: ReviewDecisions,
  reviewStatus: ReviewStatus,
  auditReason: string | undefined,
  actorId = result.assessment.teacherName || "local-teacher",
): ScanSaveOutcome {
  const a = result.assessment;
  const aItems = state.items
    .filter((i) => i.assessmentId === a.id)
    .sort((x, y) => x.itemNumber - y.itemNumber);
  const omrItems = omrItemsOf(aItems);
  const vk = (state.answerKeys[a.id] ?? {})[result.version] ?? {};
  const now = Date.now();
  const existing = findScanResult(state.results, a.id, result.learner.id, result.version);
  const id = existing ? existing.id : uid("R_");
  const scanId = existing?.sourceScanId ?? id;

  const rawScanItems: ScanItemMeta[] = result.reading.items.map((r) => ({
    itemNumber: r.item,
    detected: r.detected,
    status: r.status,
    confidence: r.confidence,
    fill: r.fill,
    unreadableChoices: r.unreadableChoices,
  }));
  const decisionResolution = resolveScanItemDecisions({
    scanItems: rawScanItems,
    omrItems,
    decisions,
    actorId,
    scanId,
    source: "scanner",
  });
  const effectiveResponses = { ...responses };
  decisionResolution.decisionValuesByItemId.forEach((value, itemId) => {
    effectiveResponses[itemId] = value;
  });
  decisionResolution.unresolvedByItemId.forEach((_status, itemId) => {
    effectiveResponses[itemId] = "";
  });
  const summary = computeScores(aItems, vk, { ...emptyInput(), responses: effectiveResponses });
  const scored = scoreExcludingUnresolved(summary.itemScores, decisionResolution.unresolvedByItemId);
  const answers = aItems.map((i) => ({ itemId: i.id, response: effectiveResponses[i.id] ?? "" }));
  const manualItemsRemain = omrItems.length !== aItems.length;
  const mustReview = decisionResolution.unresolvedByItemId.size > 0 || manualItemsRemain;
  const savedStatus: ReviewStatus = existing?.finalizedAt && !mustReview
    ? "finalized"
    : mustReview
      ? "needs_review"
      : reviewStatus;

  const trust = Math.round(result.confidence * 100);
  const quality = result.quality?.score ?? Math.round(result.confidence * 100);
  let action: string;
  if (existing) {
    action = `Rescanned and replaced via ${result.captureSource} (trust ${trust}%, quality ${quality})`;
  } else if (reviewStatus === "auto") {
    action = `Scanned via ${result.captureSource} (trust ${trust}%, quality ${quality}), auto-accepted`;
  } else if (reviewStatus === "needs_review") {
    action = `Scanned via ${result.captureSource} (trust ${trust}%, quality ${quality}), queued for review`;
  } else {
    action = `Scanned via ${result.captureSource} (trust ${trust}%, quality ${quality}), teacher-reviewed`;
  }

  const saved: Result = {
    id,
    assessmentId: a.id,
    learnerId: result.learner.id,
    version: result.version,
    answers,
    itemScores: scored.itemScores,
    rawScore: scored.raw,
    totalScore: scored.total,
    percentage: scored.pct,
    masteryStatus: scored.masteryStatus,
    reviewed: savedStatus !== "needs_review",
    source: result.source === "manual" ? "manual" : "scan",
    scanConfidence: result.confidence,
    scanQuality: quality,
    reviewStatus: savedStatus,
    finalizedAt: savedStatus === "finalized" ? existing?.finalizedAt ?? now : null,
    scanItems: decisionResolution.scanItems,
    sourceScanId: scanId,
    sourceScanFingerprint: existing?.sourceScanFingerprint,
    auditLog: (existing ? existing.auditLog : []).concat(
      decisionResolution.audits,
      {
        at: now,
        action: mustReview
          ? `${action}; unresolved or manual-scoring items remain`
          : action,
        ...(auditReason ? { reason: auditReason } : {}),
        actorId,
        source: "scanner" as const,
        scanId,
      },
    ),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  const results = existing
    ? state.results.map((r) => (r.id === id ? saved : r))
    : state.results.concat(saved);

  return { results, id, raw: scored.raw, total: scored.total, pct: scored.pct };
}

export interface SyncedResultInput {
  scanId?: string;
  assessmentId: string;
  learnerId: string;
  version: string;
  responses: Record<string, string>; // keyed by itemId
  scanItems: ScanItemMeta[];
  confidence: number | null;
  reviewStatus: ReviewStatus;
}

export type SyncedSaveDisposition = "saved" | "replayed" | "conflict";

export interface SyncedScanSaveOutcome extends ScanSaveOutcome {
  disposition: SyncedSaveDisposition;
  reason?: "scan_id_payload_mismatch" | "existing_result_requires_decision";
}

// Deterministic local replay fingerprint. The database repeats this protection
// in its immutable submission ledger. Keeping it locally also prevents a
// corrupted same-id retry from changing a result before cloud persistence.
export function syncedInputFingerprint(input: SyncedResultInput): string {
  const responses = Object.keys(input.responses)
    .sort()
    .map((key) => [key, input.responses[key]]);
  const scanItems = input.scanItems
    .slice()
    .sort((left, right) => left.itemNumber - right.itemNumber)
    .map((item) => [
      item.itemNumber,
      item.detected ?? "",
      item.status,
      item.confidence,
      item.fill ?? [],
      item.unreadableChoices ?? [],
    ]);
  return JSON.stringify({
    assessmentId: input.assessmentId,
    learnerId: input.learnerId,
    version: input.version,
    responses,
    scanItems,
    confidence: input.confidence,
  });
}

function subtotalFor(
  result: Result,
  omrItemIds: ReadonlySet<string>,
): Pick<ScanSaveOutcome, "raw" | "total" | "pct"> {
  const scores = result.itemScores.filter((score) => omrItemIds.has(score.itemId) && !score.unresolved);
  const raw = scores.reduce((sum, score) => sum + score.awarded, 0);
  const total = scores.reduce((sum, score) => sum + score.points, 0);
  const pct = total > 0 ? Math.round((raw / total) * 1000) / 10 : 0;
  return { raw, total, pct };
}

// Merge a checked result that arrived from a paired phone (via Supabase) into
// local state. The phone sends raw *detected answers*; the PC scores them
// against its OWN answer key here, producing the same Result shape a local scan
// makes — so synced results flow into Results / Review / Analysis / Reports
// exactly like a scan done on the PC. A locally FINALIZED (locked) result is
// never silently clobbered by a phone sync.
export function upsertSyncedResult(
  state: QrAssessmentState,
  input: SyncedResultInput,
): SyncedScanSaveOutcome {
  const aItems = state.items
    .filter((i) => i.assessmentId === input.assessmentId)
    .sort((x, y) => x.itemNumber - y.itemNumber);
  const omrItems = omrItemsOf(aItems);
  const omrItemIds = new Set(omrItems.map((item) => item.id));
  const fingerprint = syncedInputFingerprint(input);
  const replay = input.scanId
    ? state.results.find((result) => result.sourceScanId === input.scanId)
    : undefined;
  if (replay) {
    if (!replay.sourceScanFingerprint || replay.sourceScanFingerprint !== fingerprint) {
      return {
        results: state.results,
        id: replay.id,
        ...subtotalFor(replay, omrItemIds),
        disposition: "conflict",
        reason: "scan_id_payload_mismatch",
      };
    }
    return {
      results: state.results,
      id: replay.id,
      ...subtotalFor(replay, omrItemIds),
      disposition: "replayed",
    };
  }
  const existing = findScanResult(state.results, input.assessmentId, input.learnerId, input.version);
  if (existing) {
    return {
      results: state.results,
      id: existing.id,
      ...subtotalFor(existing, omrItemIds),
      disposition: "conflict",
      reason: "existing_result_requires_decision",
    };
  }
  const vk = (state.answerKeys[input.assessmentId] ?? {})[input.version as TestVersion] ?? {};
  const summary = computeScores(aItems, vk, { ...emptyInput(), responses: input.responses });
  const omrSummary = computeScores(omrItems, vk, { ...emptyInput(), responses: input.responses });
  const unresolvedByItemId = new Map(
    input.scanItems.flatMap((scanItem, index) => {
      const item = omrItems[index];
      const unresolved = scanItemRequiresDecision(scanItem);
      return item && unresolved ? [[item.id, scanItem.status] as const] : [];
    }),
  );
  const itemScores = summary.itemScores.map((score) => {
    const unresolvedStatus = unresolvedByItemId.get(score.itemId);
    return unresolvedStatus
      ? { ...score, awarded: 0, correct: false, blank: false, unresolved: true, unresolvedStatus }
      : score;
  });
  const resolvedScores = itemScores.filter((score) => !score.unresolved);
  const resolvedRaw = resolvedScores.reduce((sum, score) => sum + score.awarded, 0);
  const resolvedTotal = resolvedScores.reduce((sum, score) => sum + score.points, 0);
  const resolvedPercentage = resolvedTotal > 0 ? Math.round((resolvedRaw / resolvedTotal) * 1000) / 10 : 0;
  const resolvedOmrScores = omrSummary.itemScores.filter((score) => !unresolvedByItemId.has(score.itemId));
  const omrRaw = resolvedOmrScores.reduce((sum, score) => sum + score.awarded, 0);
  const omrTotal = resolvedOmrScores.reduce((sum, score) => sum + score.points, 0);
  const omrPct = omrTotal > 0 ? Math.round((omrRaw / omrTotal) * 1000) / 10 : 0;
  const answers = aItems.map((i) => ({ itemId: i.id, response: input.responses[i.id] ?? "" }));
  const now = Date.now();
  const id = uid("R_");
  const trust = Math.round((input.confidence ?? 0) * 100);
  const saved: Result = {
    id,
    assessmentId: input.assessmentId,
    learnerId: input.learnerId,
    version: input.version as Result["version"],
    answers,
    itemScores,
    rawScore: resolvedRaw,
    totalScore: resolvedTotal,
    percentage: resolvedPercentage,
    masteryStatus: masteryBand(resolvedPercentage),
    reviewed: false,
    source: "scan",
    scanConfidence: input.confidence,
    scanQuality: input.confidence == null ? null : Math.round(input.confidence * 100),
    reviewStatus: "needs_review",
    finalizedAt: null,
    scanItems: input.scanItems,
    sourceScanId: input.scanId ?? null,
    sourceScanFingerprint: fingerprint,
    auditLog: [{
      at: now,
      action: `Synced from paired phone (trust ${trust}%), pending teacher review`,
    }],
    createdAt: now,
    updatedAt: now,
  };

  const results = state.results.concat(saved);
  return {
    results,
    id,
    raw: omrRaw,
    total: omrTotal,
    pct: omrPct,
    disposition: "saved",
  };
}
