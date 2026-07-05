// QR payload construction. Identity only — never any answer data.

import type { Learner, QrPayload, TestVersion } from "./types";
import { checksumOf, securityToken } from "./ids";

// Build a per-sheet security token. Local prototype security only.
export function buildSecurityToken(
  assessmentId: string,
  learnerId: string,
  version: TestVersion,
): string {
  const seed = (assessmentId + learnerId + version).slice(-4).toUpperCase();
  return seed + "-" + securityToken();
}

// Integrity checksum over the identity triple. A tampered/damaged QR whose
// checksum no longer matches is refused by the validator.
export function payloadChecksum(
  assessmentId: string,
  learnerId: string,
  version: string,
): string {
  return checksumOf(assessmentId + "|" + learnerId + "|" + version);
}

// Construct the QR payload for one learner sheet.
// Whitelist of identity fields ONLY: no keys, answers, or scores.
// `omrItemCount` = how many OMR items the sheet is printed with, so the
// scanner can detect stale sheets after the item bank changes.
export function buildQrPayload(
  assessmentId: string,
  learner: Learner,
  version: TestVersion,
  omrItemCount: number,
): QrPayload {
  return {
    assessmentId,
    learnerId: learner.id,
    lrn: learner.lrn,
    section: learner.section,
    gradeLevel: learner.gradeLevel,
    version,
    securityToken: buildSecurityToken(assessmentId, learner.id, version),
    n: omrItemCount,
    checksum: payloadChecksum(assessmentId, learner.id, version),
  };
}

// Serialise the payload to the string encoded in the QR image.
export function qrText(payload: QrPayload): string {
  return JSON.stringify(payload);
}
