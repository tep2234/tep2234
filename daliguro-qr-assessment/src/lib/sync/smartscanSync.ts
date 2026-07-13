// SmartScan sync data-access: pairing sessions + checked results against
// Supabase, built on the pure pairing primitives. Every function null-checks the
// client and degrades gracefully when Supabase is not configured. RLS on the DB
// enforces teacher ownership; these helpers never send the service-role key.

import { getSupabaseClient } from "../supabase/client";
import type { Result, ScanItemStatus } from "../types";
import {
  checkedResultRow,
  expiresAt,
  generatePairingToken,
  hashToken,
  isExpired,
  verifyPairingToken,
  type CheckedResultRow,
  type RowContext,
} from "./pairing";

export interface SessionRow {
  id: string;
  teacher_user_id: string;
  school_id: string | null;
  assessment_id: string;
  session_token_hash: string;
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
  teacherUserId: string;
  assessmentId: string;
  schoolId?: string | null;
}): Promise<CreatedSession | null> {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const token = generatePairingToken();
  const hash = await hashToken(token);
  const expMs = expiresAt();
  const { data, error } = await sb
    .from("smartscan_sessions")
    .insert({
      teacher_user_id: args.teacherUserId,
      assessment_id: args.assessmentId,
      school_id: args.schoolId ?? null,
      session_token_hash: hash,
      status: "active",
      expires_at: new Date(expMs).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { sessionId: data.id as string, token, expiresAtMs: expMs };
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const { data } = await sb.from("smartscan_sessions").select("*").eq("id", sessionId).single();
  return (data as SessionRow) ?? null;
}

export type ClaimResult =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: "not_found" | "invalid_token" | "expired" | "ended" | "offline" };

// Phone claims a session: verify token hash, check expiry/status, mark paired.
export async function claimSession(
  sessionId: string,
  token: string,
  deviceName: string,
): Promise<ClaimResult> {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, reason: "offline" };
  const session = await getSession(sessionId);
  if (!session) return { ok: false, reason: "not_found" };
  if (session.status === "ended") return { ok: false, reason: "ended" };
  if (isExpired(new Date(session.expires_at).getTime())) return { ok: false, reason: "expired" };
  if (!(await verifyPairingToken(token, session.session_token_hash))) {
    return { ok: false, reason: "invalid_token" };
  }
  const now = new Date().toISOString();
  const { data } = await sb
    .from("smartscan_sessions")
    .update({ status: "paired", paired_at: now, last_seen_at: now, paired_device_name: deviceName })
    .eq("id", sessionId)
    .select("*")
    .single();
  return { ok: true, session: (data as SessionRow) ?? session };
}

export async function endSession(sessionId: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  await sb.from("smartscan_sessions").update({ status: "ended" }).eq("id", sessionId);
}

export async function touchSession(sessionId: string): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) return;
  await sb
    .from("smartscan_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", sessionId);
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
