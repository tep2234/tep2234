// Strict QR payload parsing + validation.
// Shared by the QR-paste box and the camera scanner so both reject the
// exact same bad inputs. Identity-only is enforced defensively here:
// a QR that carries answer-key-shaped fields is rejected outright, even
// though this app would never produce one.

import type { QrPayload, TestVersion } from "./types";
import { TEST_VERSIONS } from "./types";
import { payloadChecksum } from "./qr";

// Fields that must NEVER appear in a learner-identity QR. If any of these
// is present we treat the QR as hostile/malformed and refuse it.
export const FORBIDDEN_QR_FIELDS = [
  "answerKey",
  "answerKeys",
  "correctAnswer",
  "correctAnswers",
  "acceptedAnswers",
  "key",
  "keys",
  "score",
  "rawScore",
  "totalScore",
  "percentage",
  "itemScores",
  "answers",
] as const;

export type QrParseResult =
  | { ok: true; payload: QrPayload }
  | { ok: false; reason: string };

export interface QrParseContext {
  // The currently active assessment id. QRs for any other assessment are rejected.
  activeAssessmentId: string;
  // Predicate: does this learner id exist on this device?
  hasLearner: (learnerId: string) => boolean;
  // Versions enabled for the active assessment.
  versions: TestVersion[];
}

function isTestVersion(value: unknown): value is TestVersion {
  return typeof value === "string" && (TEST_VERSIONS as readonly string[]).includes(value);
}

// Verify the integrity checksum when the QR carries one. Old QRs without a
// checksum still pass; a QR whose checksum no longer matches its identity
// triple was damaged or edited and is refused.
function checksumProblem(p: Record<string, unknown>): string | null {
  const checksum = typeof p.checksum === "string" ? p.checksum : "";
  if (!checksum) return null;
  const assessmentId = typeof p.assessmentId === "string" ? p.assessmentId : "";
  const learnerId = typeof p.learnerId === "string" ? p.learnerId : "";
  const version = typeof p.version === "string" ? p.version : "";
  if (checksum !== payloadChecksum(assessmentId, learnerId, version)) {
    return "QR failed its integrity check (damaged or altered). Reprint this learner's sheet.";
  }
  return null;
}

// Shape-only decode: validates the payload is a well-formed identity QR, WITHOUT
// checking whether the assessment/learner exist on this device. Identity
// resolution against local data is a separate step (see scanner/resolve.ts), so
// a successfully decoded QR is never reported as "rejected".
export function decodeQrPayload(raw: string): QrParseResult {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "Empty QR. Nothing to read." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Not a DALIguro identity code (invalid format)." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "Not a DALIguro identity code." };
  }
  const p = parsed as Record<string, unknown>;
  for (const field of FORBIDDEN_QR_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(p, field)) {
      return {
        ok: false,
        reason: "Rejected QR: it contains answer/score data. Identity QRs must not carry answers.",
      };
    }
  }
  const assessmentId = typeof p.assessmentId === "string" ? p.assessmentId : "";
  const learnerId = typeof p.learnerId === "string" ? p.learnerId : "";
  if (!assessmentId || !learnerId) {
    return { ok: false, reason: "QR is missing learner identity fields." };
  }
  const badChecksum = checksumProblem(p);
  if (badChecksum) return { ok: false, reason: badChecksum };
  const rawVersion = p.version;
  const version: TestVersion = isTestVersion(rawVersion) ? rawVersion : "A";
  return {
    ok: true,
    payload: {
      assessmentId,
      learnerId,
      lrn: typeof p.lrn === "string" ? p.lrn : "",
      section: typeof p.section === "string" ? p.section : "",
      gradeLevel: typeof p.gradeLevel === "string" ? p.gradeLevel : "",
      version,
      securityToken: typeof p.securityToken === "string" ? p.securityToken : "",
      n: typeof p.n === "number" && Number.isFinite(p.n) ? p.n : 0,
      checksum: typeof p.checksum === "string" ? p.checksum : "",
    },
  };
}

// Parse + validate a raw scanned/pasted string into a trusted identity payload.
export function parseQrPayload(raw: string, ctx: QrParseContext): QrParseResult {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "Empty QR. Nothing to read." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Invalid QR: not a DALIguro identity code." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "Invalid QR: not a DALIguro identity code." };
  }

  const p = parsed as Record<string, unknown>;

  // Defensive: refuse anything that looks like it smuggles answers/scores.
  for (const field of FORBIDDEN_QR_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(p, field)) {
      return {
        ok: false,
        reason: "Rejected QR: it contains answer/score data. Identity QRs must not carry answers.",
      };
    }
  }

  const assessmentId = typeof p.assessmentId === "string" ? p.assessmentId : "";
  const learnerId = typeof p.learnerId === "string" ? p.learnerId : "";
  if (!assessmentId || !learnerId) {
    return { ok: false, reason: "Invalid QR: missing learner identity fields." };
  }

  const badChecksum = checksumProblem(p);
  if (badChecksum) return { ok: false, reason: badChecksum };

  if (assessmentId !== ctx.activeAssessmentId) {
    return {
      ok: false,
      reason: "QR is for a different assessment. Set that assessment active first.",
    };
  }

  if (!ctx.hasLearner(learnerId)) {
    return { ok: false, reason: "Learner from QR not found on this device." };
  }

  // Version: fall back to the first enabled version if absent/unknown.
  const rawVersion = p.version;
  let version: TestVersion = ctx.versions[0] ?? "A";
  if (isTestVersion(rawVersion)) {
    version = ctx.versions.includes(rawVersion) ? rawVersion : version;
  }

  const payload: QrPayload = {
    assessmentId,
    learnerId,
    lrn: typeof p.lrn === "string" ? p.lrn : "",
    section: typeof p.section === "string" ? p.section : "",
    gradeLevel: typeof p.gradeLevel === "string" ? p.gradeLevel : "",
    version,
    securityToken: typeof p.securityToken === "string" ? p.securityToken : "",
    n: typeof p.n === "number" && Number.isFinite(p.n) ? p.n : 0,
    checksum: typeof p.checksum === "string" ? p.checksum : "",
  };
  return { ok: true, payload };
}
