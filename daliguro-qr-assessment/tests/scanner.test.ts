import { describe, expect, it } from "vitest";
import type { Learner } from "../src/lib/types";
import { validateQrPayload } from "../src/lib/scanner/qr-payload";

function learner(overrides: Partial<Learner> = {}): Learner {
  return {
    id: "L1",
    lrn: "123",
    fullName: "Ana",
    sex: "F",
    gradeLevel: "Grade 7",
    section: "Rizal",
    ...overrides,
  };
}

const opts = {
  activeAssessmentId: "a1",
  learners: [learner()],
};

function validPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    assessmentId: "a1",
    learnerId: "L1",
    lrn: "123",
    section: "Rizal",
    gradeLevel: "Grade 7",
    version: "A",
    securityToken: "ABCD-1234",
    ...overrides,
  });
}

describe("validateQrPayload", () => {
  it("accepts a well-formed identity-only payload", () => {
    const result = validateQrPayload(validPayload(), opts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.learnerId).toBe("L1");
      expect(result.payload.version).toBe("A");
    }
  });

  it("rejects invalid JSON", () => {
    const result = validateQrPayload("{not json", opts);
    expect(result).toEqual({ ok: false, error: "Invalid QR format." });
  });

  it("rejects a missing assessmentId", () => {
    const result = validateQrPayload(
      validPayload({ assessmentId: undefined }),
      opts,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a missing learnerId", () => {
    const result = validateQrPayload(validPayload({ learnerId: undefined }), opts);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing lrn", () => {
    const result = validateQrPayload(validPayload({ lrn: undefined }), opts);
    expect(result.ok).toBe(false);
  });

  it("rejects a payload for a different assessment", () => {
    const result = validateQrPayload(
      validPayload({ assessmentId: "a2" }),
      opts,
    );
    expect(result).toEqual({
      ok: false,
      error: "This QR belongs to another assessment.",
    });
  });

  it("rejects an unknown learner", () => {
    const result = validateQrPayload(
      validPayload({ learnerId: "ghost" }),
      opts,
    );
    expect(result).toEqual({
      ok: false,
      error: "Learner was not found in this device.",
    });
  });

  it("rejects an invalid version", () => {
    const result = validateQrPayload(validPayload({ version: "Z" }), opts);
    expect(result).toEqual({ ok: false, error: "Invalid test version." });
  });

  it("rejects a payload carrying an answer key", () => {
    const result = validateQrPayload(
      validPayload({ answerKey: { i1: "A" } }),
      opts,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a payload carrying a correctAnswer", () => {
    const result = validateQrPayload(
      validPayload({ correctAnswer: "A" }),
      opts,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a payload carrying acceptedAnswers", () => {
    const result = validateQrPayload(
      validPayload({ acceptedAnswers: ["A"] }),
      opts,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a payload carrying a score", () => {
    const result = validateQrPayload(validPayload({ score: 90 }), opts);
    expect(result.ok).toBe(false);
  });

  it("rejects a payload carrying itemScores", () => {
    const result = validateQrPayload(
      validPayload({ itemScores: [{ itemId: "i1", awarded: 1 }] }),
      opts,
    );
    expect(result.ok).toBe(false);
  });
});
