// Phone↔PC pairing primitives (pure, framework-free, testable offline).
// The PC creates a session, shows a pairing QR that encodes the session URL +
// a one-time raw token; the phone opens it and proves possession of the token,
// whose SHA-256 hash is all the server stores. No secret is persisted in clear.
//
// This module has NO network calls and NO Supabase import — it's the logic the
// live sync layer (added once credentials are configured) will build on, so it
// can be unit-tested without a backend and the app stays offline when unused.

import { SCAN_ITEM_STATUSES, type Result } from "../types";
import { BLANK_REVIEW_CONFIDENCE, REVIEW_CONFIDENCE } from "../scanner/omr-score";

export const SESSION_TTL_MS = 15 * 60 * 1000; // unpaired sessions expire in 15 min
export const MOBILE_PATH = "/smartscan/mobile"; // /smartscan/mobile/:sessionId?t=token

// Cross-env crypto (browser + Node/jsdom test runtime).
function subtleCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("Web Crypto unavailable in this environment");
  return c;
}

// URL-safe random token (default 32 bytes). Used once, never stored raw.
export function generatePairingToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  subtleCrypto().getRandomValues(buf);
  let s = "";
  for (const b of buf) s += b.toString(16).padStart(2, "0");
  return s;
}

// SHA-256 hex of the token. The session row stores only this hash.
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await subtleCrypto().subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Phone proves possession: hash the presented token, compare to the stored hash.
export async function verifyPairingToken(token: string, storedHash: string): Promise<boolean> {
  if (!token || !storedHash) return false;
  const h = await hashToken(token);
  // Constant-time-ish compare (length-guarded).
  if (h.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i += 1) diff |= h.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}

export function expiresAt(now = Date.now(), ttlMs = SESSION_TTL_MS): number {
  return now + ttlMs;
}

export function isExpired(expiresAtMs: number, now = Date.now()): boolean {
  return now >= expiresAtMs;
}

// Seconds left before a session expires (never negative) — for the PC countdown.
export function secondsLeft(expiresAtMs: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAtMs - now) / 1000));
}

