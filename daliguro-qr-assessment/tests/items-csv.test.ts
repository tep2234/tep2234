import { describe, expect, it } from "vitest";
import { buildItemsImport, parseItemsCsv } from "../src/lib/items-csv";

const HEADER =
  "itemNo,type,question,optionA,optionB,optionC,optionD,answerVersionA,answerVersionB,points,competency,difficulty";

function row(no: number, vA: string, vB: string) {
  return `${no},Multiple Choice,Q${no},Opt A,Opt B,Opt C,Opt D,${vA},${vB},1,Comp,Average`;
}

describe("parseItemsCsv", () => {
  it("parses the test-pack format with two versions", () => {
    const csv = [HEADER, row(1, "B", "D"), row(2, "C", "A")].join("\n");
    const res = parseItemsCsv(csv);
    expect(res.errors).toEqual([]);
    expect(res.items).toHaveLength(2);
    expect(res.versions).toEqual(["A", "B"]);
    expect(res.items[0].answers).toEqual({ A: "B", B: "D" });
    expect(res.items[0].choices).toBe(4);
    expect(res.items[1].type).toBe("Multiple Choice");
  });

  it("errors when the question column is missing", () => {
    const res = parseItemsCsv("itemNo,optionA\n1,foo");
    expect(res.items).toHaveLength(0);
    expect(res.errors.join(" ")).toMatch(/question/i);
  });

  it("skips rows with no question but keeps valid ones", () => {
    const csv = [HEADER, row(1, "B", "D"), `2,Multiple Choice,,a,b,c,d,A,A,1,,`].join("\n");
    const res = parseItemsCsv(csv);
    expect(res.items).toHaveLength(1);
    expect(res.errors.join(" ")).toMatch(/no question/i);
  });

  it("rejects an answer letter outside the choice range", () => {
    // Only options A,B given (choices=2) but answer is C.
    const csv = ["itemNo,question,optionA,optionB,answerVersionA", "1,Q1,Yes,No,C"].join("\n");
    const res = parseItemsCsv(csv);
    expect(res.items[0].answers.A).toBeUndefined();
    expect(res.errors.join(" ")).toMatch(/outside choices/i);
  });

  it("uppercases answer letters and handles lower-case version headers", () => {
    const csv = ["question,optiona,optionb,optionc,optiond,answera", "Q,a,b,c,d,b"].join("\n");
    const res = parseItemsCsv(csv);
    expect(res.items[0].answers.A).toBe("B");
  });

  it("accepts Excel-friendly template headers", () => {
    const csv = [
      "Item No.,Type,Question,Choice A,Choice B,Choice C,Choice D,Correct Answer,Learning Target,Explanation",
      "1,Multiple Choice,Best answer?,Alpha,Beta,Gamma,Delta,C,Functions,Choice C is the intended key.",
    ].join("\n");
    const res = parseItemsCsv(csv);
    expect(res.errors).toEqual([]);
    expect(res.items[0].choices).toBe(4);
    expect(res.items[0].answers.A).toBeUndefined();
    expect(res.items[0].correctAnswer).toBe("C");
    expect(res.items[0].explanation).toBe("Choice C is the intended key.");
  });

  it("supports identification items with accepted answers", () => {
    const csv = [
      "itemNo,type,question,correctAnswer,acceptedAnswers,points",
      "1,Identification,Capital of PH,Manila,\"Manila, City of Manila\",2",
    ].join("\n");
    const res = parseItemsCsv(csv);
    expect(res.items[0].type).toBe("Identification");
    expect(res.items[0].correctAnswer).toBe("Manila");
    expect(res.items[0].acceptedAnswers).toEqual(["Manila", "City of Manila"]);
    expect(res.items[0].points).toBe(2);
  });
});

describe("buildItemsImport", () => {
  it("creates items with ids and per-version key maps", () => {
    const csv = [HEADER, row(1, "B", "D"), row(2, "C", "A")].join("\n");
    const parsed = parseItemsCsv(csv);
    const built = buildItemsImport("A1", parsed.items);
    expect(built.items).toHaveLength(2);
    built.items.forEach((i) => {
      expect(i.assessmentId).toBe("A1");
      expect(i.id).toBeTruthy();
    });
    const id0 = built.items[0].id;
    const id1 = built.items[1].id;
    expect(built.keys.A).toEqual({ [id0]: "B", [id1]: "C" });
    expect(built.keys.B).toEqual({ [id0]: "D", [id1]: "A" });
  });

  it("never places answer letters anywhere but the key map", () => {
    const parsed = parseItemsCsv([HEADER, row(1, "B", "D")].join("\n"));
    const built = buildItemsImport("A1", parsed.items);
    // The Item itself carries no objective answer (correctAnswer stays empty).
    expect(built.items[0].correctAnswer).toBe("");
  });
});
