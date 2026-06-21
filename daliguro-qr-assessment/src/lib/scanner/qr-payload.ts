// Camera-scanner phase — QR payload validation.
// Pure logic, no camera/DOM dependency, fully unit-testable.
//
// The QR sheet only ever carries identity fields (see lib/qr.ts). This
// validator double-checks that invariant at the read side too: if a payload
// somehow carries answer-key-shaped data, it is rejected outright rather than
// trusted, even though the writer never puts it there.

import type { Learner, QrPayload, TestVersion } from "../types";
import { TEST_VERSIONS } from "../types";

export type QrValidationResult =
  | { ok: true; payload: QrPayload }
  | { ok: false; error: string };

// Keys that must never appear on an identity-only QR payload. Presence of any
// of these means the payload was tampered with or generated incorrectly.
const FORBIDDEN_KEYS = [
  "answerKey",
  "answerKeys",
  "correctAnswer",
  "acceptedAnswers",
  "score",
  "rawScore",
  "totalScore",
  "percentage",
  "itemScores",
  "answers",
  "key",
  "keys",
];

export const QR_ERRORS = {
  invalidJson: "Invalid QR format.",
  missingAssessmentId: "Invalid QR format.",
  missingLearnerId: "Invalid QR format.",
  missingLrn: "Invalid QR format.",
  missingVersion: "Invalid QR format.",
  wrongAssessment: "This QR belongs to another assessment.",
  unknownLearner: "Learner was not found in this device.",
  invalidVersion: "Invalid test version.",
  teacherOnlyData: "Invalid QR format.",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateQrPayload(
  rawText: string,
  opts: { activeAssessmentId: string; learners: Learner[] },
): QrValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: QR_ERRORS.invalidJson };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: QR_ERRORS.invalidJson };
  }

  const forbidden = FORBIDDEN_KEYS.find((k) =>
    Object.prototype.hasOwnProperty.call(parsed, k),
  );
  if (forbidden) {
    return { ok: false, error: QR_ERRORS.teacherOnlyData };
  }

  const assessmentId = parsed.assessmentId;
  if (typeof assessmentId !== "string" || !assessmentId) {
    return { ok: false, error: QR_ERRORS.missingAssessmentId };
  }

  const learnerId = parsed.learnerId;
  if (typeof learnerId !== "string" || !learnerId) {
    return { ok: false, error: QR_ERRORS.missingLearnerId };
  }

  const lrn = parsed.lrn;
  if (typeof lrn !== "string" || !lrn) {
    return { ok: false, error: QR_ERRORS.missingLrn };
  }

  const version = parsed.version;
  if (typeof version !== "string" || !version) {
    return { ok: false, error: QR_ERRORS.missingVersion };
  }

  if (assessmentId !== opts.activeAssessmentId) {
    return { ok: false, error: QR_ERRORS.wrongAssessment };
  }

  const learner = opts.learners.find((l) => l.id === learnerId);
  if (!learner) {
    return { ok: false, error: QR_ERRORS.unknownLearner };
  }

  if (!(TEST_VERSIONS as readonly string[]).includes(version)) {
    return { ok: false, error: QR_ERRORS.invalidVersion };
  }

  const section = typeof parsed.section === "string" ? parsed.section : "";
  const gradeLevel = typeof parsed.gradeLevel === "string" ? parsed.gradeLevel : "";
  const securityToken =
    typeof parsed.securityToken === "string" ? parsed.securityToken : "";

  return {
    ok: true,
    payload: {
      assessmentId,
      learnerId,
      lrn,
      section,
      gradeLevel,
      version: version as TestVersion,
      securityToken,
    },
  };
}
