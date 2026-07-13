// Strict QR payload parsing + validation.
// Shared by the QR-paste box and the camera scanner so both reject the
// exact same bad inputs. Identity-only is enforced defensively here:
// a QR that carries answer-key-shaped fields is rejected outright, even
// though this app would never produce one.

import type { QrPayload, TestVersion } from "./types";
import { TEST_VERSIONS } from "./types";
import { payloadChecksum } from "./qr";
import { MAX_ITEMS } from "./scanner/omr-template";

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

function qrField(p: Record<string, unknown>, longName: string, shortName: string): unknown {
  return p[longName] ?? p[shortName];
}

// Phase 1 certified sheets require a checksum covering every critical identity
// field. Legacy codes must be reprinted rather than silently defaulted.
function checksumProblem(p: Record<string, unknown>): string | null {
  const rawChecksum = qrField(p, "checksum", "c");
  const checksum = typeof rawChecksum === "string" ? rawChecksum : "";
  if (!checksum) return "QR is missing its required integrity checksum. Reprint this learner's sheet.";
  const rawAssessmentId = qrField(p, "assessmentId", "a");
  const rawLearnerId = qrField(p, "learnerId", "l");
  const rawVersion = qrField(p, "version", "v");
  const rawToken = qrField(p, "securityToken", "t");
  const rawN = qrField(p, "n", "n");
  const assessmentId = typeof rawAssessmentId === "string" ? rawAssessmentId : "";
  const learnerId = typeof rawLearnerId === "string" ? rawLearnerId : "";
  const version = typeof rawVersion === "string" ? rawVersion : "";
  const token = typeof rawToken === "string" ? rawToken : "";
  const n = typeof rawN === "number" ? rawN : 0;
  if (checksum !== payloadChecksum(assessmentId, learnerId, version, token, n)) {
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
  for (const [longName, shortName] of [
    ["assessmentId", "a"],
    ["learnerId", "l"],
    ["version", "v"],
    ["securityToken", "t"],
  ] as const) {
    if (
      Object.prototype.hasOwnProperty.call(p, longName) &&
      Object.prototype.hasOwnProperty.call(p, shortName) &&
      p[longName] !== p[shortName]
    ) {
      return { ok: false, reason: `QR contains conflicting ${longName} identity fields.` };
    }
  }
  for (const field of FORBIDDEN_QR_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(p, field)) {
      return {
        ok: false,
        reason: "Rejected QR: it contains answer/score data. Identity QRs must not carry answers.",
      };
    }
  }
  const rawAssessmentId = qrField(p, "assessmentId", "a");
  const rawLearnerId = qrField(p, "learnerId", "l");
  const assessmentId = typeof rawAssessmentId === "string" ? rawAssessmentId : "";
  const learnerId = typeof rawLearnerId === "string" ? rawLearnerId : "";
  if (!assessmentId || !learnerId) {
    return { ok: false, reason: "QR is missing learner identity fields." };
  }
  const rawVersion = qrField(p, "version", "v");
  if (!isTestVersion(rawVersion)) {
    return { ok: false, reason: "QR is missing a valid sheet version. Reprint this learner's sheet." };
  }
  const version: TestVersion = rawVersion;
  const rawN = qrField(p, "n", "n");
  if (typeof rawN !== "number" || !Number.isInteger(rawN) || rawN < 1 || rawN > MAX_ITEMS) {
    return { ok: false, reason: `QR has an invalid OMR item count. Expected an integer from 1 to ${MAX_ITEMS}.` };
  }
  const rawToken = qrField(p, "securityToken", "t");
  if (typeof rawToken !== "string" || rawToken.length < 12 || rawToken.length > 128) {
    return { ok: false, reason: "QR is missing a valid sheet identity token. Reprint this learner's sheet." };
  }
  const badChecksum = checksumProblem(p);
  if (badChecksum) return { ok: false, reason: badChecksum };
  return {
    ok: true,
    payload: {
      assessmentId,
      learnerId,
      lrn: typeof qrField(p, "lrn", "r") === "string" ? (qrField(p, "lrn", "r") as string) : "",
      section: typeof qrField(p, "section", "s") === "string" ? (qrField(p, "section", "s") as string) : "",
      gradeLevel: typeof qrField(p, "gradeLevel", "g") === "string" ? (qrField(p, "gradeLevel", "g") as string) : "",
      version,
      securityToken: rawToken,
      n: rawN,
      checksum: typeof qrField(p, "checksum", "c") === "string" ? (qrField(p, "checksum", "c") as string) : "",
    },
  };
}

// Parse + validate a raw scanned/pasted string into a trusted identity payload.
export function parseQrPayload(raw: string, ctx: QrParseContext): QrParseResult {
  const decoded = decodeQrPayload(raw);
  if (!decoded.ok) return decoded;
  const { assessmentId, learnerId, version } = decoded.payload;

  if (assessmentId !== ctx.activeAssessmentId) {
    return {
      ok: false,
      reason: "QR is for a different assessment. Set that assessment active first.",
    };
  }

  if (!ctx.hasLearner(learnerId)) {
    return { ok: false, reason: "Learner from QR not found on this device." };
  }

  if (!ctx.versions.includes(version)) {
    return { ok: false, reason: `QR version ${version} is not enabled for this assessment. Reprint the sheet.` };
  }
  return decoded;
}
