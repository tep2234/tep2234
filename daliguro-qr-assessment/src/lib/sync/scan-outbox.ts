import { generatePairingToken, validateScanBroadcast, type ScanDetection } from "./pairing";

export interface HeldScan {
  scanId: string;
  sessionId: string;
  assessmentId: string;
  learnerId: string;
  version: string;
  answerMap: Record<string, string>;
  detected: ScanDetection[];
  confidence: number;
  capturedAt: number;
  sequenceNumber: number;
  issuedAt: string;
}

export interface SafeScanDiagnostic {
  syncState: string;
  scan: {
    scanId: string;
    capturedAt: number;
    itemCount: number;
    confidence: number;
    statusCounts: Record<string, number>;
  };
}

// Diagnostics must help support identify pipeline failures without exporting
// pairing credentials, learner identity, assessment identity, or answers.
export function buildSafeScanDiagnostic(
  scan: Pick<HeldScan, "scanId" | "capturedAt" | "detected" | "confidence">,
  syncState: string,
): SafeScanDiagnostic {
  const statusCounts: Record<string, number> = {};
  for (const item of scan.detected) {
    statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
  }
  return {
    syncState,
    scan: {
      scanId: scan.scanId,
      capturedAt: scan.capturedAt,
      itemCount: scan.detected.length,
      confidence: scan.confidence,
      statusCounts,
    },
  };
}

export function generateScanId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `scan_${generatePairingToken(16)}`;
}

export function upsertHeldScan(scans: HeldScan[], scan: HeldScan): HeldScan[] {
  const existingIndex = scans.findIndex((item) => item.scanId === scan.scanId);
  const next = existingIndex >= 0
    ? scans.map((item, index) => (index === existingIndex ? scan : item))
    : scans.concat(scan);
  return next.slice().sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

export function acknowledgeHeldScan(scans: HeldScan[], scanId: string): HeldScan[] {
  return scans.filter((scan) => scan.scanId !== scanId);
}

// Outcome of one transport attempt for a held scan.
//  - accepted: the durable inbox took it; the caller removes it from the queue.
//  - retry:    transient failure (transport, expired capability, out-of-order
//              sequence); keep it queued for a later attempt.
//  - rejected: the inbox will never accept this exact envelope (permanent);
//              the caller drops it and surfaces `code` to the teacher.
export type SendOutcome =
  | { status: "accepted" }
  | { status: "retry" }
  | { status: "rejected"; code: string | null };

export interface OutboxDrainResult {
  transportAccepted: boolean;
  acceptedIds: string[];
  rejected: Array<{ scanId: string; code: string | null }>;
}

// Attempt each held scan in order exactly once. Critical reliability contract:
// a thrown or rejected send for ONE scan must never abort the drain or bubble
// out to the caller's retry guard (which would deadlock auto-retry). Every
// per-scan failure is contained; the loop always runs to completion (or an
// explicit cancel), so the caller's `finally` reset always executes.
export async function drainHeldScans(
  scans: readonly HeldScan[],
  sendOne: (held: HeldScan) => Promise<SendOutcome>,
  isCancelled: () => boolean = () => false,
): Promise<OutboxDrainResult> {
  const result: OutboxDrainResult = {
    transportAccepted: false,
    acceptedIds: [],
    rejected: [],
  };
  for (const held of scans) {
    if (isCancelled()) break;
    let outcome: SendOutcome;
    try {
      outcome = await sendOne(held);
    } catch {
      // e.g. envelope build failure — treat as transient so it stays queued.
      outcome = { status: "retry" };
    }
    if (outcome.status === "accepted") {
      result.transportAccepted = true;
      result.acceptedIds.push(held.scanId);
    } else if (outcome.status === "rejected") {
      result.rejected.push({ scanId: held.scanId, code: outcome.code });
    }
  }
  return result;
}

export function parseHeldScans(raw: string | null, sessionId: string, assessmentId: string): HeldScan[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is HeldScan => {
        if (!value || typeof value !== "object") return false;
        const scan = value as Partial<HeldScan>;
        const shapeValid = (
          typeof scan.scanId === "string" && scan.scanId.length >= 8 &&
          scan.sessionId === sessionId && scan.assessmentId === assessmentId &&
          typeof scan.learnerId === "string" && typeof scan.version === "string" &&
          Array.isArray(scan.detected) && scan.detected.length > 0 &&
          !!scan.answerMap && typeof scan.answerMap === "object" &&
          Number.isFinite(scan.confidence) && Number.isFinite(scan.capturedAt) &&
          Number.isSafeInteger(scan.sequenceNumber) && (scan.sequenceNumber as number) > 0 &&
          typeof scan.issuedAt === "string" && Number.isFinite(Date.parse(scan.issuedAt))
        );
        if (!shapeValid) return false;
        return validateScanBroadcast(
          scan as HeldScan,
          { sessionId, assessmentId },
        ).ok;
      })
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  } catch {
    return [];
  }
}
