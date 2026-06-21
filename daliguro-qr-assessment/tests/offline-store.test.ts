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
      masteryStatus: "Critical Intervention",
      reviewed: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const json = exportBackup(state);
    const restored = importBackup(json);
    expect(restored).toEqual(state);
  });

  it("normalizes a backup missing fields rather than throwing", () => {
    const restored = importBackup(JSON.stringify({ assessments: [] }));
    expect(restored).toEqual(emptyState());
  });

  it("importBackup propagates a JSON parse error for genuinely invalid input", () => {
    expect(() => importBackup("{not json")).toThrow();
  });
});
