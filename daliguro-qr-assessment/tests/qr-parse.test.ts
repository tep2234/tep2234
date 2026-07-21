import { describe, expect, it } from "vitest";
import { buildQrPayload, qrText, qrTextCompact } from "../src/lib/qr";
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

  it("rejects a legacy QR that carries no checksum or sheet token", () => {
    const res = parseQrPayload(
      JSON.stringify({ assessmentId: "A1", learnerId: "L1", version: "A" }),
      ctx(),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/item count|token|checksum|reprint/i);
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

  it("rejects a QR with a missing version instead of silently changing versions", () => {
    const res = parseQrPayload(
      JSON.stringify({ assessmentId: "A1", learnerId: "L1" }),
      ctx({ versions: ["B", "C"] }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/version|reprint/i);
  });

  it("rejects a JSON array (not an identity object)", () => {
    expect(parseQrPayload("[1,2,3]", ctx()).ok).toBe(false);
  });
});

describe("parseQrPayload — V3 compact format", () => {
  const v3 = () => qrTextCompact(buildQrPayload("A1", learner(), "B", 10));

  it("accepts a valid V3 code and resolves the same identity as v2", () => {
    const res = parseQrPayload(v3(), ctx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.assessmentId).toBe("A1");
      expect(res.payload.learnerId).toBe("L1");
      expect(res.payload.version).toBe("B");
      expect(res.payload.n).toBe(10);
      // identity-only by construction: no PII travels in the QR
      expect(res.payload.lrn).toBe("");
      expect(res.payload.section).toBe("");
    }
  });

  it("rejects a V3 code whose checksum no longer matches (damaged/altered)", () => {
    const tampered = v3().replace("|L1|", "|L2|");
    const res = parseQrPayload(tampered, ctx({ hasLearner: () => true }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/integrity/i);
  });

  it("rejects a V3 code with a damaged field count", () => {
    const res = parseQrPayload("DG3|A1|L1|B", ctx());
    expect(res.ok).toBe(false);
  });

  it("keeps a unique sheet token in the compact payload", () => {
    const first = qrTextCompact(buildQrPayload("A1", learner(), "A", 10));
    const second = qrTextCompact(buildQrPayload("A1", learner(), "A", 10));
    expect(first).not.toBe(second);
    const decoded = parseQrPayload(first, ctx());
    expect(decoded.ok && decoded.payload.securityToken.length).toBeGreaterThanOrEqual(12);
  });

  it("rejects a V3 code for a version not enabled on the assessment", () => {
    const text = qrTextCompact(buildQrPayload("A1", learner(), "D", 10));
    const res = parseQrPayload(text, ctx({ versions: ["A", "B"] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/version/i);
  });

  it("rejects a V3 code for an unknown learner instead of guessing", () => {
    const text = qrTextCompact(buildQrPayload("A1", learner({ id: "L9" }), "A", 10));
    const res = parseQrPayload(text, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not found/i);
  });

  it("falls back to the v2 JSON payload when an id contains the field separator", () => {
    const text = qrTextCompact(buildQrPayload("A|1", learner(), "A", 10));
    expect(text.startsWith("{")).toBe(true);
  });
});
