import { describe, expect, it } from "vitest";
import type { Item, VersionKey } from "../src/lib/types";
import {
  clamp,
  computeScores,
  emptyInput,
  masteryBand,
  scoreItem,
} from "../src/lib/scoring";

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

describe("clamp", () => {
  it("clamps within bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
    expect(clamp(NaN, 0, 10)).toBe(0);
  });
});

describe("masteryBand", () => {
  it("applies the SmartScan 80/60/40 boundary bands exactly", () => {
    expect(masteryBand(100)).toBe("Mastered");
    expect(masteryBand(80)).toBe("Mastered");
    expect(masteryBand(79.9)).toBe("Near Mastery");
    expect(masteryBand(60)).toBe("Near Mastery");
    expect(masteryBand(59.9)).toBe("Needs Reinforcement");
    expect(masteryBand(40)).toBe("Needs Reinforcement");
    expect(masteryBand(39.9)).toBe("Critical Support");
    expect(masteryBand(0)).toBe("Critical Support");
  });
});

describe("scoreItem — objective (Multiple Choice)", () => {
  it("scores correct vs incorrect responses against the key", () => {
    const it1 = item();
    const input = emptyInput();
    input.responses[it1.id] = "A";
    expect(scoreItem(it1, "A", input).correct).toBe(true);
    expect(scoreItem(it1, "A", input).awarded).toBe(1);

    input.responses[it1.id] = "B";
    expect(scoreItem(it1, "A", input).correct).toBe(false);
    expect(scoreItem(it1, "A", input).awarded).toBe(0);
  });

  it("is case/whitespace tolerant via normalizeText", () => {
    const it1 = item();
    const input = emptyInput();
    input.responses[it1.id] = "  a ";
    expect(scoreItem(it1, "A", input).correct).toBe(true);
  });

  it("treats a blank response as incorrect, not crash-worthy", () => {
    const it1 = item();
    const input = emptyInput();
    const result = scoreItem(it1, "A", input);
    expect(result.blank).toBe(true);
    expect(result.correct).toBe(false);
    expect(result.awarded).toBe(0);
  });

  it("never marks correct against an empty key", () => {
    const it1 = item();
    const input = emptyInput();
    input.responses[it1.id] = "";
    input.responses[it1.id] = "A";
    expect(scoreItem(it1, "", input).correct).toBe(false);
  });

  it("an explicit override replaces the auto score and is clamped to points", () => {
    const it1 = item({ points: 5 });
    const input = emptyInput();
    input.responses[it1.id] = "B"; // wrong
    input.overrides[it1.id] = 999;
    const result = scoreItem(it1, "A", input);
    expect(result.overridden).toBe(true);
    expect(result.awarded).toBe(5); // clamped to points
  });
});

describe("scoreItem — text accepted-answer items", () => {
  it("matches against acceptedAnswers list and correctAnswer", () => {
    const it1 = item({
      type: "Identification",
      correctAnswer: "Mitochondria",
      acceptedAnswers: ["powerhouse of the cell"],
    });
    const input = emptyInput();

    input.responses[it1.id] = "mitochondria";
    expect(scoreItem(it1, "", input).correct).toBe(true);

    input.responses[it1.id] = "Powerhouse Of The Cell";
    expect(scoreItem(it1, "", input).correct).toBe(true);

    input.responses[it1.id] = "nucleus";
    expect(scoreItem(it1, "", input).correct).toBe(false);
  });
});

describe("scoreItem — manual items (Essay etc.)", () => {
  it("ignores response/correctness and uses only the teacher-entered score, clamped", () => {
    const it1 = item({ type: "Essay", points: 10, correctAnswer: "" });
    const input = emptyInput();
    input.manualScores[it1.id] = 7;
    const result = scoreItem(it1, "", input);
    expect(result.manual).toBe(true);
    expect(result.awarded).toBe(7);
    expect(result.correct).toBe(false);

    input.manualScores[it1.id] = 999;
    expect(scoreItem(it1, "", input).awarded).toBe(10);
  });
});

describe("computeScores", () => {
  it("aggregates totals, percentage, and mastery band across mixed item types", () => {
    const items: Item[] = [
      item({ id: "i1", itemNumber: 1, type: "Multiple Choice", points: 1 }),
      item({ id: "i2", itemNumber: 2, type: "True or False", points: 1 }),
      item({ id: "i3", itemNumber: 3, type: "Essay", points: 8, correctAnswer: "" }),
    ];
    const versionKey: VersionKey = { i1: "A", i2: "T" };
    const input = emptyInput();
    input.responses.i1 = "A"; // correct, 1pt
    input.responses.i2 = "F"; // incorrect, 0pt
    input.manualScores.i3 = 6; // manual, 6pt

    const summary = computeScores(items, versionKey, input);
    expect(summary.rawScore).toBe(7);
    expect(summary.totalScore).toBe(10);
    expect(summary.percentage).toBe(70);
    expect(summary.correctCount).toBe(1);
    expect(summary.incorrectCount).toBe(1);
    expect(summary.blankCount).toBe(0);
    expect(summary.masteryStatus).toBe("Near Mastery");
    // item scores are returned sorted by itemNumber
    expect(summary.itemScores.map((s) => s.itemId)).toEqual(["i1", "i2", "i3"]);
  });

  it("returns 0% (not NaN/Infinity) when total possible points is 0", () => {
    const items: Item[] = [];
    const summary = computeScores(items, {}, emptyInput());
    expect(summary.percentage).toBe(0);
    expect(summary.masteryStatus).toBe("Critical Support");
  });
});
