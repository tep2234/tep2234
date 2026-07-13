import { describe, expect, it } from "vitest";
import {
  acknowledgeHeldScan,
  buildSafeScanDiagnostic,
  generateScanId,
  parseHeldScans,
  upsertHeldScan,
  type HeldScan,
} from "../src/lib/sync/scan-outbox";

function held(scanId: string, capturedAt: number): HeldScan {
  return {
    scanId,
    sessionId: "session-1",
    assessmentId: "assessment-1",
    learnerId: "learner-1",
    version: "A",
    answerMap: { "1": "B" },
    detected: [{ item: 1, answer: "B", status: "selected", confidence: 0.9 }],
    confidence: 0.9,
    capturedAt,
  };
}

describe("durable scan outbox primitives", () => {
  it("generates stable-looking unique submission ids", () => {
    const first = generateScanId();
    const second = generateScanId();
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first).not.toBe(second);
  });

  it("retries by scan id without creating a duplicate queue entry", () => {
    const first = held("scan-id-0001", 20);
    const retried = { ...first, confidence: 0.95 };
    const queue = upsertHeldScan(upsertHeldScan([], first), retried);
    expect(queue).toHaveLength(1);
    expect(queue[0].confidence).toBe(0.95);
  });

  it("keeps distinct captures and sends them oldest first", () => {
    const queue = upsertHeldScan(
      upsertHeldScan([], held("scan-id-0002", 20)),
      held("scan-id-0001", 10),
    );
    expect(queue.map((scan) => scan.scanId)).toEqual(["scan-id-0001", "scan-id-0002"]);
  });

  it("removes a scan only when its matching committed acknowledgement arrives", () => {
    const queue = [held("scan-id-0001", 10), held("scan-id-0002", 20)];
    expect(acknowledgeHeldScan(queue, "scan-id-0002").map((scan) => scan.scanId)).toEqual(["scan-id-0001"]);
    expect(acknowledgeHeldScan(queue, "unknown")).toEqual(queue);
  });

  it("restores only records for the current session and assessment", () => {
    const valid = held("scan-id-0001", 10);
    const wrongSession = { ...valid, scanId: "scan-id-0002", sessionId: "other" };
    expect(parseHeldScans(JSON.stringify([wrongSession, valid]), "session-1", "assessment-1")).toEqual([valid]);
    expect(parseHeldScans("not-json", "session-1", "assessment-1")).toEqual([]);
  });

  it("redacts credentials, learner identity, assessment identity, and answers from diagnostics", () => {
    const source = held("scan-id-0001", 10);
    const diagnostic = buildSafeScanDiagnostic(source, "failed");
    const serialized = JSON.stringify(diagnostic);
    expect(diagnostic).toEqual({
      syncState: "failed",
      scan: {
        scanId: "scan-id-0001",
        capturedAt: 10,
        itemCount: 1,
        confidence: 0.9,
        statusCounts: { selected: 1 },
      },
    });
    expect(serialized).not.toContain(source.sessionId);
    expect(serialized).not.toContain(source.assessmentId);
    expect(serialized).not.toContain(source.learnerId);
    expect(serialized).not.toContain('"B"');
    expect(serialized.toLowerCase()).not.toContain("token");
  });
});
