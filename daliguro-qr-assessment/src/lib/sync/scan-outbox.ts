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
