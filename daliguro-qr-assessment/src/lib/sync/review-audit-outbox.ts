// Durable browser outbox for append-only teacher correction events. A review
// remains locally auditable while offline, then exact event-id retries are
// synchronized to Supabase without duplicating history.

import {
  recordScanReviewDecisions,
  type RemoteReviewDecision,
  resolveScanSubmission,
  type RemoteSubmissionResolution,
} from "./smartscanSync";
import { SCAN_ITEM_STATUSES } from "../types";

const STORAGE_KEY = "smartscan_review_audit_outbox_v1";

export interface QueuedReviewAudit {
  scanId: string;
  decisions: RemoteReviewDecision[];
  resolution?: RemoteSubmissionResolution;
  queuedAt: number;
}

function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDecision(value: unknown): value is RemoteReviewDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<RemoteReviewDecision>;
  const answers = new Set(["", "A", "B", "C", "D", "E"]);
  const sources = new Set(["review_queue", "manual_check", "results", "scanner"]);
  return (
    isUuidV4(row.eventId) &&
    typeof row.omrRowNumber === "number" &&
    Number.isInteger(row.omrRowNumber) && row.omrRowNumber >= 1 && row.omrRowNumber <= 80 &&
    typeof row.itemId === "string" && row.itemId.length >= 1 && row.itemId.length <= 200 &&
    typeof row.itemNumber === "number" &&
    Number.isInteger(row.itemNumber) && row.itemNumber >= 1 && row.itemNumber <= 80 &&
    typeof row.originalStatus === "string" && SCAN_ITEM_STATUSES.includes(row.originalStatus as RemoteReviewDecision["originalStatus"]) &&
    typeof row.originalValue === "string" && answers.has(row.originalValue) &&
    typeof row.correctedValue === "string" && answers.has(row.correctedValue) &&
    typeof row.source === "string" && sources.has(row.source) &&
    typeof row.reason === "string" && row.reason.trim().length >= 3 && row.reason.length <= 1000
  );
}

function isResolution(value: unknown): value is RemoteSubmissionResolution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<RemoteSubmissionResolution>;
  return isUuidV4(row.eventId) &&
    (row.decision === "reviewed" || row.decision === "discarded") &&
    typeof row.reason === "string" && row.reason.trim().length >= 3 && row.reason.length <= 1000;
}

export function parseReviewAuditOutbox(raw: string | null): QueuedReviewAudit[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is QueuedReviewAudit => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const batch = entry as Partial<QueuedReviewAudit>;
      return (
        typeof batch.scanId === "string" &&
        batch.scanId.length >= 8 &&
        Array.isArray(batch.decisions) &&
        (batch.decisions.length > 0 || isResolution(batch.resolution)) &&
        batch.decisions.every(isDecision) &&
        (batch.resolution === undefined || isResolution(batch.resolution)) &&
        typeof batch.queuedAt === "number" &&
        Number.isFinite(batch.queuedAt)
      );
    });
  } catch {
    return [];
  }
}

export function loadReviewAuditOutbox(): QueuedReviewAudit[] {
  try {
    return parseReviewAuditOutbox(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function saveReviewAuditOutbox(entries: QueuedReviewAudit[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // The local Result audit remains the primary offline evidence if browser
    // storage is unavailable. Callers can still retry during this session.
  }
}

export function enqueueReviewAudit(batch: QueuedReviewAudit): QueuedReviewAudit[] {
  const existing = loadReviewAuditOutbox();
  const knownEvents = new Set(existing.flatMap((entry) => entry.decisions.map((decision) => decision.eventId)));
  const decisions = batch.decisions.filter((decision) => !knownEvents.has(decision.eventId));
  const resolutionKnown = batch.resolution && existing.some(
    (entry) => entry.resolution?.eventId === batch.resolution?.eventId,
  );
  const resolution = resolutionKnown ? undefined : batch.resolution;
  const next = decisions.length > 0 || resolution
    ? existing.concat({ ...batch, decisions, ...(resolution ? { resolution } : {}) })
    : existing;
  saveReviewAuditOutbox(next);
  return next;
}

export function enqueueCompletedReview(
  scanId: string,
  decisions: RemoteReviewDecision[],
  resolution: RemoteSubmissionResolution,
): QueuedReviewAudit[] {
  return enqueueReviewAudit({ scanId, decisions, resolution, queuedAt: Date.now() });
}

export function enqueueReviewDecisions(
  scanId: string,
  decisions: RemoteReviewDecision[],
): QueuedReviewAudit[] {
  return enqueueReviewAudit({ scanId, decisions, queuedAt: Date.now() });
}

export async function flushReviewAuditOutbox(): Promise<QueuedReviewAudit[]> {
  const pending = loadReviewAuditOutbox();
  if (pending.length === 0) return [];
  const remaining: QueuedReviewAudit[] = [];
  const blockedScanIds = new Set<string>();
  for (const batch of pending) {
    if (blockedScanIds.has(batch.scanId)) {
      remaining.push(batch);
      continue;
    }
    if (batch.decisions.length > 0) {
      const committed = await recordScanReviewDecisions(batch.scanId, batch.decisions);
      if (!committed.ok) {
        remaining.push(batch);
        blockedScanIds.add(batch.scanId);
        continue;
      }
    }
    if (batch.resolution) {
      const resolved = await resolveScanSubmission(batch.scanId, batch.resolution);
      if (!resolved.ok) {
        remaining.push(batch);
        blockedScanIds.add(batch.scanId);
      }
    }
  }
  saveReviewAuditOutbox(remaining);
  return remaining;
}
