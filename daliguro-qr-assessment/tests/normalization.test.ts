import { describe, expect, it } from "vitest";
import {
  acceptedMatch,
  compactText,
  looseText,
  scoringMode,
} from "../src/lib/items";

describe("looseText / compactText", () => {
  it("loose strips punctuation to spaces and collapses", () => {
    expect(looseText("Target-Market!")).toBe("target market");
    expect(looseText("target_market")).toBe("target market");
    expect(looseText("target   market")).toBe("target market");
  });
  it("compact removes all non-alphanumerics", () => {
    expect(compactText("target market")).toBe("targetmarket");
    expect(compactText("TARGET-MARKET")).toBe("targetmarket");
  });
});

describe("acceptedMatch — teacher-friendly", () => {
  const accepted = ["target market"];
  it("matches case/space/punctuation variants of the same answer", () => {
    for (const variant of [
      "target market",
      "Target Market",
      "TARGET MARKET",
      "targetmarket",
      "target-market",
      "target_market",
      "target  market",
    ]) {
      expect(acceptedMatch(variant, accepted)).toBe(true);
    }
  });
  it("matches the spec example TARGETMARKET against 'target market'", () => {
    expect(acceptedMatch("TARGETMARKET", ["target market"])).toBe(true);
  });
  it("does not match a genuinely different answer", () => {
    expect(acceptedMatch("market research", accepted)).toBe(false);
    expect(acceptedMatch("", accepted)).toBe(false);
  });
  it("checks every accepted answer in the list", () => {
    const list = ["target customers", "target consumers"];
    expect(acceptedMatch("Target Consumers", list)).toBe(true);
    expect(acceptedMatch("targetcustomers", list)).toBe(true);
  });
});

describe("scoringMode classification", () => {
  it("buckets each type into objective / text / manual per spec", () => {
    expect(scoringMode("Multiple Choice")).toBe("objective");
    expect(scoringMode("True or False")).toBe("objective");
    expect(scoringMode("Matching Type")).toBe("objective");
    expect(scoringMode("Sequencing")).toBe("objective");
    expect(scoringMode("Identification")).toBe("text");
    expect(scoringMode("Fill in the Blank")).toBe("text");
    expect(scoringMode("Short Answer")).toBe("text");
    expect(scoringMode("Problem Solving")).toBe("manual");
    expect(scoringMode("Essay")).toBe("manual");
    expect(scoringMode("Performance Task")).toBe("manual");
    expect(scoringMode("Oral Assessment")).toBe("manual");
  });
});
