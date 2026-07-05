import { describe, expect, it } from "vitest";
import {
  buildImport,
  importTest,
  looksLikeCsv,
  parseStructuredText,
} from "../src/lib/test-import";
import type { TestVersion } from "../src/lib/types";

const CTX = { versions: ["A", "B"] as TestVersion[] };

describe("looksLikeCsv", () => {
  it("detects a delimited header with a known column", () => {
    expect(looksLikeCsv("itemNo,question,optionA\n1,Q,foo")).toBe(true);
    expect(looksLikeCsv("1. What is a function?\nA. one\nAnswer: A")).toBe(false);
  });
});

describe("parseStructuredText (Word / pasted blocks)", () => {
  it("parses a numbered MC block with choices and an answer", () => {
    const text = [
      "1. What is a function?",
      "A. one output per input",
      "B. random numbers",
      "C. a line",
      "D. an equation",
      "Answer: A",
      "Competency: Represents functions",
      "Difficulty: Easy",
      "Cognitive Level: Understanding",
    ].join("\n");
    const items = parseStructuredText(text);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("Multiple Choice");
    expect(items[0].choices).toBe(4);
    expect(items[0].answers.A).toBe("A");
    expect(items[0].competency).toBe("Represents functions");
    expect(items[0].difficulty).toBe("Easy");
  });

  it("detects True/False from the answer", () => {
    const items = parseStructuredText("2. The earth is flat.\nAnswer: False");
    expect(items[0].type).toBe("True or False");
    expect(items[0].answers.A).toBe("F");
  });

  it("detects Enumeration from a comma answer", () => {
    const items = parseStructuredText("3. List two primary colors.\nAnswer: red, blue");
    expect(items[0].type).toBe("Enumeration");
    expect(items[0].acceptedAnswers).toEqual(["red", "blue"]);
  });
});

describe("importTest — validation, status, confidence", () => {
  it("marks a complete MC item ready", () => {
    const csv = [
      "itemNo,type,question,optionA,optionB,optionC,optionD,answerVersionA,answerVersionB,points,competency,difficulty",
      "1,Multiple Choice,Q1,a,b,c,d,B,C,1,Comp,Easy",
    ].join("\n");
    const s = importTest(csv, CTX);
    expect(s.detected).toBe(1);
    expect(s.rows[0].status).toBe("ready");
    expect(s.rows[0].confidence).toBeGreaterThanOrEqual(0.95);
    expect(s.blocked).toBe(false);
  });

  it("blocks on a missing correct answer (critical)", () => {
    const csv = [
      "itemNo,type,question,optionA,optionB,optionC,optionD,answerVersionA,points,competency,difficulty",
      "1,Multiple Choice,Q1,a,b,c,d,,1,Comp,Easy",
    ].join("\n");
    const s = importTest(csv, CTX);
    expect(s.rows[0].status).toBe("error");
    expect(s.blocked).toBe(true);
    expect(s.rows[0].issues.some((i) => /correct answer/i.test(i.text))).toBe(true);
  });

  it("blocks on an answer key outside the choice range", () => {
    const csv = [
      "itemNo,question,optionA,optionB,answerVersionA",
      "1,Q1,yes,no,C",
    ].join("\n");
    const s = importTest(csv, CTX);
    expect(s.blocked).toBe(true); // key stripped -> item has no valid answer
    // The out-of-range letter is reported at parse time.
    expect(s.parseErrors.join(" ")).toMatch(/outside choices/i);
  });

  it("detects skipped and duplicate item numbers", () => {
    const text = [
      "1. First\nAnswer: red",
      "3. Third\nAnswer: blue",
      "3. Dup\nAnswer: green",
    ].join("\n\n");
    const s = importTest(text, CTX);
    expect(s.skippedNumbers).toContain(2);
    expect(s.duplicateNumbers).toContain(3);
    expect(s.blocked).toBe(true); // duplicate is critical
  });

  it("flags a manual-check item as manual, not error", () => {
    const csv = ["itemNo,type,question,points,competency", "1,Essay,Explain X,5,Comp"].join("\n");
    const s = importTest(csv, CTX);
    expect(s.rows[0].status).toBe("manual");
    expect(s.blocked).toBe(false);
  });
});

describe("buildImport", () => {
  it("broadcasts a single answer across all enabled versions", () => {
    const s = importTest(
      ["itemNo,type,question,optionA,optionB,correctAnswer,points", "1,Multiple Choice,Q,a,b,A,1"].join("\n"),
      CTX,
    );
    // structured CSV with a single correctAnswer -> answers.A set by the row editor path;
    // here we simulate the confirmed row carrying answers.A only.
    const rows = s.rows.map((r) => ({ ...r, answers: { A: "A" } }));
    const built = buildImport("A1", rows, ["A", "B"]);
    expect(built.items).toHaveLength(1);
    const id = built.items[0].id;
    expect(built.keys.A?.[id]).toBe("A");
    expect(built.keys.B?.[id]).toBe("A"); // broadcast to B
    expect(built.items[0].assessmentId).toBe("A1");
  });

  it("keeps distinct per-version answers when supplied", () => {
    const s = importTest(
      [
        "itemNo,type,question,optionA,optionB,optionC,optionD,answerVersionA,answerVersionB,points",
        "1,Multiple Choice,Q,a,b,c,d,B,D,1",
      ].join("\n"),
      CTX,
    );
    const built = buildImport("A1", s.rows, ["A", "B"]);
    const id = built.items[0].id;
    expect(built.keys.A?.[id]).toBe("B");
    expect(built.keys.B?.[id]).toBe("D");
  });
});
