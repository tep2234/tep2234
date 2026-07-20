import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreservedRecovery } from "../src/components/scanner/ScanRecovery";
import type { PreservedSheet } from "../src/lib/scanner/still-pipeline";
import { emptyState, type Learner, type QrAssessmentState } from "../src/lib/types";

const learners: Learner[] = [
  { id: "same-1", lrn: "1001", fullName: "Ana Same", sex: "F", gradeLevel: "12", section: "Aristotle" },
  { id: "same-2", lrn: "1002", fullName: "Ben Same", sex: "M", gradeLevel: "12", section: "Aristotle" },
  { id: "other", lrn: "9001", fullName: "Cara Cross Section", sex: "F", gradeLevel: "12", section: "Bonifacio" },
];

const state: QrAssessmentState = {
  ...emptyState(),
  assessments: [{
    id: "assessment-1",
    title: "Recovery Quiz",
    subject: "Math",
    gradeLevel: "12",
    section: "Aristotle",
    schoolYear: "2026-2027",
    term: "First",
    component: "Written Work",
    versions: ["A"],
    teacherName: "Teacher",
    createdAt: 1,
    updatedAt: 1,
  }],
  learners,
};

const preserved = {
  assessmentId: "assessment-1",
  version: "A",
  reading: {
    items: [{ status: "selected" }],
  },
} as unknown as PreservedSheet;

describe("PreservedRecovery learner cohort", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onIdentify = vi.fn();

  beforeEach(() => {
    onIdentify.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => {
      root.render(
        <PreservedRecovery
          preserved={preserved}
          state={state}
          onIdentify={onIdentify}
          onDismiss={() => undefined}
        />,
      );
    });
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  function learnerSelect(): HTMLSelectElement {
    const select = container.querySelector('select[aria-label="Learner on this sheet"]');
    if (!(select instanceof HTMLSelectElement)) throw new Error("Learner select was not rendered.");
    return select;
  }

  it("prioritizes the matching grade and section, then explicitly expands and searches all learners", () => {
    expect(learnerSelect().textContent).toContain("Ana Same");
    expect(learnerSelect().textContent).toContain("Ben Same");
    expect(learnerSelect().textContent).not.toContain("Cara Cross Section");
    expect(container.textContent).toContain("Prioritized 12 · Aristotle learners (2)");

    const expand = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Search all learners"),
    );
    if (!(expand instanceof HTMLButtonElement)) throw new Error("All-learners expansion was not rendered.");
    flushSync(() => expand.click());

    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(learnerSelect().textContent).toContain("Cara Cross Section");

    const search = container.querySelector('input[aria-label="Search all learners"]');
    if (!(search instanceof HTMLInputElement)) throw new Error("All-learners search was not rendered.");
    flushSync(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(search, "9001");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(learnerSelect().textContent).toContain("Cara Cross Section");
    expect(learnerSelect().textContent).not.toContain("Ana Same");

    flushSync(() => {
      learnerSelect().value = "other";
      learnerSelect().dispatchEvent(new Event("change", { bubbles: true }));
    });
    const useAnswers = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Use these answers"),
    );
    if (!(useAnswers instanceof HTMLButtonElement)) throw new Error("Use answers button was not rendered.");
    flushSync(() => useAnswers.click());
    expect(onIdentify).toHaveBeenCalledWith("other");
  });
});
