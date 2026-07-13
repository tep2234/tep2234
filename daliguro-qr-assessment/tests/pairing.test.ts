import { describe, expect, it } from "vitest";
import type { Result } from "../src/lib/types";
import {
  assessmentMatches,
  buildPairingUrl,
  checkedResultRow,
  checkedRowFromScan,
  expiresAt,
  generatePairingToken,
  hashToken,
  isLoopbackOrigin,
  isExpired,
  normalizePairingOrigin,
  parsePairingUrl,
  scoredCheckedRow,
  type ScanBroadcast,
  secondsLeft,
  SESSION_TTL_MS,
  verifyPairingToken,
  validateScanBroadcast,
} from "../src/lib/sync/pairing";

describe("pairing token", () => {
  it("generates unique url-safe tokens", () => {
    const a = generatePairingToken();
    const b = generatePairingToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/);
    expect(a.length).toBe(64); // 32 bytes hex
  });

  it("hashes and verifies (SHA-256)", async () => {
    const t = generatePairingToken();
    const h = await hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPairingToken(t, h)).toBe(true);
    expect(await verifyPairingToken("wrong-token", h)).toBe(false);
    expect(await verifyPairingToken("", h)).toBe(false);
  });
});

describe("session expiry", () => {
  it("expires 15 minutes after creation by default", () => {
    const now = 1_000_000;
    const exp = expiresAt(now);
    expect(exp - now).toBe(SESSION_TTL_MS);
    expect(isExpired(exp, now)).toBe(false);
    expect(isExpired(exp, exp)).toBe(true);
    expect(isExpired(exp, exp + 1)).toBe(true);
  });
  it("counts seconds left, never negative", () => {
    const now = 1_000_000;
    expect(secondsLeft(now + 30_000, now)).toBe(30);
    expect(secondsLeft(now - 5_000, now)).toBe(0);
  });
});

describe("pairing URL build/parse", () => {
  it("round-trips sessionId + token", () => {
    const url = buildPairingUrl("https://app.example.com/", "sess_123", "tok_abc");
    expect(url).toBe("https://app.example.com/smartscan/mobile/sess_123?t=tok_abc");
    const parsed = parsePairingUrl(url);
    expect(parsed).toEqual({ sessionId: "sess_123", token: "tok_abc" });
  });
  it("rejects a non-pairing or tokenless URL", () => {
    expect(parsePairingUrl("https://app.example.com/smartscan/mobile/sess_1")).toBeNull();
    expect(parsePairingUrl("not a url")).toBeNull();
    expect(parsePairingUrl("https://app.example.com/other?t=x")).toBeNull();
  });

  it("does not trust assessment or tenant scope from the QR URL", () => {
    const url = buildPairingUrl("https://app.example.com", "sess_1", "tok_1");
    expect(url).not.toContain("assessment");
    expect(url).not.toContain("school");
    expect(parsePairingUrl(url)).toEqual({ sessionId: "sess_1", token: "tok_1" });
  });

  it("detects loopback origins that a phone cannot open", () => {
    expect(isLoopbackOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isLoopbackOrigin("http://localhost:5173")).toBe(true);
    expect(isLoopbackOrigin("http://192.168.1.22:5173")).toBe(false);
    expect(isLoopbackOrigin("https://demo.trycloudflare.com")).toBe(false);
  });

  it("normalizes teacher-entered phone pairing origins", () => {
    expect(normalizePairingOrigin("192.168.1.22:5173/")).toBe("http://192.168.1.22:5173");
    expect(normalizePairingOrigin("https://demo.trycloudflare.com/path")).toBe("https://demo.trycloudflare.com");
    expect(normalizePairingOrigin("")).toBe("");
  });
});

