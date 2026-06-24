import { describe, expect, it } from "vitest";
import { buildDemoBundle, withDemoBundle } from "../src/lib/demo";
import { emptyState } from "../src/lib/types";
import { buildQrPayload, qrText } from "../src/lib/qr";

describe("buildDemoBundle", () => {
  it("creates 10 items, 5 learners, and versions A & B", () => {
    const b = buildDemoBundle();
    expect(b.items).toHaveLength(10);
    expect(b.learners).toHaveLength(5);
    expect(b.assessment.versions).toEqual(["A", "B"]);
  });

  it("keys every objective item for both versions", () => {
    const b = buildDemoBundle();
    const objective = b.items.filter((i) => i.type === "Multiple Choice");
    objective.forEach((item) => {
      expect(b.answerKeys.A?.[item.id]).toBeTruthy();
      expect(b.answerKeys.B?.[item.id]).toBeTruthy();
    });
  });

  it("never leaks any answer key into a generated demo QR", () => {
    const b = buildDemoBundle();
    const text = qrText(buildQrPayload(b.assessment.id, b.learners[0], "A"));
    expect(text.includes("answerKey")).toBe(false);
    expect(text.includes("correctAnswer")).toBe(false);
    expect(text.includes("score")).toBe(false);
  });

  it("merges into existing state without dropping prior data", () => {
    const base = emptyState();
    const merged = withDemoBundle(base, buildDemoBundle());
    expect(merged.assessments).toHaveLength(1);
    expect(merged.learners).toHaveLength(5);
    expect(Object.keys(merged.answerKeys)).toHaveLength(1);
  });

  it("is idempotent across repeated loads (fixed IDs)", () => {
    let state = emptyState();
    state = withDemoBundle(state, buildDemoBundle());
    const firstLearners = state.learners.length;
    state = withDemoBundle(state, buildDemoBundle());
    // Fixed IDs -> reloading does not duplicate the assessment, items, or learners.
    expect(state.learners.length).toBe(firstLearners);
    expect(state.assessments).toHaveLength(1);
    expect(state.items.filter((i) => i.assessmentId === state.assessments[0].id)).toHaveLength(10);
  });

  it("produces the same assessment + learner IDs every time (cross-device match)", () => {
    const a = buildDemoBundle();
    const b = buildDemoBundle();
    expect(a.assessment.id).toBe(b.assessment.id);
    expect(a.learners.map((l) => l.id)).toEqual(b.learners.map((l) => l.id));
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
  });
});
