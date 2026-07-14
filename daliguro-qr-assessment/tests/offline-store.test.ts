import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState } from "../src/lib/types";
import {
  clearAllLocalData,
  clearState,
  exportBackup,
  getEvidence,
  importBackup,
  loadState,
  LocalDataClearError,
  saveEvidence,
  saveState,
} from "../src/lib/offline-store";

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await clearState();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

describe("clearAllLocalData", () => {
  it("purges every DALIguro-owned local artifact but preserves unrelated origin data", async () => {
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
    await saveEvidence("result-1", "data:image/jpeg;base64,evidence");

    localStorage.setItem("daliguro_qr_active_assessment_id", "assessment-1");
    localStorage.setItem("daliguro_phone_scanner_origin", "https://phone.example");
    localStorage.setItem("daliguro_scanner_certification_assessment-1", "certification");
    localStorage.setItem("daliguro_report_meta_assessment-1", "report metadata");
    localStorage.setItem("smartscan_outbox_session-1", "queued scan");
    localStorage.setItem("daliguro_future_artifact", "future app data");
    localStorage.setItem("unrelated_app_preference", "keep me");
    sessionStorage.setItem("smartscan_temporary_frame", "temporary scan data");
    sessionStorage.setItem("unrelated_session", "keep me too");

    const cacheNames = new Set(["daliguro-qr-v2", "unrelated-cache"]);
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => Array.from(cacheNames)),
      delete: vi.fn(async (name: string) => cacheNames.delete(name)),
    });

    expect(await getEvidence("result-1")).toContain("evidence");
    await clearAllLocalData();

    expect(await loadState()).toEqual(emptyState());
    expect(await getEvidence("result-1")).toBeNull();
    expect(Object.keys(localStorage).filter((key) => /^(daliguro_|smartscan_)/.test(key))).toEqual([]);
    expect(Object.keys(sessionStorage).filter((key) => /^(daliguro_|smartscan_)/.test(key))).toEqual([]);
    expect(localStorage.getItem("unrelated_app_preference")).toBe("keep me");
    expect(sessionStorage.getItem("unrelated_session")).toBe("keep me too");
    expect(cacheNames).toEqual(new Set(["unrelated-cache"]));
  });

  it("rejects with the failed area when a browser refuses deletion", async () => {
    localStorage.setItem("daliguro_blocked_artifact", "must not be reported as deleted");
    const originalRemoveItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (this === localStorage && key === "daliguro_blocked_artifact") {
        throw new DOMException("Storage is blocked", "SecurityError");
      }
      return originalRemoveItem.call(this, key);
    });

    const result = clearAllLocalData();
    await expect(result).rejects.toBeInstanceOf(LocalDataClearError);
    await expect(result).rejects.toMatchObject({ failedAreas: ["local browser storage"] });
    expect(localStorage.getItem("daliguro_blocked_artifact")).toBe("must not be reported as deleted");
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