describe("checkedRowFromScan (phone broadcast → PC DB row)", () => {
  const scan: ScanBroadcast = {
    scanId: "scan-12345678",
    sessionId: "sess_1",
    assessmentId: "A1",
    learnerId: "L1",
    version: "A",
    answerMap: { "1": "B", "2": "" },
    detected: [
      { item: 1, answer: "B", status: "selected", confidence: 0.95 },
      { item: 2, answer: "", status: "unclear", confidence: 0.4 },
    ],
    confidence: 0.675,
    capturedAt: 1_000,
    deviceName: "iPhone",
  };

  it("maps a broadcast to the authenticated-PC row, flagging doubtful items", () => {
    const row = checkedRowFromScan(scan, { assessmentId: "A1", teacherUserId: "u1", sessionId: "sess_1" });
    expect(row.assessment_id).toBe("A1");
    expect(row.scan_id).toBe("scan-12345678");
    expect(row.teacher_user_id).toBe("u1");
    expect(row.learner_id).toBe("L1");
    expect(row.total_items).toBe(2);
    expect(row.answer_map).toEqual({ "1": "B", "2": "" });
    expect(row.qr_payload).toEqual({
      version: "A",
      assessmentId: "A1",
      learnerId: "L1",
      sessionId: "sess_1",
      itemCount: 2,
      capturedAt: 1_000,
    });
    expect(row.scan_confidence).toBe(0.68); // rounded to 2dp
    expect(row.low_confidence_items).toEqual([2]); // item 2 was unclear
    expect(row.scan_session_id).toBe("sess_1");
    expect(row.scan_source).toBe("phone_camera");
    expect(row.corrected_by_teacher).toBe(false);
    expect(row.review_status).toBe("needs_review");
    expect(row.is_official).toBe(false);
  });

  it("flags low-confidence selected answers from the phone as review items", () => {
    const row = checkedRowFromScan(
      {
        ...scan,
        answerMap: { "1": "B", "2": "C" },
        detected: [
          { item: 1, answer: "B", status: "selected", confidence: 0.95 },
          { item: 2, answer: "C", status: "selected", confidence: 0.55 },
        ],
        confidence: 0.75,
      },
      { assessmentId: "A1", teacherUserId: "u1", sessionId: "sess_1" },
    );
    expect(row.low_confidence_items).toEqual([2]);
  });

  it("applies the PC score before the row can become the cloud record", () => {
    const raw = checkedRowFromScan(scan, { assessmentId: "A1", teacherUserId: "u1", sessionId: "sess_1" });
    const scored = scoredCheckedRow(raw, {
      scanId: scan.scanId,
      learnerId: scan.learnerId,
      raw: 1,
      total: 2,
      pct: 50,
      correct: 1,
      wrong: 0,
      blank: 1,
      mastery: "Needs Reinforcement",
    });
    expect(scored.score).toBe(1);
    expect(scored.percentage).toBe(50);
    expect(scored.corrected_by_teacher).toBe(false);
    expect(scored.review_status).toBe("needs_review");
    expect(scored.is_official).toBe(false);
  });

  it("rejects mismatched sessions, assessments, and malformed item coverage at runtime", () => {
    expect(validateScanBroadcast(scan, { sessionId: "sess_1", assessmentId: "A1" })).toEqual({ ok: true });
    expect(validateScanBroadcast({ ...scan, sessionId: "other" }, { sessionId: "sess_1", assessmentId: "A1" })).toMatchObject({ ok: false });
    expect(validateScanBroadcast({ ...scan, assessmentId: "other" }, { sessionId: "sess_1", assessmentId: "A1" })).toMatchObject({ ok: false });
    expect(validateScanBroadcast({ ...scan, detected: [scan.detected[1], scan.detected[0]] }, { sessionId: "sess_1", assessmentId: "A1" })).toMatchObject({ ok: false });
  });
});

describe("assessmentMatches (wrong-sheet guard)", () => {
  it("accepts only a matching assessment id", () => {
    expect(assessmentMatches("A1", "A1")).toBe(true);
    expect(assessmentMatches("A1", "A2")).toBe(false);
  });
});

describe("checkedResultRow mapping", () => {
  const result: Result = {
    id: "R_1",
    assessmentId: "A1",
    learnerId: "L1",
    version: "A",
    answers: [
      { itemId: "i1", response: "B" },
      { itemId: "i2", response: "" },
    ],
    itemScores: [
      { itemId: "i1", itemNumber: 1, type: "Multiple Choice", points: 1, awarded: 1, correct: true, blank: false, manual: false, overridden: false, remarks: "" },
      { itemId: "i2", itemNumber: 2, type: "Multiple Choice", points: 1, awarded: 0, correct: false, blank: true, manual: false, overridden: false, remarks: "" },
    ],
    rawScore: 1,
    totalScore: 2,
    percentage: 50,
    masteryStatus: "Needs Reinforcement",
    reviewed: true,
    source: "scan",
    scanConfidence: 0.82,
    scanQuality: 82,
    reviewStatus: "reviewed",
    finalizedAt: null,
    scanItems: [
      { itemNumber: 1, detected: "B", status: "selected", confidence: 0.95 },
      { itemNumber: 2, detected: null, status: "unclear", confidence: 0.4 },
    ],
    auditLog: [],
    createdAt: 100,
    updatedAt: 200,
  };

  it("maps a local Result to the sync row with low-confidence items", () => {
    const row = checkedResultRow(result, {
      teacherUserId: "u_1",
      schoolId: "s_1",
      learnerName: "Juan Dela Cruz",
      sessionId: "sess_1",
    });
    expect(row.assessment_id).toBe("A1");
    expect(row.teacher_user_id).toBe("u_1");
    expect(row.learner_id).toBe("L1");
    expect(row.learner_name).toBe("Juan Dela Cruz");
    expect(row.score).toBe(1);
    expect(row.total_items).toBe(2);
    expect(row.percentage).toBe(50);
    expect(row.answer_map).toEqual({ i1: "B", i2: "" });
    expect(row.scan_confidence).toBe(0.82);
    expect(row.low_confidence_items).toEqual([2]); // item 2 was unclear
    expect(row.corrected_by_teacher).toBe(true);
    expect(row.review_status).toBe("reviewed");
    expect(row.is_official).toBe(false);
    expect(row.scan_session_id).toBe("sess_1");
    expect(row.scan_source).toBe("phone_camera");
    expect(row.checked_at).toBe(new Date(200).toISOString());
  });

  it("maps low-confidence selected local scan items to the sync review list", () => {
    const row = checkedResultRow(
      {
        ...result,
        scanItems: [
          { itemNumber: 1, detected: "B", status: "selected", confidence: 0.95 },
          { itemNumber: 2, detected: "C", status: "selected", confidence: 0.55 },
        ],
      },
      { teacherUserId: "u_1" },
    );
    expect(row.low_confidence_items).toEqual([2]);
  });
});
