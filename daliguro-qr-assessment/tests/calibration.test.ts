import { describe, expect, it } from "vitest";
import type { Assessment, Item, Learner, TestVersion } from "../src/lib/types";
import type { ItemReading, SheetReading } from "../src/lib/scanner/omr-detect";
import type { ScanResult } from "../src/lib/scanner/still-pipeline";
import { CALIBRATION_EXPECTED, evaluateCertification } from "../src/lib/scanner/calibration";
import { buildReview } from "../src/lib/scanner/omr-score";
import { scanQuality } from "../src/lib/scanner/scan-quality";

const assessment: Assessment = {
  id: "A1",
  title: "Calibration Quiz",
  subject: "General Mathematics",
  gradeLevel: "11",
  section: "STEM-A",
  schoolYear: "2026-2027",
  term: "First",
  component: "Written Work",
  versions: ["A"],
  teacherName: "Teacher",
  createdAt: 0,
  updatedAt: 0,
};

const learner: Learner = {
  id: "L1",
  lrn: "1",
  fullName: "Calibration Learner",
  sex: "F",
  gradeLevel: "11",
  section: "STEM-A",
};

function item(n: number): Item {
  return {
    id: `i${n}`,
    assessmentId: "A1",
    itemNumber: n,
    type: "Multiple Choice",
    question: `Q${n}`,
    correctAnswer: "",
    acceptedAnswers: [],
    points: 1,
    competency: "",
    difficulty: "Average",
    cognitiveLevel: "",
    choices: 4,
  };
}

function readingFor(answer: string, index: number, confidence = 0.92, status: ItemReading["status"] = "selected"): ItemReading {
  const choice = ["A", "B", "C", "D"].indexOf(answer);
  const fill = [0.04, 0.04, 0.04, 0.04];
  if (choice >= 0) fill[choice] = confidence >= 0.72 ? 0.55 : 0.18;
  return {
    item: index + 1,
    detected: status === "blank" || status === "multiple" ? null : answer as ItemReading["detected"],
    status,
    confidence,
    fill,
  };
}

function makeResult(overrides: Partial<SheetReading> = {}, readings?: ItemReading[]): ScanResult {
  const items = CALIBRATION_EXPECTED.map((_, index) => item(index + 1));
  const actualReadings = readings ?? CALIBRATION_EXPECTED.map((answer, index) => readingFor(answer, index));
  const key = Object.fromEntries(items.map((it, index) => [it.id, CALIBRATION_EXPECTED[index]]));
  const summary = buildReview(items, key, actualReadings);
  const reading: SheetReading = {
    aligned: true,
    markersFound: 4,
    corners: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 150 },
      { x: 0, y: 150 },
    ],
    brightness: 155,
    sharpness: 5.2,
    version: { detected: "A", fill: [0.6, 0.02, 0.02, 0.02], status: "selected", confidence: 0.95 },
    items: actualReadings,
    ...overrides,
  };
  const confidence = actualReadings.reduce((sum, r) => sum + r.confidence, 0) / actualReadings.length;
  return {
    assessment,
    learner,
    version: "A" as TestVersion,
    summary,
    reading,
    source: "qr",
    confidence,
    quality: scanQuality({
      confidence,
      brightness: reading.brightness,
      sharpness: reading.sharpness,
      aligned: reading.aligned,
      doubtfulItems: summary.unclearCount + summary.multipleCount + summary.lowConfidenceCount,
      tiltAngle: 0,
      shadowLevel: 18,
      bubbleDarkness: 0.55,
    }),
    evidence: null,
  };
}

describe("scanner certification", () => {
  it("passes a clean calibration sheet with known answers", () => {
    const report = evaluateCertification(makeResult());
    expect(report.verdict).toBe("Passed");
    expect(report.status).toBe("Camera Ready");
    expect(report.read.every((row) => row.passed)).toBe(true);
  });

  it("fails faint calibration marks instead of trusting them as final answers", () => {
    const readings = CALIBRATION_EXPECTED.map((answer, index) => readingFor(answer, index, 0.55, "unclear"));
    const report = evaluateCertification(makeResult({}, readings));
    expect(report.verdict).toBe("Failed");
    expect(report.blockers.join(" ")).toContain("Known answers");
  });

  it("fails double marks and requires review/rescan", () => {
    const readings = CALIBRATION_EXPECTED.map((answer, index) =>
      index === 2 ? readingFor(answer, index, 0.2, "multiple") : readingFor(answer, index),
    );
    const report = evaluateCertification(makeResult({}, readings));
    expect(report.verdict).toBe("Failed");
    expect(report.read[2].passed).toBe(false);
  });

  it("fails low-light scans", () => {
    const report = evaluateCertification(makeResult({ brightness: 52 }));
    expect(report.verdict).toBe("Failed");
    expect(report.status).toBe("Rescan Required");
  });

  it("gives conditional or failed status for tilted sheets", () => {
    const report = evaluateCertification(makeResult({
      corners: [
        { x: 0, y: 0 },
        { x: 100, y: 18 },
        { x: 100, y: 150 },
        { x: 0, y: 150 },
      ],
    }));
    expect(["Conditional Pass", "Failed"]).toContain(report.verdict);
    expect(report.metrics.find((m) => m.label === "Tilt angle")?.ok).toBe(false);
  });
});
