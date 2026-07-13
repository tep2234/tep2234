import { describe, expect, it } from "vitest";
import { upsertSyncedResult, type SyncedResultInput } from "../src/lib/scanner/scan-save";
import type { Item, QrAssessmentState, Result } from "../src/lib/types";

// The PC scores phone-synced answers against its OWN answer key. These tests
// pin that bridge: raw detected answers -> a real local Result.

function item(n: number, correct: string): Item {
  return {
    id: `i${n}`,
    assessmentId: "A1",
    itemNumber: n,
    type: "Multiple Choice",
    question: `Q${n}`,
    correctAnswer: correct,
    acceptedAnswers: [],
    points: 1,
    competency: "",
    difficulty: "Average",
    cognitiveLevel: "",
    choices: 4,
  };
}

function baseState(results: Result[] = []): QrAssessmentState {
  return {
    items: [item(1, "A"), item(2, "B")],
    answerKeys: { A1: { A: { i1: "A", i2: "B" } } },
    results,
  } as unknown as QrAssessmentState;
}

const input: SyncedResultInput = {
  scanId: "scan-id-0001",
  assessmentId: "A1",
  learnerId: "L1",
  version: "A",
  responses: { i1: "A", i2: "C" }, // 1 right, 1 wrong -> 50%
  scanItems: [
    { itemNumber: 1, detected: "A", status: "selected", confidence: 0.95 },
    { itemNumber: 2, detected: "C", status: "selected", confidence: 0.9 },
  ],
  confidence: 0.92,
  reviewStatus: "auto",
};

describe("upsertSyncedResult (phone -> PC scoring bridge)", () => {
  it("scores raw synced answers against the local key into a Result", () => {
    const { results, raw, total, pct } = upsertSyncedResult(baseState(), input);
    expect(raw).toBe(1);
    expect(total).toBe(2);
    expect(pct).toBe(50);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.assessmentId).toBe("A1");
    expect(r.learnerId).toBe("L1");
    expect(r.percentage).toBe(50);
    expect(r.masteryStatus).toBe("Needs Reinforcement");
    expect(r.source).toBe("scan");
    expect(r.reviewStatus).toBe("needs_review");
    expect(r.reviewed).toBe(false);
    expect(r.scanConfidence).toBe(0.92);
  });

  it("routes doubtful scans (low-confidence items) to needs_review", () => {
    const { results } = upsertSyncedResult(baseState(), { ...input, reviewStatus: "needs_review" });
    expect(results[0].reviewStatus).toBe("needs_review");
    expect(results[0].reviewed).toBe(false);
  });

  it("replaying the same submission id is idempotent and does not mutate answers", () => {
    const first = upsertSyncedResult(baseState(), input);
    const second = upsertSyncedResult(baseState(first.results), {
      ...input,
    });
    expect(second.results).toHaveLength(1);
    expect(second.results[0].id).toBe(first.results[0].id);
    expect(second.results[0].percentage).toBe(50);
    expect(second.results[0].auditLog).toHaveLength(1);
    expect(second.disposition).toBe("replayed");
  });

  it("rejects the same submission id when its answer payload changes", () => {
    const first = upsertSyncedResult(baseState(), input);
    const after = upsertSyncedResult(baseState(first.results), {
      ...input,
      responses: { i1: "A", i2: "B" },
    });
    expect(after.disposition).toBe("conflict");
    expect(after.reason).toBe("scan_id_payload_mismatch");
    expect(after.results[0].percentage).toBe(50);
  });

  it("requires an explicit decision before a different scan replaces any existing result", () => {
    const first = upsertSyncedResult(baseState(), input);
    const after = upsertSyncedResult(baseState(first.results), {
      ...input,
      scanId: "scan-id-0002",
      responses: { i1: "A", i2: "B" },
    });
    expect(after.disposition).toBe("conflict");
    expect(after.reason).toBe("existing_result_requires_decision");
    expect(after.results[0].percentage).toBe(50);
  });

  it("returns an OMR subtotal for mixed assessments instead of treating manual items as wrong", () => {
    const mixed = baseState();
    mixed.items.splice(1, 0, {
      ...item(3, ""),
      id: "essay",
      itemNumber: 2,
      type: "Essay",
      choices: 0,
      points: 5,
    });
    mixed.items[2] = { ...mixed.items[2], itemNumber: 3 };
    const outcome = upsertSyncedResult(mixed, input);
    expect(outcome.raw).toBe(1);
    expect(outcome.total).toBe(2);
    expect(outcome.pct).toBe(50);
    expect(outcome.results[0].totalScore).toBe(7);
    expect(outcome.results[0].reviewStatus).toBe("needs_review");
  });
});
