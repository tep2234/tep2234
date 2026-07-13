import { describe, expect, it } from "vitest";
import type { Learner } from "../src/lib/types";
import { buildQrPayload, buildSecurityToken, payloadChecksum, qrText } from "../src/lib/qr";
import { decodeQrPayload } from "../src/lib/qr-parse";

const ANSWER_KEY_FIELDS = [
  "correctAnswer",
  "acceptedAnswers",
  "answerKey",
  "answerKeys",
  "score",
  "rawScore",
  "percentage",
  "itemScores",
];

function learner(overrides: Partial<Learner> = {}): Learner {
  return {
    id: "L1",
    lrn: "123456789012",
    fullName: "Juan Dela Cruz",
    sex: "M",
    gradeLevel: "Grade 7",
    section: "Rizal",
    ...overrides,
  };
}

describe("buildQrPayload", () => {
  it("contains only the identity whitelist fields", () => {
    const payload = buildQrPayload("a1", learner(), "A", 20);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "assessmentId",
        "learnerId",
        "lrn",
        "section",
        "gradeLevel",
        "version",
        "securityToken",
        "n",
        "checksum",
      ].sort(),
    );
  });

  it("never includes any answer-key-shaped field, even by accident", () => {
    const payload = buildQrPayload("a1", learner(), "B", 20);
    const json = qrText(payload);
    ANSWER_KEY_FIELDS.forEach((field) => {
      expect(json.includes(`"${field}"`)).toBe(false);
    });
  });

  it("carries the learner's actual identity values through", () => {
    const l = learner({ id: "L42", lrn: "999", section: "Bonifacio", gradeLevel: "Grade 9" });
    const payload = buildQrPayload("assess-1", l, "C", 35);
    expect(payload).toMatchObject({
      assessmentId: "assess-1",
      learnerId: "L42",
      lrn: "999",
      section: "Bonifacio",
      gradeLevel: "Grade 9",
      version: "C",
      n: 35,
    });
  });

  it("binds the checksum to the complete per-sheet identity envelope", () => {
    const a = buildQrPayload("a1", learner(), "A", 10);
    const b = buildQrPayload("a1", learner(), "A", 10);
    expect(a.checksum).toBe(payloadChecksum(a.assessmentId, a.learnerId, a.version, a.securityToken, a.n));
    expect(a.securityToken).not.toBe(b.securityToken);
    expect(a.checksum).not.toBe(b.checksum);
    expect(a.checksum).not.toBe(buildQrPayload("a1", learner(), "B", 10).checksum);
  });

  it("round-trips through compact QR text back to a plain identity object", () => {
    const payload = buildQrPayload("a1", learner(), "A", 20);
    const parsed = decodeQrPayload(qrText(payload));
    expect(parsed).toEqual({ ok: true, payload });
  });
});

describe("buildSecurityToken", () => {
  it("produces different tokens per call (random suffix) but a stable seed prefix", () => {
    const t1 = buildSecurityToken("a1", "L1", "A");
    const t2 = buildSecurityToken("a1", "L1", "A");
    expect(t1).not.toBe(t2); // securityToken() includes randomness
    expect(t1.split("-")[0]).toBe(t2.split("-")[0]); // same seed deterministic part
  });
});
