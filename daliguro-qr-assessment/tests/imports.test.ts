import { describe, expect, it } from "vitest";
import { parseItemsCsv } from "../src/lib/item-import";
import {
  flagDuplicateLrns,
  normalizeSex,
  parseLearnersCsv,
} from "../src/lib/learner-import";
import { parseAnswerKeyCsv } from "../src/lib/answer-key-import";

describe("parseItemsCsv", () => {
  const csv =
    "Item No,Type,Question,A,B,C,D,E,Correct Answer,Accepted Answers,Points,Competency,Difficulty\n" +
    "1,Multiple Choice,Purpose of market research?,To guess,To understand,To copy,To avoid,,B,,1,Market Need,Easy\n" +
    "2,True or False,Test before launch,,,,,,T,,1,Validation,Easy\n" +
    '3,Identification,Group most likely to buy?,,,,,,target market,"target customers,target consumers",2,Target Market,Average\n' +
    "4,Essay,Why feedback matters,,,,,,,,5,Feedback,Average";

  it("parses each item with its type, points, and difficulty", () => {
    const { rows, errors } = parseItemsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(4);
    expect(rows[0].type).toBe("Multiple Choice");
    expect(rows[0].options.slice(0, 4)).toEqual([
      "To guess",
      "To understand",
      "To copy",
      "To avoid",
    ]);
    expect(rows[0].choices).toBe(4);
    expect(rows[1].type).toBe("True or False");
    expect(rows[1].correctAnswer).toBe("T");
  });

  it("keeps quoted comma-separated accepted answers intact", () => {
    const { rows } = parseItemsCsv(csv);
    expect(rows[2].acceptedAnswers).toEqual([
      "target customers",
      "target consumers",
    ]);
    expect(rows[2].points).toBe(2);
  });

  it("flags unknown types as errors and skips them", () => {
    const bad = "Type,Question\nBogus Type,Hello";
    const { rows, errors } = parseItemsCsv(bad);
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("warns on zero points and missing option text", () => {
    const csv2 = "Type,Question,A,B,Correct Answer,Points\nMultiple Choice,,,,A,0";
    const { rows } = parseItemsCsv(csv2);
    expect(rows[0].warnings).toContain("zero/invalid points");
    expect(rows[0].warnings).toContain("no question text");
    expect(rows[0].warnings).toContain("no option text");
  });
});

describe("learner import", () => {
  it("normalizes Sex from M/F/Male/Female", () => {
    expect(normalizeSex("Male")).toBe("M");
    expect(normalizeSex("female")).toBe("F");
    expect(normalizeSex("F")).toBe("F");
    expect(normalizeSex("m")).toBe("M");
    expect(normalizeSex("")).toBe("M");
  });

  it("parses learners with full-word Sex and quoted comma names", () => {
    const csv =
      "LRN,Full Name,Sex,Grade Level,Section\n" +
      '123456789001,"DELA CRUZ, JUAN",Male,12,Aristotle\n' +
      "123456789002,Reyes Ana,Female,12,Aristotle";
    const { rows, errors } = parseLearnersCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].fullName).toBe("DELA CRUZ, JUAN");
    expect(rows[0].sex).toBe("M");
    expect(rows[1].sex).toBe("F");
  });

  it("skips rows with no name and reports them", () => {
    const csv = "LRN,Full Name,Sex\n111,,M\n222,Juan,M";
    const { rows, errors } = parseLearnersCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors.length).toBe(1);
  });

  it("flags duplicate LRNs against existing learners", () => {
    const { rows } = parseLearnersCsv(
      "LRN,Full Name\n111,Juan\n222,Ana\n333,Pedro",
    );
    const { duplicates, fresh } = flagDuplicateLrns(rows, ["222"]);
    expect(duplicates.map((d) => d.lrn)).toEqual(["222"]);
    expect(fresh.map((f) => f.lrn)).toEqual(["111", "333"]);
  });
});

describe("parseAnswerKeyCsv", () => {
  it("parses item/version/answer rows", () => {
    const csv = "Item No,Version,Answer\n1,A,B\n2,A,T\n3,A,target market\n1,B,C";
    const { rows, errors } = parseAnswerKeyCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ itemNumber: 1, version: "A", answer: "B" });
    expect(rows[3]).toMatchObject({ itemNumber: 1, version: "B", answer: "C" });
  });

  it("rejects invalid versions and item numbers", () => {
    const csv = "Item No,Version,Answer\nx,A,B\n1,Z,B\n2,A,";
    const { rows, errors } = parseAnswerKeyCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors.length).toBe(3);
  });
});
