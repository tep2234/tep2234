// SmartScan sync data-access: pairing sessions + checked results against
// Supabase, built on the pure pairing primitives. Every function null-checks the
// client and degrades gracefully when Supabase is not configured. RLS on the DB
// enforces teacher ownership; these helpers never send the service-role key.

import { getSupabaseClient } from "../supabase/client";
import type { Result, ScanItemStatus } from "../types";
import {
  checkedResultRow,
  generatePairingToken,
  hashToken,
  type CheckedResultRow,
  type RowContext,
} from "./pairing";
import type {
  PhoneCapability,
  PhoneInboxRow,
  PhoneSubmissionEnvelope,
  PhoneSubmissionStatus,
} from "./realtime-security";

export interface SessionRow {
  id: string;
  teacher_user_id: string;
  school_id: string | null;
  assessment_id: string;
  assessment_scope_id: string;
  allowed_versions: string[];
  item_count: number;
  status: "active" | "paired" | "expired" | "ended";
  paired_device_name: string | null;
  paired_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface CreatedSession {
  sessionId: string;
  token: string; // raw token — returned once, for the pairing QR only
  expiresAtMs: number;
}

// PC creates a pairing session. Only the token HASH is stored; the raw token is
// returned to the caller to embed in the QR/URL.
export async function createPairingSession(args: {
  assessmentId: string;
  learnerIds: string[];
  allowedVersions: string[];
  itemCount: number;
}): Promise<CreatedSession | null> {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const token = generatePairingToken();
  const hash = await hashToken(token);
  const { data, error } = await sb.rpc("create_smartscan_pairing_session", {
    p_assessment_id: args.assessmentId,
    p_pairing_token_hash: hash,
    p_learner_ids: args.learnerIds,
    p_allowed_versions: args.allowedVersions,
    p_item_count: args.itemCount,
  });
  const record = Array.isArray(data) ? data[0] : data;
  if (error || !record || typeof record.session_id !== "string" || typeof record.expires_at !== "string") return null;
  return {
    sessionId: record.session_id,
    token,
    expiresAtMs: new Date(record.expires_at).getTime(),
  };
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const { data } = await sb.from("smartscan_sessions").select("*").eq("id", sessionId).single();
  return (data as SessionRow) ?? null;
}

export type ClaimResult =
  | { ok: true; capability: PhoneCapability }
  | { ok: false; reason: "invalid_or_expired" | "offline" };

// Phone claims a session through the atomic server boundary. The pairing token
// is consumed and never becomes the reusable submission credential.
export async function claimSession(
  sessionId: string,
  token: string,
  deviceName: string,
): Promise<ClaimResult> {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, reason: "offline" };
  const { data, error } = await sb.rpc("claim_smartscan_session", {
    p_session_id: sessionId,
    p_pairing_token: token,
    p_device_name: deviceName.slice(0, 160),
  });
  const record = Array.isArray(data) ? data[0] : data;
  if (error || !record || typeof record.capability !== "string") {
    return { ok: false, reason: "invalid_or_expired" };
  }
  return {
    ok: true,
    capability: {
      sessionId,
      capability: record.capability,
      capabilityExpiresAtMs: new Date(record.capability_expires_at).getTime(),
      assessmentId: record.assessment_id,
      schoolId: record.school_id,
      itemCount: record.item_count,
      allowedVersions: record.allowed_versions,
      nextSequence: record.next_sequence,
    },
  };
}

export async function endSession(sessionId: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  await sb.rpc("end_smartscan_pairing_session", { p_session_id: sessionId });
}

export type PhoneIngressResult =
  | { ok: true; inboxReceiptId: string; receivedAt: string; replayed: boolean }
  | { ok: false; reason: "offline" | "rejected" };

export async function submitPhoneScan(envelope: PhoneSubmissionEnvelope): Promise<PhoneIngressResult> {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, reason: "offline" };
  const { data, error } = await sb.rpc("submit_smartscan_phone_scan", {
    p_session_id: envelope.sessionId,
    p_capability: envelope.capability,
    p_message_id: envelope.messageId,
    p_sequence_number: envelope.sequenceNumber,
    p_issued_at: envelope.issuedAt,
    p_payload_text: envelope.payloadText,
    p_payload_digest: envelope.payloadDigest,
  });
  const record = Array.isArray(data) ? data[0] : data;
  if (error || !record || typeof record.inbox_receipt_id !== "string") {
    return { ok: false, reason: "rejected" };
  }
  return {
    ok: true,
    inboxReceiptId: record.inbox_receipt_id,
    receivedAt: record.received_at,
    replayed: record.replayed === true,
  };
}

export async function getPhoneSubmissionStatus(
  capability: PhoneCapability,
  messageId: string,
): Promise<PhoneSubmissionStatus | null> {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc("get_smartscan_phone_submission_status", {
    p_session_id: capability.sessionId,
    p_capability: capability.capability,
    p_message_id: messageId,
  });
  const record = Array.isArray(data) ? data[0] : data;
  if (error || !record || typeof record.status !== "string") return null;
  return {
    status: record.status,
    inboxReceiptId: record.inbox_receipt_id,
    resultReceiptId: record.result_receipt_id ?? null,
    score: record.score_summary ?? null,
    rejectionCode: record.rejection_code ?? null,
    receivedAt: record.received_at,
    completedAt: record.completed_at ?? null,
  } as PhoneSubmissionStatus;
}

