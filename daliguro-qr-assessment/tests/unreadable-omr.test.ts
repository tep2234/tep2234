import { beforeEach, describe, expect, it } from "vitest";
import { applyCorrection } from "../src/lib/scanner/review-correction";
import { manualFallbackBlocked } from "../src/lib/result-trust";
import { finalizeResults } from "../src/lib/result-finalization";
import { clearState, loadState, saveState } from "../src/lib/offline-store";
import { isTrustedResult } from "../src/lib/result-trust";
import { readSheet, type GrayImage, type ItemReading } from "../src/lib/scanner/omr-detect";
import { buildReview } from "../src/lib/scanner/omr-score";
import { scanQuality } from "../src/lib/scanner/scan-quality";
import { upsertScanResult } from "../src/lib/scanner/scan-save";
import type { ScanResult } from "../src/lib/scanner/still-pipeline";
import { mapSyncedRow } from "../src/lib/scanner/synced-row";
import { buildTemplate, CHOICES, MARKER_RECTS, SHEET_H, SHEET_W } from "../src/lib/scanner/omr-template";
import { acknowledgeHeldScan, parseHeldScans, type HeldScan } from "../src/lib/sync/scan-outbox";
import {
  checkedRowFromScan,
  validateScanBroadcast,
  type ScanBroadcast,
} from "../src/lib/sync/pairing";
import {
  type Assessment,
  type Item,
  type QrAssessmentState,
  type Result,
} from "../src/lib/types";

const assessment: Assessment = {
  id: "A1",
  title: "Unreadable safety test",
  subject: "Science",
  gradeLevel: "10",
  section: "A",
  schoolYear: "2026-2027",
  term: "First",
  component: "Written Work",
  versions: ["A"],
  teacherName: "teacher-123",
  createdAt: 1,
  updatedAt: 1,
};

function mcItem(id: string, itemNumber: number): Item {
  return {
    id,
    assessmentId: assessment.id,
    itemNumber,
    type: "Multiple Choice",
    question: `Question ${itemNumber}`,
    correctAnswer: "",
    acceptedAnswers: [],
    points: 1,
    competency: "",
    difficulty: "Average",
    cognitiveLevel: "",
    choices: 4,
  };
}

function fillRect(image: GrayImage, x: number, y: number, width: number, height: number, value: number) {
  for (let yy = Math.floor(y); yy < y + height; yy += 1) {
    for (let xx = Math.floor(x); xx < x + width; xx += 1) {
      (image.data as Uint8ClampedArray)[yy * image.width + xx] = value;
    }
  }
}

function fillDisc(image: GrayImage, cx: number, cy: number, radius: number, value: number) {
  for (let yy = Math.floor(cy - radius); yy <= cy + radius; yy += 1) {
    for (let xx = Math.floor(cx - radius); xx <= cx + radius; xx += 1) {
      if ((xx - cx) ** 2 + (yy - cy) ** 2 <= radius ** 2) {
        (image.data as Uint8ClampedArray)[yy * image.width + xx] = value;
      }
    }
  }
}

function drawRing(image: GrayImage, cx: number, cy: number, radius: number) {
  for (let yy = Math.floor(cy - radius * 1.2); yy <= cy + radius * 1.2; yy += 1) {
    for (let xx = Math.floor(cx - radius * 1.2); xx <= cx + radius * 1.2; xx += 1) {
      const distance = Math.hypot(xx - cx, yy - cy);
      if (distance >= radius * 0.86 && distance <= radius * 1.14) {
        (image.data as Uint8ClampedArray)[yy * image.width + xx] = 25;
      }
    }
  }
}

function scanBroadcast(): ScanBroadcast {
  return {
    scanId: "scan-unreadable-0001",
    sessionId: "session-1",
    assessmentId: "A1",
    learnerId: "L1",
    version: "A",
    answerMap: { "1": "A" },
    detected: [{
      item: 1,
      answer: "A",
      status: "unreadable",
      confidence: 0.1,
      fill: [0.4, 0, 0, 0],
      unreadableChoices: [1],
    }],
    confidence: 0.1,
    capturedAt: 1_000,
  };
}

