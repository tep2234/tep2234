import { describe, expect, it } from "vitest";
import type { Assessment, Item, ItemScore, Learner, Result } from "../src/lib/types";
import {
  analyzeItems,
  blankHeavy,
  commonWrongAnswers,
  competencyMastery,
  componentSummary,
  difficultyLabel,
  leastMissed,
  masteryDistribution,
  mostMissed,
  remediationGroups,
} from "../src/lib/analysis";

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
    choices: 4,
    ...overrides,
  };
}

function score(overrides: Partial<ItemScore> = {}): ItemScore {
  return {
    itemId: "i1",
    itemNumber: 1,
    type: "Multiple Choice",
    points: 1,
    awarded: 0,
    correct: false,
    blank: false,
    manual: false,
    overridden: false,
    remarks: "",
    ...overrides,
  };
}

function result(overrides: Partial<Result> = {}): Result {
  return {
    id: "r1",
    assessmentId: "a1",
    learnerId: "L1",
    version: "A",
    answers: [],
    itemScores: [],
    rawScore: 0,
    totalScore: 0,
    percentage: 0,
    masteryStatus: "Critical Intervention",
    reviewed: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function learner(overrides: Partial<Learner> = {}): Learner {
  return {
    id: "L1",
    lrn: "1",
    fullName: "Learner One",
    sex: "M",
    gradeLevel: "Grade 7",
    section: "Rizal",
    ...overrides,
  };
}

describe("difficultyLabel", () => {
  it("applies boundaries", () => {
    expect(difficultyLabel(100)).toBe("Easy");
    expect(difficultyLabel(85)).toBe("Easy");
    expect(difficultyLabel(84.9)).toBe("Moderate");
    expect(difficultyLabel(70)).toBe("Moderate");
    expect(difficultyLabel(69.9)).toBe("Difficult");
    expect(difficultyLabel(50)).toBe("Difficult");
    expect(difficultyLabel(49.9)).toBe("Very Difficult");
  });
});

describe("analyzeItems", () => {
  const items = [
    item({ id: "i1", itemNumber: 1, competency: "Fractions" }),
    item({ id: "i2", itemNumber: 2, competency: "" }), // untagged
  ];

  it("computes per-item attempt/correct/blank counts and percentCorrect", () => {
    const results = [
      result({
        id: "r1",
        itemScores: [
          score({ itemId: "i1", correct: true, awarded: 1 }),
          score({ itemId: "i2", blank: true }),
        ],
      }),
      result({
        id: "r2",
        itemScores: [
          score({ itemId: "i1", correct: false }),
          score({ itemId: "i2", correct: true, awarded: 1 }),
        ],
      }),
    ];

    const rows = analyzeItems(items, results);
    const row1 = rows.find((r) => r.item.id === "i1")!;
    expect(row1.attempts).toBe(2);
    expect(row1.correct).toBe(1);
    expect(row1.incorrect).toBe(1);
    expect(row1.blank).toBe(0);
    expect(row1.percentCorrect).toBe(50);
    expect(row1.competency).toBe("Fractions");

    const row2 = rows.find((r) => r.item.id === "i2")!;
    expect(row2.competency).toBe("Untagged Competency");
    expect(row2.blank).toBe(1);
    expect(row2.correct).toBe(1);
    expect(row2.attempts).toBe(2);
  });

  it("returns 0 attempts cleanly (no NaN) for an item nobody attempted", () => {
    const rows = analyzeItems(items, []);
    rows.forEach((r) => {
      expect(r.attempts).toBe(0);
      expect(r.percentCorrect).toBe(0);
      expect(Number.isNaN(r.percentCorrect)).toBe(false);
    });
  });

  it("mostMissed/leastMissed/blankHeavy rank and slice correctly", () => {
    const rows = analyzeItems(items, [
      result({
        itemScores: [
          score({ itemId: "i1", correct: false }),
          score({ itemId: "i2", correct: true, awarded: 1 }),
        ],
      }),
      result({
        itemScores: [
          score({ itemId: "i1", blank: true }),
          score({ itemId: "i2", correct: true, awarded: 1 }),
        ],
      }),
    ]);
    expect(mostMissed(rows, 1)[0].item.id).toBe("i1");
    expect(leastMissed(rows, 1)[0].item.id).toBe("i2");
    const heavy = blankHeavy(rows, 5);
    expect(heavy).toHaveLength(1);
    expect(heavy[0].item.id).toBe("i1");
  });
});

describe("commonWrongAnswers", () => {
  it("tallies non-blank wrong text responses, excludes manual/correct/blank", () => {
    const items = [item({ id: "i1" })];
    const results = [
      result({
        itemScores: [score({ itemId: "i1", correct: false })],
        answers: [{ itemId: "i1", response: "B" }],
      }),
      result({
        itemScores: [score({ itemId: "i1", correct: false })],
        answers: [{ itemId: "i1", response: "B" }],
      }),
      result({
        itemScores: [score({ itemId: "i1", correct: false })],
        answers: [{ itemId: "i1", response: "C" }],
      }),
      result({
        // correct — must be excluded
        itemScores: [score({ itemId: "i1", correct: true })],
        answers: [{ itemId: "i1", response: "A" }],
      }),
    ];
    const tally = commonWrongAnswers(items, results);
    const list = tally.get("i1")!;
    expect(list[0]).toEqual({ response: "B", count: 2 });
    expect(list[1]).toEqual({ response: "C", count: 1 });
  });

  it("omits items with no wrong answers entirely (no empty-array noise)", () => {
    const items = [item({ id: "i1" })];
    const tally = commonWrongAnswers(items, []);
    expect(tally.has("i1")).toBe(false);
  });
});

describe("competencyMastery", () => {
  it("groups points by competency, flags needsReteaching below 75%", () => {
    const items = [
      item({ id: "i1", competency: "Fractions", points: 10 }),
      item({ id: "i2", competency: "Decimals", points: 10 }),
    ];
    const results = [
      result({
        itemScores: [
          score({ itemId: "i1", points: 10, awarded: 9 }), // 90%
          score({ itemId: "i2", points: 10, awarded: 2 }), // 20%
        ],
      }),
    ];
    const rows = competencyMastery(items, results);
    const fractions = rows.find((r) => r.competency === "Fractions")!;
    const decimals = rows.find((r) => r.competency === "Decimals")!;
    expect(fractions.masteryPercent).toBe(90);
    expect(fractions.needsReteaching).toBe(false);
    expect(decimals.masteryPercent).toBe(20);
    expect(decimals.needsReteaching).toBe(true);
    // sorted ascending by masteryPercent
    expect(rows[0].competency).toBe("Decimals");
  });
});

describe("remediationGroups", () => {
  it("buckets learners by mastery status with the right action and weak competencies", () => {
    const items = [item({ id: "i1", competency: "Fractions", points: 10 })];
    const learners = [learner({ id: "L1", fullName: "Ana" })];
    const results = [
      result({
        learnerId: "L1",
        masteryStatus: "Critical Intervention",
        percentage: 40,
        itemScores: [score({ itemId: "i1", points: 10, awarded: 4 })],
      }),
    ];
    const groups = remediationGroups(items, results, learners);
    const critical = groups.find((g) => g.status === "Critical Intervention")!;
    expect(critical.action).toBe("Focused reteaching and individual support");
    expect(critical.learners).toHaveLength(1);
    expect(critical.learners[0].name).toBe("Ana");
    expect(critical.learners[0].weakCompetencies).toContain("Fractions");

    const mastered = groups.find((g) => g.status === "Mastered")!;
    expect(mastered.learners).toHaveLength(0);
  });

  it("falls back to a placeholder name for an unknown learner id", () => {
    const groups = remediationGroups([], [result({ learnerId: "ghost" })], []);
    const bucket = groups.find((g) => g.status === "Critical Intervention")!;
    expect(bucket.learners[0].name).toBe("(unknown learner)");
  });
});

describe("masteryDistribution", () => {
  it("counts results per mastery status, defaulting missing statuses to 0", () => {
    const dist = masteryDistribution([
      result({ masteryStatus: "Mastered" }),
      result({ masteryStatus: "Mastered" }),
      result({ masteryStatus: "Needs Improvement" }),
    ]);
    expect(dist.Mastered).toBe(2);
    expect(dist["Needs Improvement"]).toBe(1);
    expect(dist["Nearly Mastered"]).toBe(0);
    expect(dist["Critical Intervention"]).toBe(0);
  });
});

describe("componentSummary", () => {
  function assessment(overrides: Partial<Assessment> = {}): Assessment {
    return {
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
      ...overrides,
    };
  }

  it("aggregates average/highest/lowest percentage per component", () => {
    const assessments = [assessment({ id: "a1", component: "Written Work" })];
    const results = [
      result({ assessmentId: "a1", percentage: 80 }),
      result({ assessmentId: "a1", percentage: 60 }),
    ];
    const rows = componentSummary(assessments, results);
    expect(rows).toHaveLength(1);
    expect(rows[0].component).toBe("Written Work");
    expect(rows[0].attempts).toBe(2);
    expect(rows[0].average).toBe(70);
    expect(rows[0].highest).toBe(80);
    expect(rows[0].lowest).toBe(60);
  });

  it("skips results referencing a deleted/unknown assessment", () => {
    const rows = componentSummary([], [result({ assessmentId: "ghost", percentage: 50 })]);
    expect(rows).toHaveLength(0);
  });
});
