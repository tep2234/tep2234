// Resolve a decoded QR against LOCAL data, as a separate stage from QR decoding
// and from image quality. A successfully decoded QR is never "rejected" — it
// resolves to one of these explicit outcomes so the UI can guide recovery.
//
// This app's identity model is intentionally small (no separate workspace/form
// objects): a QR carries assessmentId + learnerId + version. We resolve against
// ALL local assessments/learners (not only the active one) so we can tell the
// difference between "not loaded here" and "loaded but not active".

import type {
  Assessment,
  Learner,
  QrAssessmentState,
  QrPayload,
  TestVersion,
} from "../types";
import { decodeQrPayload } from "../qr-parse";

export type ScanStatus =
  | "QR_PAYLOAD_INVALID"
  | "ASSESSMENT_NOT_FOUND"
  | "LEARNER_NOT_FOUND"
  | "ASSESSMENT_NOT_ACTIVE"
  | "READY";

export type ScanResolution =
  | { status: "QR_PAYLOAD_INVALID"; reason: string }
  | { status: "ASSESSMENT_NOT_FOUND"; payload: QrPayload }
  | { status: "LEARNER_NOT_FOUND"; payload: QrPayload; assessment: Assessment }
  | {
      status: "ASSESSMENT_NOT_ACTIVE";
      payload: QrPayload;
      assessment: Assessment;
      learner: Learner;
      version: TestVersion;
    }
  | {
      status: "READY";
      payload: QrPayload;
      assessment: Assessment;
      learner: Learner;
      version: TestVersion;
    };

export function resolveScanIdentity(
  raw: string,
  state: QrAssessmentState,
  activeId: string | null,
): ScanResolution {
  const decoded = decodeQrPayload(raw);
  if (!decoded.ok) return { status: "QR_PAYLOAD_INVALID", reason: decoded.reason };
  const payload = decoded.payload;

  const assessment = state.assessments.find((a) => a.id === payload.assessmentId);
  if (!assessment) return { status: "ASSESSMENT_NOT_FOUND", payload };

  if (!assessment.versions.includes(payload.version)) {
    return {
      status: "QR_PAYLOAD_INVALID",
      reason: `QR version ${payload.version} is not enabled for ${assessment.title}. Reprint the sheet.`,
    };
  }

  const learner = state.learners.find((l) => l.id === payload.learnerId);
  if (!learner) return { status: "LEARNER_NOT_FOUND", payload, assessment };

  const version: TestVersion = payload.version;

  if (activeId !== assessment.id) {
    return { status: "ASSESSMENT_NOT_ACTIVE", payload, assessment, learner, version };
  }
  return { status: "READY", payload, assessment, learner, version };
}
