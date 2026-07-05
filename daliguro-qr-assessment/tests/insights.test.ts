import { describe, expect, it } from "vitest";
import type { Assessment, Item, ItemScore, Learner, Result } from "../src/lib/types";
import { analyzeItems, commonWrongAnswers, competencyMastery } from "../src/lib/analysis";
import {
  attentionFor,
  buildReflection,
  buildSmartSummary,
  classStats,
  discriminationIndex,
  itemQualityFlags,
} from "../src/lib/insights";

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
    topic: "",
    difficulty: "Average",
    cognitiveLevel: "",
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
    masteryStatus: "Critical Support",
    reviewed: true,
    source: "manual",
    scanConfidence: null,
    reviewStatus: "reviewed",
    finalizedAt: null,
    scanItems: null,
    auditLog: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const assessment: Assessment = {
  id: "a1",
  title: "Quiz 1",
  subject: "Math",
  gradeLevel: "11",
  section: "STEM-A",
  schoolYear: "2026-2027",
  term: "First",
  component: "Written Work",
  versions: ["A"],
  teacherName: "T",
  createdAt: 0,
  updatedAt: 0,
};

describe("classStats", () => {
  it("computes average, extremes, and 75% passing rate", () => {
    const s = classStats([
      result({ percentage: 90 }),
      result({ percentage: 75 }),
      result({ percentage: 40 }),
      result({ percentage: 60 }),
    ]);
    expect(s.count).toBe(4);
    expect(s.average).toBe(66.3);
    expect(s.highest).toBe(90);
    expect(s.lowest).toBe(40);
    expect(s.passingRate).toBe(50); // 90 and 75 pass
  });

  it("returns zeros for no results", () => {
    expect(classStats([]).passingRate).toBe(0);
  });
});

describe("discriminationIndex", () => {
  // 6 results: top scorers get i1 right, bottom scorers get it wrong → d = 1.
  const results = [95, 90, 85, 30, 25, 20].map((pct, k) =>
    result({
      id: "r" + k,
      learnerId: "L" + k,
      percentage: pct,
      itemScores: [score({ itemId: "i1", correct: pct >= 50, awarded: pct >= 50 ? 1 : 0 })],
    }),
  );

  it("is high when top scorers outperform bottom scorers on the item", () => {
    expect(discriminationIndex("i1", results)).toBe(1);
  });

  it("is ~0 for an item everyone gets right", () => {
    const all = results.map((r) => ({
      ...r,
      itemScores: [score({ itemId: "i1", correct: true, awarded: 1 })],
    }));
    expect(discriminationIndex("i1", all)).toBe(0);
  });

  it("returns null with too few attempts", () => {
    expect(discriminationIndex("i1", results.slice(0, 3))).toBeNull();
  });
});

describe("itemQualityFlags", () => {
  const items = [item({ id: "i1" })];

  it("flags a very low correct rate and a negative discrimination", () => {
    // 6 learners, everyone wrong on i1, high scorers included.
    const results = [95, 90, 85, 30, 25, 20].map((pct, k) =>
      result({
        id: "r" + k,
        learnerId: "L" + k,
        percentage: pct,
        itemScores: [score({ itemId: "i1", correct: false })],
        answers: [{ itemId: "i1", response: "B" }],
      }),
    );
    const rows = analyzeItems(items, results);
    const wrong = commonWrongAnswers(items, results);
    const flags = itemQualityFlags(rows[0], discriminationIndex("i1", results), wrong.get("i1"));
    expect(flags.join(" ")).toMatch(/low correct rate/i);
    expect(flags.join(" ")).toMatch(/high scorers/i);
    expect(flags.join(" ")).toMatch(/same wrong answer/i);
  });

  it("flags an item everyone got right as possibly too easy", () => {
    const results = [1, 2, 3, 4].map((k) =>
      result({
        id: "r" + k,
        learnerId: "L" + k,
        percentage: 90,
        itemScores: [score({ itemId: "i1", correct: true, awarded: 1 })],
      }),
    );
    const rows = analyzeItems(items, results);
    const flags = itemQualityFlags(rows[0], discriminationIndex("i1", results), undefined);
    expect(flags.join(" ")).toMatch(/too easy/i);
  });

  it("stays silent with too little data", () => {
    const results = [result({ itemScores: [score({ itemId: "i1" })] })];
    const rows = analyzeItems(items, results);
    expect(itemQualityFlags(rows[0], null, undefined)).toEqual([]);
  });
});

