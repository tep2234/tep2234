import { describe, expect, it } from "vitest";
import {
  verifyFinalCaptureStability,
  verifyFinalMobileCapture,
  type StableCaptureExpectation,
} from "../src/lib/scanner/final-capture";
import {
  advanceFrameStability,
  normalizedSheetGeometry,
  type FrameStabilityState,
} from "../src/lib/scanner/frame-stability";
import type {
  FrameAnalysis,
  MobileScan,
} from "../src/lib/scanner/mobile-analyze";

const identity = "signed-looking-sheet-identity";
const geometry = normalizedSheetGeometry(
  [
    { x: 100, y: 100 },
    { x: 700, y: 100 },
    { x: 700, y: 1000 },
    { x: 100, y: 1000 },
  ],
  800,
  1100,
)!;

function expectation(): StableCaptureExpectation {
  let state: FrameStabilityState | null = null;
  for (let frame = 1; frame <= 4; frame += 1) {
    state = advanceFrameStability(state, {
      identity,
      geometry,
      luminance: 180,
      sharpness: 6,
      observedAt: frame * 100,
      freshIdentity: true,
    }).state;
  }
  return { identity, state: state! };
}

function scan(answer = "A", confidence = 0.95): MobileScan {
  const detected = [
    { item: 1, answer, status: "selected" as const, confidence, fill: [0.7, 0.02, 0.01, 0.01] },
  ];
  return {
    learnerId: "learner-1",
    version: "A",
    totalItems: 1,
    detected,
    confidence,
    quality: {
      score: 95,
      label: "Excellent",
      issues: [],
      disposition: "accept",
      autoEligible: true,
      reasonCodes: [],
      hardBlockers: [],
    },
    hasDoubt: false,
    reviewCount: 0,
    signature: "before",
    geometry,
    frameBrightness: 180,
    frameSharpness: 6,
    frameWidth: 1300,
  };
}

function analysis(finalScan: MobileScan | null, qrText: string | null = identity): FrameAnalysis {
  return {
    qrText,
    qrSource: qrText ? "whole-frame" : null,
    result: {
      scan: finalScan,
      status: finalScan ? "ready" : "quality_retake",
      qrVisible: qrText !== null,
      markersVisible: finalScan !== null,
      brightness: finalScan?.frameBrightness ?? 250,
      aligned: finalScan !== null,
      message: finalScan ? "Hold steady" : "Reduce glare and retake.",
    },
  };
}

describe("final capture stability boundary", () => {
  it("rejects a different QR even after four stable preview frames", () => {
    const result = verifyFinalCaptureStability(expectation(), {
      identity: "different-sheet",
      geometry,
      luminance: 180,
      sharpness: 6,
      observedAt: 500,
    });
    expect(result).toMatchObject({ ok: false, code: "FINAL_IDENTITY_CHANGED" });
  });

  it("rejects final geometry or focus changes instead of trusting preview readiness", () => {
    const result = verifyFinalCaptureStability(expectation(), {
      identity,
      geometry,
      luminance: 180,
      sharpness: 1,
      observedAt: 500,
    });
    expect(result).toMatchObject({ ok: false, code: "FINAL_CAPTURE_UNSTABLE" });
  });

  // Builds a stable preview baseline at a known capture width so the width-aware
  // path through verifyFinalCaptureStability is exercised end-to-end (not just
  // advanceFrameStability in isolation).
  function widthAwareExpectation(previewWidth: number): StableCaptureExpectation {
    let state: FrameStabilityState | null = null;
    for (let frame = 1; frame <= 4; frame += 1) {
      state = advanceFrameStability(state, {
        identity,
        geometry,
        luminance: 180,
        sharpness: 6,
        sharpnessWidth: previewWidth,
        observedAt: frame * 100,
        freshIdentity: true,
      }).state;
    }
    return { identity, state: state! };
  }

  it("accepts a high-res final still against a low-res preview baseline (resolution-normalized)", () => {
    const previewWidth = 1300;
    const finalWidth = 2200;
    const result = verifyFinalCaptureStability(widthAwareExpectation(previewWidth), {
      identity,
      geometry,
      luminance: 180,
      // Same physical sheet reads lower on the higher-res still (~3.5).
      sharpness: 6 * (previewWidth / finalWidth),
      sharpnessWidth: finalWidth,
      observedAt: 500,
    });
    expect(result.ok).toBe(true);
  });

  it("still rejects a genuinely blurred high-res final still through the full path", () => {
    const result = verifyFinalCaptureStability(widthAwareExpectation(1300), {
      identity,
      geometry,
      luminance: 180,
      sharpness: 1.8, // genuine defocus; normalized 3.05 vs 6 -> still too far
      sharpnessWidth: 2200,
      observedAt: 500,
    });
    expect(result).toMatchObject({ ok: false, code: "FINAL_CAPTURE_UNSTABLE" });
  });
});

describe("phone final still verification", () => {
  it("fails closed when the final still no longer passes the full scanner pipeline", () => {
    const result = verifyFinalMobileCapture(expectation(), scan(), analysis(null), 500);
    expect(result).toMatchObject({ ok: false, code: "FINAL_ANALYSIS_REJECTED" });
  });

  it("rejects a learner/version/item scope change", () => {
    const changed = { ...scan(), learnerId: "learner-2" };
    const result = verifyFinalMobileCapture(expectation(), scan(), analysis(changed), 500);
    expect(result).toMatchObject({ ok: false, code: "FINAL_SCAN_SCOPE_CHANGED" });
  });

  it("forces review when the final still disagrees with stable preview answers", () => {
    const result = verifyFinalMobileCapture(expectation(), scan("A"), analysis(scan("B")), 500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidenceDisagreed).toBe(true);
    expect(result.scan.detected[0]).toMatchObject({ answer: "B", status: "multiple" });
    expect(result.scan.quality.disposition).toBe("review");
    expect(result.scan.quality.autoEligible).toBe(false);
    expect(result.scan.quality.reasonCodes).toContain("FRAME_EVIDENCE_DISAGREEMENT");
    expect(result.scan.hasDoubt).toBe(true);
  });

  it("preserves the least-confident stable evidence even when the answer agrees", () => {
    const result = verifyFinalMobileCapture(
      expectation(),
      scan("A", 0.5),
      analysis(scan("A", 0.98)),
      500,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidenceDisagreed).toBe(false);
    expect(result.scan.detected[0].confidence).toBe(0.5);
    expect(result.scan.quality.disposition).toBe("review");
    expect(result.scan.quality.reasonCodes).toContain("DOUBTFUL_MARKS");
  });

  it("accepts a stable matching final still without weakening its quality result", () => {
    const result = verifyFinalMobileCapture(expectation(), scan(), analysis(scan()), 500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidenceDisagreed).toBe(false);
    expect(result.scan.quality.disposition).toBe("accept");
    expect(result.scan.hasDoubt).toBe(false);
  });
});
