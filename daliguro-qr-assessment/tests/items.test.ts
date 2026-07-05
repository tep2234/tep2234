import { describe, expect, it } from "vitest";
import type { Item } from "../src/lib/types";
import {
  isManual,
  isObjective,
  normalizeText,
  optionSet,
  parseAccepted,
  usesAcceptedAnswers,
} from "../src/lib/items";

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

describe("type classification", () => {
  it("classifies objective, accepted-answer, and manual types disjointly", () => {
    const allTypes: Item["type"][] = [
      "Multiple Choice",
      "True or False",
      "Matching Type",
      "Sequencing",
      "Identification",
      "Fill in the Blank",
      "Short Answer",
      "Problem Solving",
      "Essay",
      "Performance Task",
      "Oral Assessment",
    ];
    allTypes.forEach((type) => {
      const flags = [isObjective(type), usesAcceptedAnswers(type), isManual(type)];
      // exactly one bucket claims each type
      expect(flags.filter(Boolean)).toHaveLength(1);
    });
  });
});

describe("optionSet", () => {
  it("returns T/F for True or False", () => {
    expect(optionSet(item({ type: "True or False" }))).toEqual(["T", "F"]);
  });

  it("returns N letters for Multiple Choice, clamped between 2 and 8", () => {
    expect(optionSet(item({ type: "Multiple Choice", choices: 4 }))).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(optionSet(item({ type: "Multiple Choice", choices: 1 }))).toHaveLength(2);
    expect(optionSet(item({ type: "Multiple Choice", choices: 99 }))).toHaveLength(8);
  });

  it("returns null for free-text item types (e.g. Sequencing, Essay)", () => {
    expect(optionSet(item({ type: "Sequencing" }))).toBeNull();
    expect(optionSet(item({ type: "Essay" }))).toBeNull();
  });
});

describe("normalizeText", () => {
  it("trims, lowercases, and collapses internal whitespace", () => {
    expect(normalizeText("  Mitochondria  ")).toBe("mitochondria");
    expect(normalizeText("Powerhouse   of the   Cell")).toBe("powerhouse of the cell");
  });
});

describe("parseAccepted", () => {
  it("splits a comma list, trims, and drops empty entries", () => {
    expect(parseAccepted("a, b ,, c")).toEqual(["a", "b", "c"]);
    expect(parseAccepted("")).toEqual([]);
  });
});
