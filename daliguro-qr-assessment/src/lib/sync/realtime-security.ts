import { hashToken, type ScanBroadcast, type ScoreBroadcast } from "./pairing";

export const CAPABILITY_STORAGE_PREFIX = "smartscan_capability_";
export const SEQUENCE_STORAGE_PREFIX = "smartscan_sequence_";

export interface PhoneCapability {
  sessionId: string;
  capability: string;
  capabilityExpiresAtMs: number;
  assessmentId: string;
  schoolId: string;
  itemCount: number;
  allowedVersions: string[];
  nextSequence: number;
}

export interface PhoneSubmissionEnvelope {
  sessionId: string;
  capability: string;
  messageId: string;
  sequenceNumber: number;
  issuedAt: string;
  payloadText: string;
  payloadDigest: string;
}

export type PhoneSubmissionState = "received" | "processed" | "rejected";

export interface PhoneSubmissionStatus {
  status: PhoneSubmissionState;
  inboxReceiptId: string;
  resultReceiptId: string | null;
  score: ScoreBroadcast | null;
  rejectionCode: string | null;
  receivedAt: string;
  completedAt: string | null;
}

export interface PhoneInboxRow {
  id: string;
  session_id: string;
  teacher_user_id: string;
  school_id: string;
  assessment_id: string;
  message_id: string;
  sequence_number: number;
  issued_at: string;
  payload: ScanBroadcast;
  payload_digest: string;
  status: PhoneSubmissionState;
  result_receipt_id: string | null;
  score_summary: ScoreBroadcast | null;
  rejection_code: string | null;
  received_at: string;
  completed_at: string | null;
}

export function phonePayloadText(scan: ScanBroadcast): string {
  // Construct a fresh object in a fixed order. The server hashes these exact
  // UTF-8 bytes before parsing JSON, so any payload edit invalidates the digest.
  return JSON.stringify({
    scanId: scan.scanId,
    sessionId: scan.sessionId,
    assessmentId: scan.assessmentId,
    learnerId: scan.learnerId,
    version: scan.version,
    answerMap: scan.answerMap,
    detected: scan.detected,
    confidence: scan.confidence,
    capturedAt: scan.capturedAt,
    ...(scan.identitySource ? { identitySource: scan.identitySource } : {}),
    ...(scan.deviceName ? { deviceName: scan.deviceName.slice(0, 160) } : {}),
  });
}

export async function buildPhoneSubmissionEnvelope(args: {
  capability: PhoneCapability;
  scan: ScanBroadcast;
  sequenceNumber: number;
  issuedAt?: Date;
}): Promise<PhoneSubmissionEnvelope> {
  if (args.scan.sessionId !== args.capability.sessionId) {
    throw new Error("phone_submission_session_mismatch");
  }
  if (args.scan.assessmentId !== args.capability.assessmentId) {
    throw new Error("phone_submission_assessment_mismatch");
  }
  if (!Number.isSafeInteger(args.sequenceNumber) || args.sequenceNumber < 1) {
    throw new Error("phone_submission_sequence_invalid");
  }
  const payloadText = phonePayloadText(args.scan);
  return {
    sessionId: args.capability.sessionId,
    capability: args.capability.capability,
    messageId: args.scan.scanId,
    sequenceNumber: args.sequenceNumber,
    issuedAt: (args.issuedAt ?? new Date()).toISOString(),
    payloadText,
    payloadDigest: await hashToken(payloadText),
  };
}

export function capabilityStorageKey(sessionId: string): string {
  return `${CAPABILITY_STORAGE_PREFIX}${sessionId}`;
}

export function sequenceStorageKey(sessionId: string): string {
  return `${SEQUENCE_STORAGE_PREFIX}${sessionId}`;
}

export function savePhoneCapability(storage: Storage, value: PhoneCapability): void {
  storage.setItem(capabilityStorageKey(value.sessionId), JSON.stringify(value));
}

export function loadPhoneCapability(storage: Storage, sessionId: string, now = Date.now()): PhoneCapability | null {
  try {
    const raw = storage.getItem(capabilityStorageKey(sessionId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PhoneCapability>;
    const valid = value.sessionId === sessionId &&
      typeof value.capability === "string" && /^[0-9a-f]{64}$/.test(value.capability) &&
      typeof value.capabilityExpiresAtMs === "number" && value.capabilityExpiresAtMs > now &&
      typeof value.assessmentId === "string" && !!value.assessmentId &&
      typeof value.schoolId === "string" && !!value.schoolId &&
      Number.isInteger(value.itemCount) && (value.itemCount as number) > 0 &&
      Array.isArray(value.allowedVersions) && value.allowedVersions.length > 0 &&
      Number.isInteger(value.nextSequence) && (value.nextSequence as number) > 0;
    if (!valid) {
      storage.removeItem(capabilityStorageKey(sessionId));
      return null;
    }
    return value as PhoneCapability;
  } catch {
    storage.removeItem(capabilityStorageKey(sessionId));
    return null;
  }
}

export function clearPhoneCapability(storage: Storage, sessionId: string): void {
  storage.removeItem(capabilityStorageKey(sessionId));
  storage.removeItem(sequenceStorageKey(sessionId));
}

export function nextPhoneSequence(storage: Storage, capability: PhoneCapability): number {
  const key = sequenceStorageKey(capability.sessionId);
  const stored = Number(storage.getItem(key));
  const next = Number.isSafeInteger(stored) && stored >= capability.nextSequence
    ? stored + 1
    : capability.nextSequence;
  storage.setItem(key, String(next));
  return next;
}

export function stripPairingSecretFromUrl(location: Pick<Location, "pathname" | "hash">, history: Pick<History, "replaceState">): void {
  history.replaceState(null, "", `${location.pathname}${location.hash || ""}`);
}

export function safePhoneError(code: string | null | undefined): string {
  switch (code) {
    case "learner_or_version_invalid":
      return "This learner or sheet version is not assigned to the pairing session.";
    case "duplicate_requires_review":
      return "A pending result already exists for this learner. Ask the teacher to review it before rescanning.";
    case "durable_commit_failed":
      return "The database did not confirm the final receipt. The secured inbox copy is retained for teacher recovery.";
    default:
      return "The PC rejected this scan during secure validation. The inbox copy is retained for teacher review.";
  }
}
