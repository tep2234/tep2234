import { describe, expect, it } from "vitest";
import { buildConsensusScan, type FillAccum } from "../src/lib/scanner/mobile-consensus";
import type { MobileScan } from "../src/lib/scanner/mobile-analyze";

function baseScan(): MobileScan {
  return {
    learnerId: "L1",
    version: "A",
    totalItems: 2,
    detected: [
      { item: 1, answer: "A", status: "selected", confidence: 0.95, fill: [0.8, 0.02, 0.02, 0.02] },
      { item: 2, answer: "", status: "blank", confidence: 0.95, fill: [0.02, 0.02, 0.02, 0.02] },
    ],
    confidence: 0.95,
    quality: {
      score: 90,
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
    geometry: {
      corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      area: 1,
      rotation: 0,
    },
    frameBrightness: 150,
    frameSharpness: 6,
    frameWidth: 1300,
  };
}

describe("phone temporal consensus", () => {
  it("never averages away unreadable choice evidence from any stable frame", () => {
    const acc: FillAccum = {
      key: "same-sheet",
      n: 4,
      fills: new Map([
        [1, [3.2, 0.08, 0.08, 0.08]],
        [2, [0.08, 0.08, 0.08, 0.08]],
      ]),
      unreadableChoices: new Map([
        [1, new Set([1])],
        [2, new Set()],
      ]),
      base: baseScan(),
    };

    const consensus = buildConsensusScan(acc);
    expect(consensus.detected[0]).toMatchObject({
      answer: "A",
      status: "unreadable",
      unreadableChoices: [1],
    });
    expect(consensus.detected[0].confidence).toBeLessThanOrEqual(0.15);
    expect(consensus.hasDoubt).toBe(true);
    expect(consensus.reviewCount).toBe(1);
    expect(consensus.quality).toMatchObject({ disposition: "review", autoEligible: false, label: "Review" });
    expect(consensus.quality.reasonCodes).toContain("BUBBLE_REGION_UNREADABLE");
  });
});