function pendingResult(): Result {
  return {
    id: "R1",
    assessmentId: "A1",
    learnerId: "L1",
    version: "A",
    answers: [{ itemId: "i1", response: "" }],
    itemScores: [{
      itemId: "i1",
      itemNumber: 1,
      type: "Multiple Choice",
      points: 1,
      awarded: 0,
      correct: false,
      blank: false,
      unresolved: true,
      unresolvedStatus: "unreadable",
      manual: false,
      overridden: false,
      remarks: "",
    }],
    rawScore: 0,
    totalScore: 0,
    percentage: 0,
    masteryStatus: "Critical Support",
    reviewed: false,
    source: "scan",
    scanConfidence: 0.1,
    scanQuality: 40,
    reviewStatus: "needs_review",
    finalizedAt: null,
    scanItems: [{
      itemNumber: 1,
      detected: "A",
      status: "unreadable",
      confidence: 0.1,
      fill: [0.4, 0, 0, 0],
      unreadableChoices: [1],
    }],
    sourceScanId: "scan-unreadable-0001",
    auditLog: [{ at: 1, action: "Original scan stored" }],
    createdAt: 1,
    updatedAt: 1,
  };
}

function stateWithPending(): QrAssessmentState {
  return {
    assessments: [assessment],
    items: [mcItem("i1", 1)],
    learners: [{ id: "L1", lrn: "1", fullName: "Learner One", sex: "F", gradeLevel: "10", section: "A" }],
    answerKeys: { A1: { A: { i1: "B" } } },
    results: [pendingResult()],
  };
}

function localUnreadableScan(): ScanResult {
  const item = mcItem("i1", 1);
  const reading: ItemReading = {
    item: 1,
    detected: "A",
    status: "unreadable",
    confidence: 0.1,
    fill: [0.4, 0, 0, 0],
    unreadableChoices: [1],
  };
  return {
    assessment,
    learner: { id: "L1", lrn: "1", fullName: "Learner One", sex: "F", gradeLevel: "10", section: "A" },
    version: "A",
    summary: buildReview([item], { i1: "B" }, [reading]),
    reading: {
      aligned: true,
      markersFound: 4,
      corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      brightness: 150,
      sharpness: 6,
      version: { detected: "A", fill: [0.8, 0, 0, 0], status: "selected", confidence: 0.95 },
      items: [reading],
      shadowLevel: 5,
      glareLevel: 0,
      printContrast: 0.5,
      obscuredBubbleCount: 1,
    },
    source: "qr",
    captureSource: "gallery",
    confidence: 0.1,
    quality: scanQuality({
      confidence: 0.1,
      brightness: 150,
      sharpness: 6,
      aligned: true,
      doubtfulItems: 1,
      shadowLevel: 5,
      tiltAngle: 0,
      bubbleDarkness: 0.5,
      obscuredBubbleCount: 1,
    }),
    evidence: null,
  };
}

