import { describe, expect, it } from "vitest";
import { scanQuality } from "../src/lib/scanner/scan-quality";

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

  it("pushes doubtful low-confidence scans into review with useful reasons", () => {
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
    expect(q.label).toBe("Review");
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
});
