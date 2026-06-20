// QR payload construction. Identity only — never any answer data.

import type { Learner, QrPayload, TestVersion } from "./types";
import { securityToken } from "./ids";

// Build a per-sheet security token. Local prototype security only.
export function buildSecurityToken(
  assessmentId: string,
  learnerId: string,
  version: TestVersion,
): string {
  const seed = (assessmentId + learnerId + version).slice(-4).toUpperCase();
  return seed + "-" + securityToken();
}

// Construct the QR payload for one learner sheet.
// Whitelist of identity fields ONLY: no keys, answers, or scores.
export function buildQrPayload(
  assessmentId: string,
  learner: Learner,
  version: TestVersion,
): QrPayload {
  return {
    assessmentId,
    learnerId: learner.id,
    lrn: learner.lrn,
    section: learner.section,
    gradeLevel: learner.gradeLevel,
    version,
    securityToken: buildSecurityToken(assessmentId, learner.id, version),
  };
}

// Serialise the payload to the string encoded in the QR image.
export function qrText(payload: QrPayload): string {
  return JSON.stringify(payload);
}
