import { describe, expect, it } from "vitest";
import { scanQuality } from "../src/lib/scanner/scan-quality";
import {
  evaluateQualityGates,
  QUALITY_GATE_THRESHOLDS,
} from "../src/lib/scanner/quality-gates";

describe("scanQuality", () => {
  it("rates a clean scan as excellent", () => {
    const q = scanQuality({
      confidence: 0.96,
      brightness: 150,
      sharpness: 6,
      aligned: true,
      doubtfulItems: 0,
      shadowLevel: 12,
      tiltAngle: 1,
      bubbleDarkness: 0.5,
    });
    expect(q.label).toBe("Excellent");
    expect(q.score).toBeGreaterThanOrEqual(88);
    expect(q.issues).toHaveLength(0);
  });

  it("requires a retake when doubtful low-confidence scans also fail hard light/focus gates", () => {
    const q = scanQuality({
      confidence: 0.62,
      brightness: 64,
      sharpness: 1.8,
      aligned: true,
      doubtfulItems: 2,
      shadowLevel: 20,
      tiltAngle: 2,
      bubbleDarkness: 0.3,
    });
    expect(q.label).toBe("Retake");
    expect(q.autoEligible).toBe(false);
    expect(q.issues).toContain("low light");
    expect(q.issues).toContain("soft focus");
    expect(q.issues).toContain("weak bubble confidence");
    expect(q.issues).toContain("2 doubtful marks");
  });

  it("requires retake for severe blur, shadow, tilt, and weak print contrast", () => {
    const q = scanQuality({
      confidence: 0.48,
      brightness: 50,
      sharpness: 1.1,
      aligned: true,
      doubtfulItems: 5,
      shadowLevel: 72,
      tiltAngle: 16,
      bubbleDarkness: 0.1,
    });
    expect(q.label).toBe("Retake");
    expect(q.issues).toContain("uneven shadow");
    expect(q.issues).toContain("sheet tilted");
    expect(q.issues).toContain("print or mark contrast too weak");
  });

  it("routes a localized unreadable bubble to mandatory review without auto-eligibility", () => {
    const q = scanQuality({
      confidence: 0.9,
      brightness: 150,
      sharpness: 6,
      aligned: true,
      doubtfulItems: 1,
      shadowLevel: 5,
      tiltAngle: 0,
      bubbleDarkness: 0.5,
      obscuredBubbleCount: 1,
    });
    expect(q.disposition).toBe("review");
    expect(q.label).toBe("Review");
    expect(q.autoEligible).toBe(false);
    expect(q.reasonCodes).toContain("BUBBLE_REGION_UNREADABLE");
    expect(q.hardBlockers).not.toContain("BUBBLE_REGION_UNREADABLE");
  });
});

describe("absolute sharpness gate is unchanged and resolution-agnostic", () => {
  // The resolution-normalization fix touches only the RELATIVE frame-stability
  // ratio. The absolute blur gate must stay at 2.4 and reject genuine blur on
  // its own — a large capture width can never buy an artificial pass here.
  const clean = {
    aligned: true,
    brightness: 150,
    shadowLevel: 5,
    tiltAngle: 1,
    bubbleDarkness: 0.5,
    glareLevel: 1,
  };

  it("keeps the documented 2.4 minimum", () => {
    expect(QUALITY_GATE_THRESHOLDS.minimumSharpness).toBe(2.4);
  });

  it("rejects an otherwise-perfect capture just below 2.4", () => {
    const result = evaluateQualityGates({ ...clean, sharpness: 2.39 });
    expect(result.disposition).toBe("retake");
    expect(result.hardBlockers).toContain("IMAGE_TOO_BLURRY");
  });

  it("accepts the same capture just above 2.4 regardless of resolution", () => {
    const result = evaluateQualityGates({ ...clean, sharpness: 2.41 });
    expect(result.reasonCodes).not.toContain("IMAGE_TOO_BLURRY");
  });

  it("rejects a genuinely blurred final still on its raw sharpness value", () => {
    // A high-resolution but defocused capture reads low on sharpnessOf(); the
    // gate sees the raw value, so blur is caught no matter the pixel count.
    const result = evaluateQualityGates({ ...clean, sharpness: 1.8 });
    expect(result.disposition).toBe("retake");
    expect(result.hardBlockers).toContain("IMAGE_TOO_BLURRY");
  });
});
