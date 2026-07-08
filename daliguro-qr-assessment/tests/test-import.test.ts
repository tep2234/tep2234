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

  it("splits numbered questions without requiring blank lines", () => {
    const text = [
      "Q1 What is 2 + 2?",
      "(A) 3",
      "(B) 4",
      "(C) 5",
      "Answer: B",
      "No. 2 Choose the vowel.",
      "A - B",
      "B - C",
      "C - A",
      "Answer: C",
    ].join("\n");
    const items = parseStructuredText(text);
    expect(items).toHaveLength(2);
    expect(items[0].itemNumber).toBe(1);
    expect(items[0].answers.A).toBe("B");
    expect(items[1].itemNumber).toBe(2);
    expect(items[1].answers.A).toBe("C");
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

  it("detects essay rubric text as manual scoring", () => {
    const items = parseStructuredText("4. Explain why functions matter.\nRubric: 5 pts for complete reasoning.");
    expect(items[0].type).toBe("Essay");
    expect(items[0].explanation).toBe("5 pts for complete reasoning.");
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

  it("summarizes scannable, manual-scoring, and rejected rows", () => {
    const csv = [
      "itemNo,type,question,choiceA,choiceB,answerVersionA,points,competency",
      "1,Multiple Choice,Q1,a,b,A,1,Comp",
      "2,Essay,Explain X,,,,5,Comp",
      "3,Multiple Choice,Q3,a,b,,1,Comp",
    ].join("\n");
    const s = importTest(csv, CTX);
    expect(s.detected).toBe(3);
    expect(s.scannable).toBe(1);
    expect(s.manualScoring).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.blocked).toBe(true);
  });
});

describe("flexible headers & type synonyms", () => {
  it("matches punctuated + alias headers (Item No., Question Text, Answer Key, Score, MELC)", () => {
    const csv = [
      "Item No.,Question Type,Question Text,Choice A,Choice B,Answer Key,Score,MELC",
      "1,MCQ,What is 2 + 2?,3,4,B,2,M6NS-Ia-1",
    ].join("\n");
    const s = importTest(csv, CTX);
    expect(s.detected).toBe(1);
    const row = s.rows[0];
    expect(row.itemNumber).toBe(1);
    expect(row.type).toBe("Multiple Choice"); // "MCQ" synonym
    expect(row.question).toBe("What is 2 + 2?");
    expect(row.points).toBe(2); // "Score" alias
    expect(row.competency).toBe("M6NS-Ia-1"); // "MELC" alias
    expect(row.answers.A).toBe("B"); // "Answer Key" -> backfilled objective key
  });

  it("normalizes short type codes (TF, ID) from the type column", () => {
    const csv = [
      "No.,Type,Question,Correct",
      "1,TF,The sun is a star.,True",
      "2,ID,Largest planet?,Jupiter",
    ].join("\n");
    const s = importTest(csv, CTX);
    expect(s.rows[0].type).toBe("True or False");
    expect(s.rows[1].type).toBe("Identification");
    expect(s.rows[1].correctAnswer).toBe("Jupiter");
  });

  it("keeps good rows ready when one row is broken (no all-or-nothing)", () => {
    const csv = [
      "itemNo,type,question,optionA,optionB,answerVersionA,points,competency,difficulty",
      "1,Multiple Choice,Q1,a,b,A,1,Comp,Easy",
      "2,Multiple Choice,Q2,a,b,,1,Comp,Easy", // missing answer -> error
      "3,Multiple Choice,Q3,a,b,B,1,Comp,Easy",
    ].join("\n");
    const s = importTest(csv, CTX);
    expect(s.detected).toBe(3);
    expect(s.rows[0].status).toBe("ready");
    expect(s.rows[1].status).toBe("error");
    expect(s.rows[2].status).toBe("ready");
  });
});

describe("Word / paste parser enhancements", () => {
  it("uses a section heading to set the item type", () => {
    const text = ["Short Answer", "1. Describe photosynthesis.", "Answer: Plants make food from sunlight"].join("\n");
    const items = parseStructuredText(text);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("Short Answer");
  });

  it("splits options that share one line", () => {
    const text = ["1. Pick one:", "A. Alpha  B. Beta  C. Gamma  D. Delta", "Answer: C"].join("\n");
    const items = parseStructuredText(text);
    expect(items[0].choices).toBe(4);
    expect(items[0].answers.A).toBe("C");
  });

  it("recognizes short answer labels (Ans:, Correct:)", () => {
    expect(parseStructuredText("1. Capital of Japan?\nAns: Tokyo")[0].correctAnswer).toBe("Tokyo");
    expect(parseStructuredText("2. 5 x 5?\nCorrect: 25")[0].correctAnswer).toBe("25");
  });

  it("reads abbreviated labels with dots (Cog.:, Diff.:) and full labels", () => {
    const text = [
      "1. Which statement best explains contemporary art?",
      "A. It is art created only during ancient times",
      "B. It is art created in the present time and reflects current life",
      "C. It is art that avoids technology and social issues",
      "D. It is art made only by national artists",
      "Answer: B",
      "Competency: Explain contemporary art as present-day art.",
      "Difficulty: Easy",
      "Cog.: Understanding",
    ].join("\n");
    const item = parseStructuredText(text)[0];
    expect(item.type).toBe("Multiple Choice");
    expect(item.answers.A).toBe("B");
    expect(item.difficulty).toBe("Easy");
    expect(item.cognitiveLevel).toBe("Understanding");
    expect(item.competency).toBe("Explain contemporary art as present-day art.");
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
