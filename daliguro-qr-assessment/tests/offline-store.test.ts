import { beforeEach, describe, expect, it } from "vitest";
import { emptyState } from "../src/lib/types";
import {
  clearState,
  exportBackup,
  importBackup,
  loadState,
  saveState,
} from "../src/lib/offline-store";

beforeEach(async () => {
  await clearState();
});

describe("offline-store (IndexedDB path via fake-indexeddb)", () => {
  it("round-trips a saved state through loadState", async () => {
    const state = emptyState();
    state.learners.push({
      id: "L1",
      lrn: "1",
      fullName: "Ana",
      sex: "F",
      gradeLevel: "Grade 7",
      section: "Rizal",
    });
    await saveState(state);
    const loaded = await loadState();
    expect(loaded.learners).toHaveLength(1);
    expect(loaded.learners[0].fullName).toBe("Ana");
  });

  it("loadState returns a fresh emptyState when nothing has been saved", async () => {
    const loaded = await loadState();
    expect(loaded).toEqual(emptyState());
  });

  it("clearState wipes a previously saved state back to empty", async () => {
    const state = emptyState();
    state.assessments.push({
      id: "a1",
      title: "Quiz",
      subject: "Math",
      gradeLevel: "Grade 7",
      section: "Rizal",
      schoolYear: "2025-2026",
      term: "First",
      component: "Written Work",
      versions: ["A"],
      teacherName: "T",
      createdAt: 0,
      updatedAt: 0,
    });
    await saveState(state);
    await clearState();
    const loaded = await loadState();
    expect(loaded.assessments).toHaveLength(0);
  });

  it("normalizes a partial/corrupt persisted shape instead of crashing", async () => {
    // Simulate a corrupt/old record by writing directly through saveState
    // with a state missing fields, then verify loadState backfills them.
    const partial = { learners: [] } as unknown as ReturnType<typeof emptyState>;
    await saveState(partial);
    const loaded = await loadState();
    expect(loaded).toEqual(emptyState());
  });
});

describe("exportBackup / importBackup", () => {
  it("round-trips a state to JSON and back", () => {
    const state = emptyState();
    state.results.push({
      id: "r1",
      assessmentId: "a1",
      learnerId: "L1",
      version: "A",
      answers: [],
      itemScores: [],
      rawScore: 5,
      totalScore: 10,
      percentage: 50,
      masteryStatus: "Needs Reinforcement",
      reviewed: false,
      source: "manual",
      scanConfidence: null,
      scanQuality: null,
      reviewStatus: "reviewed",
      finalizedAt: null,
      scanItems: null,
      auditLog: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const json = exportBackup(state);
    const restored = importBackup(json);
    expect(restored).toEqual(state);
  });

  it("migrates a pre-SmartScan result: recomputes mastery and fills lifecycle fields", () => {
    const legacy = {
      results: [
        {
          id: "r1",
          assessmentId: "a1",
          learnerId: "L1",
          version: "A",
          answers: [],
          itemScores: [],
          rawScore: 7,
          totalScore: 10,
          percentage: 70,
          masteryStatus: "Needs Improvement", // old band name
          reviewed: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const restored = importBackup(JSON.stringify(legacy));
    expect(restored.results[0].masteryStatus).toBe("Near Mastery");
    expect(restored.results[0].reviewStatus).toBe("reviewed");
    expect(restored.results[0].source).toBe("manual");
    expect(restored.results[0].scanConfidence).toBeNull();
    expect(restored.results[0].auditLog).toEqual([]);
  });

  it("quarantines a present invalid lifecycle value instead of trusting it", () => {
    const state = emptyState();
    state.results.push({
      id: "r-invalid",
      assessmentId: "a1",
      learnerId: "L1",
      version: "A",
      answers: [],
      itemScores: [],
      rawScore: 0,
      totalScore: 1,
      percentage: 0,
      masteryStatus: "Critical Support",
      reviewed: true,
      source: "scan",
      scanConfidence: 1,
      scanQuality: 100,
      reviewStatus: "silently_accepted" as never,
      finalizedAt: null,
      scanItems: [],
      auditLog: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const restored = importBackup(JSON.stringify(state));
    expect(restored.results[0].reviewStatus).toBe("needs_review");
  });

  it("normalizes a backup missing fields rather than throwing", () => {
    const restored = importBackup(JSON.stringify({ assessments: [] }));
    expect(restored).toEqual(emptyState());
  });

  it("importBackup propagates a JSON parse error for genuinely invalid input", () => {
    expect(() => importBackup("{not json")).toThrow();
  });
});
