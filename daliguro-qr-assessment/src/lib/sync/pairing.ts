// Phone↔PC pairing primitives (pure, framework-free, testable offline).
// The PC creates a session, shows a pairing QR that encodes the session URL +
// a one-time raw token; the phone opens it and proves possession of the token,
// whose SHA-256 hash is all the server stores. No secret is persisted in clear.
//
// This module has NO network calls and NO Supabase import — it's the logic the
// live sync layer (added once credentials are configured) will build on, so it
// can be unit-tested without a backend and the app stays offline when unused.

import type { Result } from "../types";

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

// The URL encoded into the pairing QR shown on the PC.
export function buildPairingUrl(origin: string, sessionId: string, token: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${MOBILE_PATH}/${encodeURIComponent(sessionId)}?t=${encodeURIComponent(token)}`;
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

// Row payload for smartscan_checked_results (what the phone upserts). Kept in
// sync with 0001_smartscan_sync.sql. Upsert conflict target:
// (assessment_id, learner_id, teacher_user_id).
export interface CheckedResultRow {
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
  checked_at: string;
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
    .filter((s) => s.status === "unclear" || s.status === "multiple")
    .map((s) => s.itemNumber);
  return {
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
    checked_at: new Date(result.updatedAt).toISOString(),
  };
}

// Guard for phase-I ("wrong assessment sheet"): the scanned QR's assessment must
// match the paired session's assessment.
export function assessmentMatches(sessionAssessmentId: string, scannedAssessmentId: string): boolean {
  return sessionAssessmentId === scannedAssessmentId;
}
