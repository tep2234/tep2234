import { describe, expect, it } from "vitest";
import type { Item, ItemScore, Learner, Result } from "../src/lib/types";
import {
  depedMasteryLabel,
  errorBand,
  reportCompetencies,
  reportItems,
  reportLearners,
  reportSummary,
} from "../src/lib/report";

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: "i1",
    assessmentId: "a1",
    itemNumber: 1,
    type: "Multiple Choice",
    question: "Q",
    correctAnswer: "A",
    acceptedAnswers: [],
    points: 1,
    competency: "",
    difficulty: "Average",
    cognitiveLevel: "",
    choices: 4,
    ...overrides,
  };
}
function score(overrides: Partial<ItemScore> = {}): ItemScore {
  return {
    itemId: "i1", itemNumber: 1, type: "Multiple Choice", points: 1,
    awarded: 0, correct: false, blank: false, manual: false, overridden: false, remarks: "",
    ...overrides,
  };
}
function result(overrides: Partial<Result> = {}): Result {
  return {
    id: "r1", assessmentId: "a1", learnerId: "L1", version: "A",
    answers: [], itemScores: [], rawScore: 0, totalScore: 0, percentage: 0,
    masteryStatus: "Critical Support", reviewed: true, source: "manual",
    scanConfidence: null, reviewStatus: "reviewed", finalizedAt: null,
    scanItems: null, auditLog: [], createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}
function learner(id: string, name: string, section = "A"): Learner {
  return { id, lrn: id, fullName: name, sex: "M", gradeLevel: "11", section };
}

describe("depedMasteryLabel", () => {
  it("maps 80/60/40 to DepEd labels", () => {
    expect(depedMasteryLabel(85)).toBe("Mastered");
    expect(depedMasteryLabel(70)).toBe("Nearly Mastered");
    expect(depedMasteryLabel(50)).toBe("Least Mastered");
    expect(depedMasteryLabel(30)).toBe("Not Mastered");
  });
});

describe("errorBand", () => {
  it("bands frequency of error", () => {
    expect(errorBand(0)).toBe("No Error");
    expect(errorBand(25)).toBe("Minimal Error");
    expect(errorBand(26)).toBe("Moderate Error");
    expect(errorBand(51)).toBe("High Error");
    expect(errorBand(76)).toBe("Critical Error");
  });
});

describe("reportItems", () => {
  const items = [item({ id: "i1", itemNumber: 1, competency: "C1" })];
  it("computes correct/error counts, %correct, freq-of-error, most-wrong", () => {
    const results = [
      result({ id: "r1", itemScores: [score({ itemId: "i1", correct: true, awarded: 1 })] }),
      result({ id: "r2", itemScores: [score({ itemId: "i1", correct: false })], answers: [{ itemId: "i1", response: "C" }] }),
      result({ id: "r3", itemScores: [score({ itemId: "i1", correct: false })], answers: [{ itemId: "i1", response: "C" }] }),
      result({ id: "r4", itemScores: [score({ itemId: "i1", correct: false })], answers: [{ itemId: "i1", response: "B" }] }),
    ];
    const rows = reportItems(items, results);
    expect(rows[0].takers).toBe(4);
    expect(rows[0].correct).toBe(1);
    expect(rows[0].errors).toBe(3);
    expect(rows[0].percentCorrect).toBe(25);
    expect(rows[0].freqOfError).toBe(75);
    expect(rows[0].errorRemark).toBe("High Error");
    expect(rows[0].mostWrong).toBe("C");
    expect(rows[0].mastery).toBe("Not Mastered");
  });
});

describe("reportSummary", () => {
  const items = [item({ id: "i1", points: 1 }), item({ id: "i2", itemNumber: 2, points: 1 })];
  it("computes takers, absent, overall mastery, mastery counts", () => {
    const results = [
      result({ id: "r1", learnerId: "L1", percentage: 100, rawScore: 2, totalScore: 2 }),
      result({ id: "r2", learnerId: "L2", percentage: 50, rawScore: 1, totalScore: 2 }),
    ];
    const s = reportSummary(items, results, 5);
    expect(s.takers).toBe(2);
    expect(s.absent).toBe(3);
    expect(s.overallMastery).toBe(75); // 3/4 earned
    expect(s.masteryCounts.Mastered).toBe(1);
    expect(s.masteryCounts["Least Mastered"]).toBe(1);
    expect(s.numItems).toBe(2);
  });
});

describe("reportCompetencies + reportLearners", () => {
  const items = [
    item({ id: "i1", itemNumber: 1, competency: "Functions", points: 10 }),
    item({ id: "i2", itemNumber: 2, competency: "Functions", points: 10 }),
  ];
  const learners = [learner("L1", "Ana"), learner("L2", "Ben")];
  const results = [
    result({
      id: "r1", learnerId: "L1", percentage: 30, rawScore: 6, totalScore: 20,
      itemScores: [score({ itemId: "i1", points: 10, awarded: 2 }), score({ itemId: "i2", points: 10, awarded: 4 })],
    }),
  ];

  it("rolls up competency mastery + affected learners", () => {
    const rows = reportCompetencies(items, results);
    const c = rows.find((r) => r.competency === "Functions")!;
    expect(c.items).toEqual([1, 2]);
    expect(c.avgPercentCorrect).toBe(30);
    expect(c.mastery).toBe("Not Mastered");
    expect(c.affectedLearners).toBe(1);
  });

  it("builds a learner remediation row with weak competency + missed items", () => {
    const rows = reportLearners(items, results, learners);
    expect(rows[0].name).toBe("Ana");
    expect(rows[0].mastery).toBe("Not Mastered");
    expect(rows[0].weakCompetencies).toContain("Functions");
    expect(rows[0].missedItems).toEqual([1, 2]);
    expect(rows[0].intervention).toMatch(/remediation/i);
  });
});
