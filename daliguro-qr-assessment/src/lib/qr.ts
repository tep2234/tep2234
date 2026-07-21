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
  securityToken = "",
  omrItemCount = 0,
): string {
  return checksumOf(
    [assessmentId, learnerId, version, securityToken, String(omrItemCount)].join("|"),
  );
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
  const token = buildSecurityToken(assessmentId, learner.id, version);
  return {
    assessmentId,
    learnerId: learner.id,
    lrn: learner.lrn,
    section: learner.section,
    gradeLevel: learner.gradeLevel,
    version,
    securityToken: token,
    n: omrItemCount,
    checksum: payloadChecksum(assessmentId, learner.id, version, token, omrItemCount),
  };
}

// Serialise the payload to the string encoded in the QR image (template v2,
// JSON). Kept so every previously printed sheet stays scannable forever.
export function qrText(payload: QrPayload): string {
  return JSON.stringify({
    a: payload.assessmentId,
    l: payload.learnerId,
    r: payload.lrn,
    s: payload.section,
    g: payload.gradeLevel,
    v: payload.version,
    t: payload.securityToken,
    n: payload.n,
    c: payload.checksum,
  });
}

// ---------------------------------------------------------------------------
// V3 compact payload — SmartScan 98% mandate.
//
// The v2 JSON payload (~150 bytes: ids + LRN + section + grade + 21-char
// token + JSON syntax) forces a ~QR-version-8 symbol. Printed in the 41 mm
// QR zone that is ~0.8 mm/module — below reliable whole-page phone capture.
// V3 carries ONLY the two opaque local ids plus version/count/checksum:
//
//   DG3|<assessmentId>|<learnerId>|<version>|<n>|<sheetToken>|<check>
//
// This remains far smaller than v2 while retaining the random per-sheet token,
// so separate prints for the same learner/version remain distinguishable. No
// names, LRN, section, or teacher data are embedded. Every id consumer
// downstream is unchanged because the payload carries the real local ids.
// ---------------------------------------------------------------------------

export const QR_V3_PREFIX = "DG3";
const V3_SEPARATOR = "|";

export function v3Checksum(
  assessmentId: string,
  learnerId: string,
  version: string,
  omrItemCount: number,
  sheetToken: string,
): string {
  return checksumOf(
    [QR_V3_PREFIX, assessmentId, learnerId, version, String(omrItemCount), sheetToken].join(V3_SEPARATOR),
  );
}

// True when both ids can be embedded unambiguously. All app-generated ids are
// uid() base36 (+underscore), so this only rejects exotic imported ids that
// contain the field separator; those sheets fall back to the v2 JSON payload.
export function canEncodeV3(assessmentId: string, learnerId: string): boolean {
  return (
    assessmentId.length > 0 &&
    learnerId.length > 0 &&
    !assessmentId.includes(V3_SEPARATOR) &&
    !learnerId.includes(V3_SEPARATOR)
  );
}

// Compact v3 QR text. Falls back to the v2 JSON payload when an id cannot be
// embedded safely, so printing never fails and scanners accept both formats.
export function qrTextCompact(payload: QrPayload): string {
  if (!canEncodeV3(payload.assessmentId, payload.learnerId)) return qrText(payload);
  return [
    QR_V3_PREFIX,
    payload.assessmentId,
    payload.learnerId,
    payload.version,
    String(payload.n),
    payload.securityToken,
    v3Checksum(payload.assessmentId, payload.learnerId, payload.version, payload.n, payload.securityToken),
  ].join(V3_SEPARATOR);
}

// The human-readable sheet code printed under the QR. It IS the payload text,
// so a teacher can type it into the SmartScan paste box and take exactly the
// validated QR path when the printed code will not photograph (mandate:
// recoverable completion through the visible sheet code).
export function sheetCodeOf(payload: QrPayload): string {
  return qrTextCompact(payload);
}