export async function fetchPhoneSubmissions(
  teacherUserId: string,
  assessmentId: string,
  status = "received",
): Promise<PhoneInboxRow[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];
  const { data } = await sb
    .from("smartscan_phone_submissions")
    .select("*")
    .eq("teacher_user_id", teacherUserId)
    .eq("assessment_id", assessmentId)
    .eq("status", status)
    .order("sequence_number", { ascending: true });
  return (data as PhoneInboxRow[]) ?? [];
}

export async function completePhoneSubmission(args: {
  sessionId: string;
  messageId: string;
  resultReceiptId?: string;
  score?: import("./pairing").ScoredSummary;
  rejectionCode?: "pc_validation_failed" | "learner_or_version_invalid" | "duplicate_requires_review" | "durable_commit_failed";
}): Promise<boolean> {
  const sb = getSupabaseClient();
  if (!sb) return false;
  const scoreSummary = args.score && args.resultReceiptId
    ? { receiptId: args.resultReceiptId, ...args.score }
    : null;
  const { data, error } = await sb.rpc("complete_smartscan_phone_submission", {
    p_session_id: args.sessionId,
    p_message_id: args.messageId,
    p_result_receipt_id: args.resultReceiptId ?? null,
    p_score_summary: scoreSummary,
    p_rejection_code: args.rejectionCode ?? null,
  });
  const record = Array.isArray(data) ? data[0] : data;
  return !error && !!record && typeof record.inbox_receipt_id === "string";
}

export type CommitResult =
  | { ok: true; receiptId: string; committedAt: string; replayed: boolean }
  | { ok: false; reason: "offline" | "write_failed" };

export interface RemoteReviewDecision {
  eventId: string;
  omrRowNumber: number;
  itemId: string;
  itemNumber: number;
  originalStatus: ScanItemStatus;
  originalValue: string;
  correctedValue: string;
  source: "review_queue" | "manual_check" | "results" | "scanner";
  reason: string;
}

export type ReviewAuditCommitResult =
  | { ok: true; recorded: number }
  | { ok: false; reason: "offline" | "write_failed" };

export interface RemoteSubmissionResolution {
  eventId: string;
  decision: "reviewed" | "discarded";
  reason: string;
}

export type SubmissionResolutionResult =
  | { ok: true; resolutionId: string; replayed: boolean }
  | { ok: false; reason: "offline" | "write_failed" };

// Append immutable teacher decisions beside the original phone submission.
// This never updates or deletes detector evidence; exact event-id retries are
// idempotent in the RPC and altered replays are rejected.
export async function recordScanReviewDecisions(
  scanId: string,
  decisions: RemoteReviewDecision[],
): Promise<ReviewAuditCommitResult> {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, reason: "offline" };
  if (!scanId || decisions.length === 0) return { ok: false, reason: "write_failed" };
  const { data, error } = await sb.rpc("record_smartscan_review_decisions", {
    p_scan_id: scanId,
    p_decisions: decisions,
  });
  if (error || !Array.isArray(data) || data.length !== decisions.length) {
    return { ok: false, reason: "write_failed" };
  }
  return { ok: true, recorded: data.length };
}

// Resolve the provisional server ledger only after its item-level audit events
// are durable. The RPC is single-transition and exact-event idempotent.
export async function resolveScanSubmission(
  scanId: string,
  resolution: RemoteSubmissionResolution,
): Promise<SubmissionResolutionResult> {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, reason: "offline" };
  const { data, error } = await sb.rpc("resolve_smartscan_submission", {
    p_scan_id: scanId,
    p_resolution: resolution,
  });
  const record = Array.isArray(data) ? data[0] : data;
  if (error || !record || typeof record.resolution_id !== "string") {
    return { ok: false, reason: "write_failed" };
  }
  return {
    ok: true,
    resolutionId: record.resolution_id,
    replayed: record.replayed === true,
  };
}

// Commit an immutable, provisional submission through the transactional server
// boundary. The RPC enforces owner/session/expiry checks, exact replay, and a
// one-pending-submission rule before returning a scan-specific receipt.
export async function commitCheckedResult(row: CheckedResultRow): Promise<CommitResult> {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, reason: "offline" };
  const { data, error } = await sb
    .rpc("commit_smartscan_submission", { p_submission: row });
  const record = Array.isArray(data) ? data[0] : data;
  if (error || !record || typeof record.receipt_id !== "string") {
    return { ok: false, reason: "write_failed" };
  }
  return {
    ok: true,
    receiptId: record.receipt_id,
    committedAt: typeof record.committed_at === "string" ? record.committed_at : new Date().toISOString(),
    replayed: record.replayed === true,
  };
}

// Compatibility wrapper for existing callers that only need success/failure.
export async function upsertCheckedResult(row: CheckedResultRow): Promise<boolean> {
  return (await commitCheckedResult(row)).ok;
}

export async function uploadResult(result: Result, ctx: RowContext): Promise<boolean> {
  return upsertCheckedResult(checkedResultRow(result, ctx));
}

export async function fetchCheckedResults(
  teacherUserId: string,
  assessmentId: string,
): Promise<CheckedResultRow[]> {
  const sb = getSupabaseClient();
  if (!sb) return [];
  const { data } = await sb
    .from("smartscan_scan_submissions")
    .select("*")
    .eq("teacher_user_id", teacherUserId)
    .eq("assessment_id", assessmentId)
    .order("checked_at", { ascending: false });
  return (data as CheckedResultRow[]) ?? [];
}
