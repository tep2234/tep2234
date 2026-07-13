import { describe, expect, it } from "vitest";
import { resolveScanIdentity } from "../src/lib/scanner/resolve";
import { buildQrPayload, qrText } from "../src/lib/qr";
import { emptyState } from "../src/lib/types";
import type { Assessment, Learner, QrAssessmentState } from "../src/lib/types";

function assessment(id: string): Assessment {
  return {
    id,
    title: "Demo",
    subject: "Math",
    gradeLevel: "11",
    section: "A",
    schoolYear: "2026-2027",
    term: "First",
    component: "Written Work",
    versions: ["A", "B"],
    teacherName: "T",
    createdAt: 1,
    updatedAt: 1,
  };
}
function learner(id: string): Learner {
  return { id, lrn: "1", fullName: "Juan", sex: "M", gradeLevel: "11", section: "A" };
}
function stateWith(a: Assessment[], l: Learner[]): QrAssessmentState {
  return { ...emptyState(), assessments: a, learners: l };
}
function qrFor(assessmentId: string, learnerId: string, version: "A" | "B" = "A") {
  return qrText(buildQrPayload(assessmentId, { ...learner(learnerId) }, version, 10));
}

describe("resolveScanIdentity", () => {
  it("READY when assessment is active, learner present", () => {
    const st = stateWith([assessment("A1")], [learner("L1")]);
    const r = resolveScanIdentity(qrFor("A1", "L1"), st, "A1");
    expect(r.status).toBe("READY");
    if (r.status === "READY") expect(r.learner.id).toBe("L1");
  });

  it("ASSESSMENT_NOT_ACTIVE when loaded but another (or none) is active", () => {
    const st = stateWith([assessment("A1")], [learner("L1")]);
    const r = resolveScanIdentity(qrFor("A1", "L1"), st, null);
    expect(r.status).toBe("ASSESSMENT_NOT_ACTIVE");
  });

  it("ASSESSMENT_NOT_FOUND when the assessment isn't on this device", () => {
    const st = stateWith([assessment("OTHER")], [learner("L1")]);
    const r = resolveScanIdentity(qrFor("A1", "L1"), st, "OTHER");
    expect(r.status).toBe("ASSESSMENT_NOT_FOUND");
  });

  it("LEARNER_NOT_FOUND when assessment present but learner isn't (the reported failure)", () => {
    const st = stateWith([assessment("A1")], [learner("OTHER")]);
    const r = resolveScanIdentity(qrFor("A1", "L1"), st, "A1");
    expect(r.status).toBe("LEARNER_NOT_FOUND");
    if (r.status === "LEARNER_NOT_FOUND") expect(r.assessment.id).toBe("A1");
  });

  it("QR_PAYLOAD_INVALID for non-JSON", () => {
    const r = resolveScanIdentity("not-a-qr", stateWith([], []), null);
    expect(r.status).toBe("QR_PAYLOAD_INVALID");
  });

  it("QR_PAYLOAD_INVALID for answer-key-shaped payloads (still never 'rejected as decoded')", () => {
    const hostile = JSON.stringify({ assessmentId: "A1", learnerId: "L1", answerKey: { 1: "A" } });
    const r = resolveScanIdentity(hostile, stateWith([assessment("A1")], [learner("L1")]), "A1");
    expect(r.status).toBe("QR_PAYLOAD_INVALID");
  });

  it("rejects the QR when its version is not enabled instead of silently changing it", () => {
    const a = { ...assessment("A1"), versions: ["B"] as ("A" | "B")[] };
    const st = stateWith([a], [learner("L1")]);
    const r = resolveScanIdentity(qrFor("A1", "L1", "A"), st, "A1");
    expect(r.status).toBe("QR_PAYLOAD_INVALID");
  });
});