// The QR carries only the session id and its one-time pairing secret. Assessment
// and tenant scope come back from the atomic claim RPC after the secret is
// consumed; placing them in the URL would make client input look authoritative.
export function buildPairingUrl(origin: string, sessionId: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${MOBILE_PATH}/${encodeURIComponent(sessionId)}?t=${encodeURIComponent(token)}`;
}

export function originHost(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  const host = originHost(origin);
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
}

export function normalizePairingOrigin(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

export interface ParsedPairing {
  sessionId: string;
  token: string;
}

// Reverse of buildPairingUrl — the phone reads the scanned/opened URL.
export function parsePairingUrl(url: string): ParsedPairing | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = u.pathname.match(new RegExp(`${MOBILE_PATH}/([^/]+)/?$`));
  const token = u.searchParams.get("t") ?? "";
  if (!m || !token) return null;
  return { sessionId: decodeURIComponent(m[1]), token };
}

// One raw detected item the phone reads off a sheet.
export interface ScanDetection {
  item: number;
  answer: string;
  status: string;
  confidence: number;
  fill?: number[];
  unreadableChoices?: number[];
}

// Minimum scan payload stored by the capability-checked phone ingress RPC.
// Pairing secrets and capabilities are transport arguments, never payload data.
export interface ScanBroadcast {
  // Stable idempotency key generated once when the phone accepts a capture.
  // Retries MUST reuse it; acknowledgements and scores echo it back.
  scanId: string;
  sessionId: string;
  assessmentId: string;
  learnerId: string;
  version: string;
  answerMap: Record<string, string>;
  detected: ScanDetection[];
  confidence: number;
  capturedAt: number;
  deviceName?: string;
  identitySource?: "provided" | "whole-frame" | "region-cascade" | "zone-rescue";
}

// Redacted score summary returned by the status RPC after the PC has persisted
// the authoritative provisional result. It contains no answers or credentials.
export interface ScoreBroadcast {
  scanId: string;
  receiptId: string;
  learnerId: string;
  raw: number;
  total: number;
  pct: number;
  correct: number;
  wrong: number;
  blank: number;
  mastery: string;
}

// The scored result the PC computes before attaching the durable receipt id.
export type ScoredSummary = Omit<ScoreBroadcast, "receiptId">;

export type ScanValidation =
  | { ok: true }
  | { ok: false; reason: string };

const SCAN_VERSIONS = new Set(["A", "B", "C", "D"]);
const SCAN_STATUSES = new Set<string>(SCAN_ITEM_STATUSES);
const SCAN_ANSWERS = new Set(["", "A", "B", "C", "D", "E"]);

// Runtime validation for the public Realtime boundary. TypeScript types vanish
// at runtime, so every field is bounded before the PC scores or persists it.
// This is defense in depth; the production replacement must repeat these checks
// in an authenticated server ingress.
export function validateScanBroadcast(
  value: unknown,
  expected: { sessionId: string; assessmentId: string },
): ScanValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "Malformed scan payload." };
  }
  const scan = value as Partial<ScanBroadcast>;
  if (typeof scan.scanId !== "string" || scan.scanId.length < 8 || scan.scanId.length > 128) {
    return { ok: false, reason: "Missing or invalid scan identity." };
  }
  if (scan.sessionId !== expected.sessionId) {
    return { ok: false, reason: "Scan session does not match this pairing." };
  }
  if (scan.assessmentId !== expected.assessmentId) {
    return { ok: false, reason: "Scan assessment does not match this pairing." };
  }
  if (typeof scan.learnerId !== "string" || scan.learnerId.length < 1 || scan.learnerId.length > 160) {
    return { ok: false, reason: "Missing or invalid learner identity." };
  }
  if (typeof scan.version !== "string" || !SCAN_VERSIONS.has(scan.version)) {
    return { ok: false, reason: "Missing or unsupported sheet version." };
  }
  if (!Number.isFinite(scan.confidence) || (scan.confidence as number) < 0 || (scan.confidence as number) > 1) {
    return { ok: false, reason: "Scan confidence is outside the valid range." };
  }
  if (!Number.isFinite(scan.capturedAt) || (scan.capturedAt as number) <= 0) {
    return { ok: false, reason: "Missing capture timestamp." };
  }
  if (
    scan.identitySource !== undefined &&
    !["provided", "whole-frame", "region-cascade", "zone-rescue"].includes(scan.identitySource)
  ) {
    return { ok: false, reason: "Invalid QR identity source." };
  }
  if (!Array.isArray(scan.detected) || scan.detected.length < 1 || scan.detected.length > 80) {
    return { ok: false, reason: "Detected item count is outside the supported range." };
  }
  if (!scan.answerMap || typeof scan.answerMap !== "object" || Array.isArray(scan.answerMap)) {
    return { ok: false, reason: "Missing answer map." };
  }
  const answerKeys = Object.keys(scan.answerMap);
  if (answerKeys.length !== scan.detected.length) {
    return { ok: false, reason: "Answer coverage is incomplete." };
  }
  for (let index = 0; index < scan.detected.length; index += 1) {
    const detection = scan.detected[index];
    const item = index + 1;
    if (!detection || detection.item !== item) {
      return { ok: false, reason: "Detected item numbers are incomplete or out of order." };
    }
    if (!SCAN_STATUSES.has(detection.status)) {
      return { ok: false, reason: `Item ${item} has an invalid detection status.` };
    }
    if (!Number.isFinite(detection.confidence) || detection.confidence < 0 || detection.confidence > 1) {
      return { ok: false, reason: `Item ${item} has invalid confidence.` };
    }
    const answer = String(detection.answer ?? "").toUpperCase();
    if (!SCAN_ANSWERS.has(answer) || String(scan.answerMap[String(item)] ?? "").toUpperCase() !== answer) {
      return { ok: false, reason: `Item ${item} has inconsistent answer data.` };
    }
    if (
      detection.fill !== undefined &&
      (!Array.isArray(detection.fill) || detection.fill.length > 5 || detection.fill.some((n) => !Number.isFinite(n) || n < 0 || n > 1))
    ) {
      return { ok: false, reason: `Item ${item} has invalid bubble evidence.` };
    }
    if (
      detection.unreadableChoices !== undefined &&
      (!Array.isArray(detection.unreadableChoices) ||
        detection.unreadableChoices.length > 5 ||
        detection.unreadableChoices.some((choice) => !Number.isInteger(choice) || choice < 0 || choice > 4) ||
        new Set(detection.unreadableChoices).size !== detection.unreadableChoices.length)
    ) {
      return { ok: false, reason: `Item ${item} has invalid unreadable-choice evidence.` };
    }
    if (detection.status === "unreadable" && (detection.unreadableChoices?.length ?? 0) === 0) {
      return { ok: false, reason: `Item ${item} is unreadable but has no affected-choice evidence.` };
    }
  }
  return { ok: true };
}

// Build the DB row the authenticated PC commits from a durable phone inbox row.
// Mirrors the phone's old direct-write payload; final scoring happens on the PC.
export function checkedRowFromScan(
  b: ScanBroadcast,
  ctx: { assessmentId: string; teacherUserId: string; schoolId?: string | null; sessionId?: string | null },
): CheckedResultRow {
  const low = b.detected
    .filter((d) => d.status === "unclear" || d.status === "multiple" || d.status === "unreadable" || (d.status === "selected" && d.confidence < REVIEW_CONFIDENCE) || (d.status === "blank" && d.confidence < BLANK_REVIEW_CONFIDENCE))
    .map((d) => d.item);
  const conf = Number.isFinite(b.confidence) ? b.confidence : 0;
  return {
    scan_id: b.scanId,
    assessment_id: ctx.assessmentId,
    teacher_user_id: ctx.teacherUserId,
    school_id: ctx.schoolId ?? null,
    learner_id: b.learnerId,
    learner_name: null,
    section_name: null,
    subject_name: null,
    score: 0,
    total_items: b.detected.length,
    percentage: 0,
    answer_map: b.answerMap,
    item_results: b.detected,
    qr_payload: {
      version: b.version,
      assessmentId: b.assessmentId,
      learnerId: b.learnerId,
      sessionId: b.sessionId,
      itemCount: b.detected.length,
      capturedAt: b.capturedAt,
    },
    scan_session_id: ctx.sessionId ?? null,
    scan_source: "phone_camera",
    scan_confidence: Math.round(conf * 100) / 100,
    low_confidence_items: low,
    corrected_by_teacher: false,
    review_status: "needs_review",
    is_official: false,
    checked_at: new Date().toISOString(),
  };
}

// Row payload for smartscan_checked_results (what the phone upserts). Kept in
// sync with 0001_smartscan_sync.sql. Upsert conflict target:
// (assessment_id, learner_id, teacher_user_id).
export interface CheckedResultRow {
  scan_id: string | null;
  assessment_id: string;
  teacher_user_id: string;
  school_id: string | null;
  learner_id: string;
  learner_name: string | null;
  section_name: string | null;
  subject_name: string | null;
  score: number;
  total_items: number;
  percentage: number;
  answer_map: Record<string, string>;
  item_results: unknown[];
  qr_payload: unknown;
  scan_session_id: string | null;
  scan_source: string;
  scan_confidence: number | null;
  low_confidence_items: number[];
  corrected_by_teacher: boolean;
  review_status: "needs_review" | "reviewed" | "discarded" | "finalized";
  is_official: boolean;
  checked_at: string;
}

// Apply the score calculated by the trusted PC scoring bridge before a cloud
// write. This prevents the raw phone placeholder (0/0) from becoming the
// account record. Server-side recalculation remains the production target.
export function scoredCheckedRow(
  row: CheckedResultRow,
  score: ScoredSummary,
): CheckedResultRow {
  if (score.learnerId !== row.learner_id || (score.scanId && row.scan_id !== score.scanId)) {
    throw new Error("Scored summary does not match the scan row.");
  }
  return {
    ...row,
    score: score.raw,
    percentage: score.pct,
    corrected_by_teacher: false,
    review_status: "needs_review",
    is_official: false,
    checked_at: new Date().toISOString(),
  };
}

export interface RowContext {
  teacherUserId: string;
  schoolId?: string | null;
  learnerName?: string | null;
  sectionName?: string | null;
  subjectName?: string | null;
  sessionId?: string | null;
  scanSource?: string;
}

// Map a locally-computed Result into the sync row. Low-confidence items are the
// scanned items the detector flagged unclear/multiple (teacher-review targets).
export function checkedResultRow(result: Result, ctx: RowContext): CheckedResultRow {
  const answerMap: Record<string, string> = {};
  result.answers.forEach((a) => {
    answerMap[a.itemId] = a.response;
  });
  const lowConf = (result.scanItems ?? [])
    .filter((s) => s.status === "unclear" || s.status === "multiple" || s.status === "unreadable" || (s.status === "selected" && s.confidence < REVIEW_CONFIDENCE) || (s.status === "blank" && s.confidence < BLANK_REVIEW_CONFIDENCE))
    .map((s) => s.itemNumber);
  return {
    scan_id: result.sourceScanId ?? null,
    assessment_id: result.assessmentId,
    teacher_user_id: ctx.teacherUserId,
    school_id: ctx.schoolId ?? null,
    learner_id: result.learnerId,
    learner_name: ctx.learnerName ?? null,
    section_name: ctx.sectionName ?? null,
    subject_name: ctx.subjectName ?? null,
    score: result.rawScore,
    total_items: result.itemScores.length,
    percentage: result.percentage,
    answer_map: answerMap,
    item_results: result.itemScores,
    qr_payload: null,
    scan_session_id: ctx.sessionId ?? null,
    scan_source: ctx.scanSource ?? "phone_camera",
    scan_confidence: result.scanConfidence,
    low_confidence_items: lowConf,
    corrected_by_teacher: result.reviewStatus === "reviewed" || result.reviewStatus === "finalized",
    review_status: result.reviewStatus === "auto" ? "reviewed" : result.reviewStatus,
    is_official: result.reviewStatus === "finalized" || result.finalizedAt != null,
    checked_at: new Date(result.updatedAt).toISOString(),
  };
}

// Guard for phase-I ("wrong assessment sheet"): the scanned QR's assessment must
// match the paired session's assessment.
export function assessmentMatches(sessionAssessmentId: string, scannedAssessmentId: string): boolean {
  return sessionAssessmentId === scannedAssessmentId;
}
