import { describe, expect, it } from "vitest";
import type { Result } from "../src/lib/types";
import {
  assessmentMatches,
  buildPairingUrl,
  checkedResultRow,
  expiresAt,
  generatePairingToken,
  hashToken,
  isExpired,
  parsePairingUrl,
  secondsLeft,
  SESSION_TTL_MS,
  verifyPairingToken,
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
    expect(row.scan_session_id).toBe("sess_1");
    expect(row.scan_source).toBe("phone_camera");
    expect(row.checked_at).toBe(new Date(200).toISOString());
  });
});
