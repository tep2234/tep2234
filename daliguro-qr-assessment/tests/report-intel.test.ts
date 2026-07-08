import { describe, expect, it } from "vitest";
import type { Result } from "../src/lib/types";
import {
  difficulty3,
  intelMastery,
  perfLevel,
  reliability,
  scoreDistribution,
  verificationOf,
} from "../src/lib/report-intel";
import { trustedResults } from "../src/lib/result-trust";

function result(p: Partial<Result>): Result {
  return {
    id: "R", assessmentId: "A1", learnerId: "L", version: "A", answers: [], itemScores: [],
    rawScore: 0, totalScore: 10, percentage: 0, masteryStatus: "Critical Support",
    reviewed: false, source: "scan", scanConfidence: null, reviewStatus: "auto",
    finalizedAt: null, scanItems: null, auditLog: [], createdAt: 0, updatedAt: 0,
    ...p,
  };
}

describe("intelMastery (90/75/50 bands)", () => {
  it("maps percentage to the dashboard mastery band", () => {
    expect(intelMastery(92)).toBe("Mastered");
    expect(intelMastery(80)).toBe("Approaching Mastery");
    expect(intelMastery(60)).toBe("Developing");
    expect(intelMastery(30)).toBe("Beginning");
  });
});

describe("perfLevel (MPS interpretation)", () => {
  it("classifies MPS against DepEd performance levels", () => {
    expect(perfLevel(95)).toBe("Outstanding");
    expect(perfLevel(80)).toBe("Very Satisfactory");
    expect(perfLevel(68.7)).toBe("Satisfactory");
    expect(perfLevel(40)).toBe("Fair");
    expect(perfLevel(10)).toBe("Poor");
  });
});

describe("difficulty3 (P-value buckets)", () => {
  it("Easy >= 0.70, Moderate 0.30–0.69, Difficult < 0.30", () => {
    expect(difficulty3(0.9)).toBe("Easy");
    expect(difficulty3(0.5)).toBe("Moderate");
    expect(difficulty3(0.2)).toBe("Difficult");
  });
});

describe("scoreDistribution", () => {
  it("buckets learners into the five % ranges", () => {
    const rows = [result({ percentage: 10 }), result({ percentage: 30 }), result({ percentage: 85 }), result({ percentage: 100 })];
    const d = scoreDistribution(rows);
    expect(d.find((b) => b.label === "0–19")?.count).toBe(1);
    expect(d.find((b) => b.label === "20–39")?.count).toBe(1);
    expect(d.find((b) => b.label === "80–100")?.count).toBe(2);
  });
});

describe("reliability metrics", () => {
  it("computes accuracy, auto-finalized, needs-review and never loses a result", () => {
    const rows = [
      result({ source: "scan", scanConfidence: 0.95, reviewStatus: "auto" }),
      result({ source: "scan", scanConfidence: 0.85, reviewStatus: "needs_review" }),
      result({ source: "scan", scanConfidence: 0.9, reviewStatus: "reviewed", finalizedAt: 1 }),
    ];
    const rel = reliability(rows);
    expect(rel.totalScanned).toBe(3);
    expect(rel.needsReview).toBe(1);
    expect(rel.finalized).toBe(1);
    expect(rel.reviewAdjusted).toBe(1);
    expect(rel.scanAccuracy).toBe(90); // (95+85+90)/3
    expect(rel.autoFinalizedPct).toBe(66.7); // 2 of 3 not needs_review
    expect(rel.resultsLost).toBe(0);
  });

  it("protects reports and analysis from unconfirmed doubtful answers", () => {
    const rows = [
      result({ id: "trusted", percentage: 90, reviewStatus: "auto" }),
      result({ id: "pending", percentage: 10, reviewStatus: "needs_review" }),
      result({ id: "reviewed", percentage: 80, reviewStatus: "reviewed" }),
    ];
    const trusted = trustedResults(rows);
    expect(trusted.map((r) => r.id)).toEqual(["trusted", "reviewed"]);
    expect(scoreDistribution(trusted).reduce((sum, b) => sum + b.count, 0)).toBe(2);
  });
});

describe("verificationOf", () => {
  it("maps result lifecycle to a verification label", () => {
    expect(verificationOf(result({ finalizedAt: 1 }))).toBe("Verified");
    expect(verificationOf(result({ reviewStatus: "needs_review" }))).toBe("Needs Review");
    expect(verificationOf(result({ reviewStatus: "reviewed" }))).toBe("Adjusted");
    expect(verificationOf(result({ reviewStatus: "auto" }))).toBe("Pending");
  });
});
