import { describe, expect, it } from "vitest";
import { mapSyncedRow } from "../src/lib/scanner/synced-row";
import type { Assessment, Item } from "../src/lib/types";
import type { CheckedResultRow } from "../src/lib/sync/pairing";

const assessment: Assessment = {
  id: "A1",
  title: "Mixed assessment",
  subject: "Science",
  gradeLevel: "10",
  section: "A",
  schoolYear: "2026-2027",
  term: "First",
  component: "Written Work",
  versions: ["A", "B"],
  teacherName: "Teacher",
  createdAt: 1,
  updatedAt: 1,
};

function item(id: string, itemNumber: number, type: Item["type"], choices = 0): Item {
  return {
    id,
    assessmentId: assessment.id,
    itemNumber,
    type,
    question: id,
    correctAnswer: "",
    acceptedAnswers: [],
    points: type === "Essay" || type === "Short Answer" ? 5 : 1,
    competency: "",
    difficulty: "Average",
    cognitiveLevel: "",
    choices,
  };
}

const mixedItems: Item[] = [
  item("essay-1", 1, "Essay"),
  item("mc-2", 2, "Multiple Choice", 4),
  item("manual-3", 3, "Short Answer"),
  item("mc-4", 4, "Multiple Choice", 5),
];

function row(overrides: Partial<CheckedResultRow> = {}): CheckedResultRow {
  return {
    scan_id: null,
    assessment_id: "A1",
    teacher_user_id: "T1",
    school_id: null,
    learner_id: "L1",
    learner_name: "Learner One",
    section_name: null,
    subject_name: null,
    score: 0,
    total_items: 2,
    percentage: 0,
    answer_map: { "1": "A", "2": "E" },
    item_results: [
      { item: 1, answer: "A", status: "selected", confidence: 0.98 },
      { item: 2, answer: "E", status: "selected", confidence: 0.96 },
    ],
    qr_payload: { assessmentId: "A1", learnerId: "L1", version: "A" },
    scan_session_id: "S1",
    scan_source: "phone_camera",
    scan_confidence: 0.97,
    low_confidence_items: [],
    corrected_by_teacher: false,
    review_status: "needs_review",
    is_official: false,
    checked_at: new Date(0).toISOString(),
    ...overrides,
  };
}

const context = {
  assessment,
  items: mixedItems,
  knownLearnerIds: new Set(["L1"]),
};

describe("mapSyncedRow phone OMR boundary", () => {
  it("maps compact OMR rows through omrItemsOf when essay/manual items precede MC items", () => {
    const mapped = mapSyncedRow(row(), context);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;

    expect(mapped.input.responses).toEqual({ "mc-2": "A", "mc-4": "E" });
    expect(mapped.input.responses).not.toHaveProperty("essay-1");
    expect(mapped.input.responses).not.toHaveProperty("manual-3");
    expect(mapped.input.scanItems?.map((entry) => entry.itemNumber)).toEqual([1, 2]);
    expect(mapped.input.version).toBe("A");
    expect(mapped.input.reviewStatus).toBe("auto");
  });

  it.each([
    ["missing", {}, "missing_version"],
    ["empty", { version: "" }, "missing_version"],
    ["not enabled", { version: "D" }, "unsupported_version"],
    ["wrong type", { version: 1 }, "unsupported_version"],
  ])("rejects a %s version instead of falling back", (_label, qrPayload, code) => {
    const mapped = mapSyncedRow(row({ qr_payload: qrPayload }), context);
    expect(mapped).toMatchObject({ ok: false, code });
  });

  it.each([
    [0, "invalid_item_count"],
    [-1, "invalid_item_count"],
    [1.5, "invalid_item_count"],
    [Number.NaN, "invalid_item_count"],
    [1, "item_count_mismatch"],
    [3, "item_count_mismatch"],
  ])("rejects malformed or mismatched total_items=%s", (totalItems, code) => {
    const mapped = mapSyncedRow(row({ total_items: totalItems }), context);
    expect(mapped).toMatchObject({ ok: false, code });
  });

  it("does not use answer-map length as a fallback for a malformed count", () => {
    const malformed = row({ total_items: 0, answer_map: { "1": "A", "2": "E" } });
    expect(mapSyncedRow(malformed, context)).toMatchObject({ ok: false, code: "invalid_item_count" });
  });

  it("rejects missing, extra, duplicate, or inconsistent OMR coverage", () => {
    expect(mapSyncedRow(row({ answer_map: { "1": "A" } }), context)).toMatchObject({
      ok: false,
      code: "invalid_answer_map",
    });
    expect(mapSyncedRow(row({ answer_map: { "1": "A", "2": "E", "3": "B" } }), context)).toMatchObject({
      ok: false,
      code: "invalid_answer_map",
    });
    expect(mapSyncedRow(row({
      item_results: [
        { item: 1, answer: "A", status: "selected", confidence: 0.98 },
        { item: 1, answer: "E", status: "selected", confidence: 0.96 },
      ],
    }), context)).toMatchObject({ ok: false, code: "invalid_item_results" });
    expect(mapSyncedRow(row({
      item_results: [
        { item: 1, answer: "B", status: "selected", confidence: 0.98 },
        { item: 2, answer: "E", status: "selected", confidence: 0.96 },
      ],
    }), context)).toMatchObject({ ok: false, code: "invalid_answer_map" });
  });

  it("rejects an unknown learner whenever the caller supplies the roster", () => {
    const mapped = mapSyncedRow(row({ learner_id: "FORGED" }), context);
    expect(mapped).toMatchObject({ ok: false, code: "unknown_learner" });
  });

  it("rejects QR identity fields that disagree with the row", () => {
    const mapped = mapSyncedRow(
      row({ qr_payload: { assessmentId: "A1", learnerId: "OTHER", version: "A" } }),
      context,
    );
    expect(mapped).toMatchObject({ ok: false, code: "identity_mismatch" });
  });

  it.each([
    ["unclear", 0.98],
    ["multiple", 0.98],
    ["selected", 0.4],
    ["blank", 0.4],
  ])("keeps a %s detection at confidence %s review-only", (status, confidence) => {
    const mapped = mapSyncedRow(row({
      answer_map: { "1": status === "blank" || status === "multiple" ? "" : "A", "2": "E" },
      item_results: [
        { item: 1, answer: status === "blank" || status === "multiple" ? "" : "A", status, confidence },
        { item: 2, answer: "E", status: "selected", confidence: 0.99 },
      ],
      scan_confidence: 0.99,
    }), context);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect(mapped.input.reviewStatus).toBe("needs_review");
  });

  it("treats missing or malformed overall trust as review-only, never auto", () => {
    for (const scanConfidence of [null, Number.NaN, 2, -1]) {
      const mapped = mapSyncedRow(row({ scan_confidence: scanConfidence }), context);
      expect(mapped.ok).toBe(true);
      if (mapped.ok) {
        expect(mapped.input.confidence).toBeNull();
        expect(mapped.input.reviewStatus).toBe("needs_review");
      }
    }
  });

  it("honors a caller safety gate that requires review", () => {
    const mapped = mapSyncedRow(row(), { ...context, forceReview: true });
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect(mapped.input.reviewStatus).toBe("needs_review");
  });

  it("forwards a scan id when the sync contract provides one", () => {
    const withScanId = { ...row(), scan_id: "scan-123" } as CheckedResultRow;
    const mapped = mapSyncedRow(withScanId, context);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect((mapped.input as typeof mapped.input & { scanId?: string }).scanId).toBe("scan-123");
  });
});