describe("attentionFor", () => {
  const itemsById = new Map(
    [
      item({ id: "i1", difficulty: "Easy" }),
      item({ id: "i2", difficulty: "Easy" }),
      item({ id: "i3" }),
    ].map((i) => [i.id, i]),
  );

  it("flags very low scores for immediate remediation", () => {
    const r = result({ percentage: 30, itemScores: [score({ itemId: "i3" })] });
    expect(attentionFor(r, itemsById).flag).toBe("Needs Immediate Remediation");
  });

  it("flags heavy blanks even with a mid score", () => {
    const r = result({
      percentage: 65,
      itemScores: [
        score({ itemId: "i1", blank: true }),
        score({ itemId: "i2", blank: true }),
        score({ itemId: "i3", correct: true }),
      ],
    });
    const read = attentionFor(r, itemsById);
    expect(read.flag).toBe("Needs Immediate Remediation");
    expect(read.reasons.join(" ")).toMatch(/blank/i);
  });

  it("flags patterned answering (same letter run)", () => {
    const r = result({
      percentage: 65,
      answers: Array.from({ length: 8 }, (_, i) => ({ itemId: "x" + i, response: "C" })),
      itemScores: [score({ itemId: "i3", correct: true })],
    });
    const read = attentionFor(r, itemsById);
    expect(read.flag).toBe("Needs Support");
    expect(read.reasons.join(" ")).toMatch(/same letter/i);
  });

  it("gives On Track for a strong clean result", () => {
    const r = result({
      percentage: 95,
      itemScores: [score({ itemId: "i3", correct: true, awarded: 1 })],
    });
    expect(attentionFor(r, itemsById).flag).toBe("On Track");
  });
});

describe("buildSmartSummary / buildReflection", () => {
  const learners: Learner[] = [
    { id: "L1", lrn: "1", fullName: "Ana Reyes", sex: "F", gradeLevel: "11", section: "A" },
    { id: "L2", lrn: "2", fullName: "Juan Cruz", sex: "M", gradeLevel: "11", section: "A" },
  ];
  const items = [
    item({ id: "i1", itemNumber: 1, competency: "Solving equations" }),
    item({ id: "i2", itemNumber: 2, competency: "Solving equations" }),
  ];
  const results = [
    result({
      id: "r1",
      learnerId: "L1",
      percentage: 90,
      masteryStatus: "Mastered",
      itemScores: [
        score({ itemId: "i1", correct: true, awarded: 1 }),
        score({ itemId: "i2", correct: true, awarded: 1 }),
      ],
    }),
    result({
      id: "r2",
      learnerId: "L2",
      percentage: 30,
      masteryStatus: "Critical Support",
      itemScores: [score({ itemId: "i1" }), score({ itemId: "i2" })],
    }),
  ];

  it("mentions average, learners needing support, and a next action", () => {
    const text = buildSmartSummary({
      assessment,
      results,
      learners,
      itemRows: analyzeItems(items, results),
      competencyRows: competencyMastery(items, results),
    });
    expect(text).toMatch(/average of 60%/);
    expect(text).toMatch(/Juan Cruz/);
    expect(text).toMatch(/Recommended next action/);
  });

  it("handles the empty case without crashing", () => {
    const text = buildSmartSummary({
      assessment,
      results: [],
      learners,
      itemRows: [],
      competencyRows: [],
    });
    expect(text).toMatch(/No checked results/i);
  });

  it("reflection reports the mastery distribution", () => {
    const text = buildReflection({
      assessment,
      results,
      learners,
      itemRows: analyzeItems(items, results),
      competencyRows: competencyMastery(items, results),
    });
    expect(text).toMatch(/1 mastered/);
    expect(text).toMatch(/1 need critical support/);
  });
});