describe("unreadable OMR state contract", () => {
  beforeEach(async () => {
    await clearState();
  });

  it("returns unreadable with the affected choice when one printed bubble region is obscured", () => {
    const template = buildTemplate(2);
    const image: GrayImage = {
      data: new Uint8ClampedArray(SHEET_W * SHEET_H).fill(238),
      width: SHEET_W,
      height: SHEET_H,
    };
    MARKER_RECTS.forEach((marker) => fillRect(image, marker.x, marker.y, marker.w, marker.h, 0));
    template.bubbles.forEach((bubble) => drawRing(image, bubble.cx, bubble.cy, bubble.r));
    const obscured = template.bubbles.find((bubble) => bubble.item === 1 && bubble.choiceIndex === 1)!;
    fillDisc(image, obscured.cx, obscured.cy, obscured.r * 1.5, 255);

    const reading = readSheet(image, template, { 1: 4, 2: 4 });
    expect(reading.items[0].status).toBe("unreadable");
    expect(reading.items[0].unreadableChoices).toEqual([1]);
    expect(reading.obscuredBubbleCount).toBeGreaterThanOrEqual(1);
  });

  it("excludes unreadable evidence from correct, wrong, and blank scoring until correction", () => {
    const items = [mcItem("i1", 1), mcItem("i2", 2)];
    const readings: ItemReading[] = [
      { item: 1, detected: "A", status: "unreadable", confidence: 0.1, fill: [0.4, 0, 0, 0], unreadableChoices: [1] },
      { item: 2, detected: "C", status: "selected", confidence: 0.95, fill: [0, 0, 0.8, 0] },
    ];
    const pending = buildReview(items, { i1: "A", i2: "C" }, readings);
    expect(pending).toMatchObject({
      rawScore: 1,
      totalScore: 1,
      correctCount: 1,
      wrongCount: 0,
      blankCount: 0,
      unreadableCount: 1,
      unresolvedCount: 1,
      needsReview: true,
    });
    expect(pending.rows[0]).toMatchObject({ detected: null, suggested: "A", needsReview: true });

    const corrected = buildReview(items, { i1: "A", i2: "C" }, readings, { 1: "A" });
    expect(corrected).toMatchObject({ rawScore: 2, totalScore: 2, unresolvedCount: 0, needsReview: false });
  });

  it("accepts unreadable phone evidence, rejects invalid statuses, and preserves it through sync mapping", () => {
    const scan = scanBroadcast();
    expect(validateScanBroadcast(scan, { sessionId: "session-1", assessmentId: "A1" })).toEqual({ ok: true });
    expect(validateScanBroadcast(
      { ...scan, detected: [{ ...scan.detected[0], status: "guessed" }] },
      { sessionId: "session-1", assessmentId: "A1" },
    )).toMatchObject({ ok: false });
    expect(validateScanBroadcast(
      { ...scan, detected: [{ ...scan.detected[0], unreadableChoices: [] }] },
      { sessionId: "session-1", assessmentId: "A1" },
    )).toMatchObject({ ok: false });

    const row = checkedRowFromScan(scan, { assessmentId: "A1", teacherUserId: "teacher-1", sessionId: "session-1" });
    const mapped = mapSyncedRow(row, {
      assessment,
      items: [mcItem("i1", 1)],
      knownLearnerIds: new Set(["L1"]),
      forceReview: true,
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.input.responses).toEqual({ i1: "" });
    expect(mapped.input.scanItems[0]).toMatchObject({
      status: "unreadable",
      detected: "A",
      unreadableChoices: [1],
    });
    expect(mapped.input.reviewStatus).toBe("needs_review");
  });

  it("preserves unreadable evidence through offline queue restore and matching acknowledgement", () => {
    const scan = scanBroadcast();
    const held: HeldScan = {
      scanId: scan.scanId,
      sessionId: scan.sessionId,
      assessmentId: scan.assessmentId,
      learnerId: scan.learnerId,
      version: scan.version,
      answerMap: scan.answerMap,
      detected: scan.detected,
      confidence: scan.confidence,
      capturedAt: scan.capturedAt,
      sequenceNumber: 1,
      issuedAt: new Date(scan.capturedAt).toISOString(),
    };
    const restored = parseHeldScans(JSON.stringify([held]), "session-1", "A1");
    expect(restored[0].detected[0]).toMatchObject({ status: "unreadable", unreadableChoices: [1] });
    expect(acknowledgeHeldScan(restored, "different-scan")).toHaveLength(1);
    expect(acknowledgeHeldScan(restored, held.scanId)).toEqual([]);

    const invalid = { ...held, detected: [{ ...held.detected[0], status: "invalid" }] };
    expect(parseHeldScans(JSON.stringify([invalid]), "session-1", "A1")).toEqual([]);
  });

  it("blocks finalization while unreadable evidence remains", () => {
    const result = { ...pendingResult(), reviewStatus: "reviewed" as const, reviewed: true };
    const finalized = finalizeResults([result], new Set([result.id]), false)[0];
    expect(finalized.reviewStatus).toBe("reviewed");
    expect(finalized.finalizedAt).toBeNull();
  });

  it("keeps a local camera scan provisional when an explicit unreadable decision is missing", () => {
    const state = stateWithPending();
    state.results = [];
    const outcome = upsertScanResult(
      state,
      localUnreadableScan(),
      { i1: "B" },
      {},
      "reviewed",
      undefined,
      "teacher-123",
    );
    const result = outcome.results[0];
    expect(result.reviewStatus).toBe("needs_review");
    expect(result.itemScores[0]).toMatchObject({ unresolved: true, blank: false, correct: false });
    expect(result.rawScore).toBe(0);
    expect(result.totalScore).toBe(0);
    expect(result.scanItems?.[0]).toMatchObject({ status: "unreadable", unreadableChoices: [1] });
    expect(manualFallbackBlocked(result)).toBe(true);
  });

  it("stores a local camera correction with normalized evidence and a complete item audit", () => {
    const state = stateWithPending();
    state.results = [];
    const outcome = upsertScanResult(
      state,
      localUnreadableScan(),
      { i1: "B" },
      { 1: "B" },
      "reviewed",
      undefined,
      "teacher-123",
    );
    const result = outcome.results[0];
    expect(result.reviewStatus).toBe("reviewed");
    expect(result.itemScores[0]).toMatchObject({ correct: true, blank: false, unresolved: false });
    expect(result.scanItems?.[0]).toMatchObject({ status: "selected", detected: "B", unreadableChoices: [] });
    expect(result.sourceScanId).toBe(result.id);
    expect(result.auditLog.find((entry) => entry.action === "OMR item explicitly resolved")).toMatchObject({
      itemId: "i1",
      itemNumber: 1,
      originalStatus: "unreadable",
      originalValue: "A",
      correctedValue: "B",
      actorId: "teacher-123",
      source: "scanner",
      scanId: result.id,
    });
  });

  it("does not let an alternate correction caller turn unreadable into blank without a decision", () => {
    const before = stateWithPending();
    const after = applyCorrection(before, before.results[0], { i1: "" }, "teacher-123", {});
    const result = after.results[0];
    expect(result.reviewStatus).toBe("needs_review");
    expect(result.scanItems?.[0]).toMatchObject({ status: "unreadable", detected: "A" });
    expect(result.itemScores[0]).toMatchObject({ unresolved: true, blank: false, correct: false });
  });

  it("appends a complete immutable correction audit record and resolves the scan item", () => {
    const before = stateWithPending();
    const after = applyCorrection(before, before.results[0], { i1: "B" }, "teacher-123", { 1: "B" });
    const result = after.results[0];
    const audit = result.auditLog.find((entry) => entry.action === "OMR item explicitly resolved");

    expect(audit).toMatchObject({
      scanId: "scan-unreadable-0001",
      itemId: "i1",
      itemNumber: 1,
      originalStatus: "unreadable",
      originalValue: "A",
      correctedValue: "B",
      actorId: "teacher-123",
      source: "review_queue",
      reason: "Unreadable camera evidence required an explicit teacher decision.",
    });
    expect(typeof audit?.at).toBe("number");
    expect(result.auditLog[0]).toEqual(before.results[0].auditLog[0]);
    expect(result.scanItems?.[0]).toMatchObject({
      status: "selected",
      detected: "B",
      confidence: 1,
      unreadableChoices: [],
    });
    expect(result.itemScores[0]).toMatchObject({ correct: true, blank: false });
    expect(result.reviewStatus).toBe("reviewed");
  });

  it("loads older scans that do not contain newer image-quality or unreadable fields", async () => {
    const legacy = pendingResult();
    legacy.reviewStatus = "reviewed";
    legacy.reviewed = true;
    legacy.itemScores = legacy.itemScores.map((score) => {
      const compatible = { ...score };
      delete compatible.unresolved;
      delete compatible.unresolvedStatus;
      return compatible;
    });
    legacy.scanItems = [{ itemNumber: 1, detected: "B", status: "selected", confidence: 0.9 }];
    delete legacy.sourceScanFingerprint;
    const state = stateWithPending();
    state.results = [legacy];
    await saveState(state);
    const loaded = await loadState();
    expect(loaded.results[0].scanItems?.[0]).toEqual({
      itemNumber: 1,
      detected: "B",
      status: "selected",
      confidence: 0.9,
    });
    expect(loaded.results[0].scanItems?.[0].unreadableChoices).toBeUndefined();
  });

  it("quarantines an invalid persisted status as unresolved instead of trusting it", async () => {
    const corrupted = pendingResult();
    corrupted.reviewStatus = "reviewed";
    corrupted.itemScores[0] = { ...corrupted.itemScores[0], unresolved: false, unresolvedStatus: undefined };
    corrupted.scanItems = [{
      itemNumber: 1,
      detected: "A",
      status: "guessed" as never,
      confidence: 0.99,
    }];
    const state = stateWithPending();
    state.results = [corrupted];
    await saveState(state);
    const loaded = (await loadState()).results[0];
    expect(loaded.scanItems?.[0]).toMatchObject({ status: "unclear", confidence: 0, detected: null });
    expect(isTrustedResult(loaded)).toBe(false);
  });

  it("uses choice indexes compatible with the shared A-E labels", () => {
    expect([0, 1, 2, 3, 4].map((index) => CHOICES[index])).toEqual(["A", "B", "C", "D", "E"]);
  });
});
