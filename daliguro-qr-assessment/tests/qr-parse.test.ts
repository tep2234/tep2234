import { describe, expect, it } from "vitest";
import { buildQrPayload, qrText } from "../src/lib/qr";
import { parseQrPayload, type QrParseContext } from "../src/lib/qr-parse";
import type { Learner } from "../src/lib/types";

function learner(overrides: Partial<Learner> = {}): Learner {
  return {
    id: "L1",
    lrn: "123456789012",
    fullName: "Juan Dela Cruz",
    sex: "M",
    gradeLevel: "11",
    section: "STEM-A",
    ...overrides,
  };
}

function ctx(overrides: Partial<QrParseContext> = {}): QrParseContext {
  return {
    activeAssessmentId: "A1",
    hasLearner: (id) => id === "L1",
    versions: ["A", "B"],
    ...overrides,
  };
}

describe("parseQrPayload", () => {
  it("accepts a valid identity QR and selects its version", () => {
    const text = qrText(buildQrPayload("A1", learner(), "B", 10));
    const res = parseQrPayload(text, ctx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.learnerId).toBe("L1");
      expect(res.payload.version).toBe("B");
      expect(res.payload.n).toBe(10);
    }
  });

  it("rejects a QR whose checksum no longer matches its identity (tampered)", () => {
    const good = buildQrPayload("A1", learner(), "A", 10);
    const tampered = JSON.stringify({ ...good, learnerId: "L2" });
    const res = parseQrPayload(tampered, ctx({ hasLearner: () => true }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/integrity/i);
  });

  it("still accepts an old QR that carries no checksum", () => {
    const res = parseQrPayload(
      JSON.stringify({ assessmentId: "A1", learnerId: "L1", version: "A" }),
      ctx(),
    );
    expect(res.ok).toBe(true);
  });

  it("rejects non-JSON text", () => {
    const res = parseQrPayload("not a qr", ctx());
    expect(res.ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(parseQrPayload("   ", ctx()).ok).toBe(false);
  });

  it("rejects a QR for a different assessment", () => {
    const text = qrText(buildQrPayload("OTHER", learner(), "A", 10));
    const res = parseQrPayload(text, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/different assessment/i);
  });

  it("rejects a QR whose learner is unknown on this device", () => {
    const text = qrText(buildQrPayload("A1", learner({ id: "GHOST" }), "A", 10));
    const res = parseQrPayload(text, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not found/i);
  });

  it("rejects any QR carrying answer-key-shaped fields", () => {
    const hostile = JSON.stringify({
      assessmentId: "A1",
      learnerId: "L1",
      version: "A",
      answerKey: { "1": "A", "2": "B" },
    });
    const res = parseQrPayload(hostile, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/answer\/score data/i);
  });

  it("rejects a QR carrying a score field", () => {
    const hostile = JSON.stringify({
      assessmentId: "A1",
      learnerId: "L1",
      version: "A",
      score: 42,
    });
    expect(parseQrPayload(hostile, ctx()).ok).toBe(false);
  });

  it("falls back to the first enabled version when version is missing/unknown", () => {
    const res = parseQrPayload(
      JSON.stringify({ assessmentId: "A1", learnerId: "L1" }),
      ctx({ versions: ["B", "C"] }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.version).toBe("B");
  });

  it("rejects a JSON array (not an identity object)", () => {
    expect(parseQrPayload("[1,2,3]", ctx()).ok).toBe(false);
  });
});
