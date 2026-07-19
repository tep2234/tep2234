import { describe, expect, it } from "vitest";
import {
  acknowledgeHeldScan,
  buildSafeScanDiagnostic,
  drainHeldScans,
  generateScanId,
  parseHeldScans,
  upsertHeldScan,
  type HeldScan,
  type SendOutcome,
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
    sequenceNumber: capturedAt,
    issuedAt: new Date(capturedAt).toISOString(),
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

describe("outbox drain reliability (retry recovery + rejection classification)", () => {
  function sender(behavior: Record<string, SendOutcome | "throw">) {
    const calls: string[] = [];
    const sendOne = async (scan: HeldScan): Promise<SendOutcome> => {
      calls.push(scan.scanId);
      const outcome = behavior[scan.scanId] ?? { status: "retry" };
      if (outcome === "throw") throw new Error("envelope build failed");
      return outcome;
    };
    return { sendOne, calls };
  }

  it("continues to later queued scans after one send throws (no aborted drain)", async () => {
    const queue = [held("a", 1), held("b", 2), held("c", 3)];
    const { sendOne, calls } = sender({
      a: "throw",
      b: { status: "accepted" },
      c: { status: "accepted" },
    });
    const result = await drainHeldScans(queue, sendOne);
    expect(calls).toEqual(["a", "b", "c"]);
    expect(result.acceptedIds).toEqual(["b", "c"]);
  });

  it("never throws even when every send throws, so the caller's retry guard resets", async () => {
    const queue = [held("a", 1), held("b", 2)];
    const { sendOne } = sender({ a: "throw", b: "throw" });
    await expect(drainHeldScans(queue, sendOne)).resolves.toEqual({
      transportAccepted: false,
      acceptedIds: [],
      rejected: [],
    });
  });

  it("records a permanent rejection, lets later scans continue, and leaves transient ones queued", async () => {
    const queue = [held("bad", 1), held("ok", 2), held("later", 3)];
    const { sendOne, calls } = sender({
      bad: { status: "rejected", code: "submission_scope_mismatch" },
      ok: { status: "accepted" },
      later: { status: "retry" },
    });
    const result = await drainHeldScans(queue, sendOne);
    expect(calls).toEqual(["bad", "ok", "later"]);
    // Permanent -> reported (caller drops it); accepted -> reported (caller drops
    // it); transient "later" -> neither, so the caller keeps it queued.
    expect(result.rejected).toEqual([{ scanId: "bad", code: "submission_scope_mismatch" }]);
    expect(result.acceptedIds).toEqual(["ok"]);
    expect(result.transportAccepted).toBe(true);
  });

  it("stops draining when cancelled (session isolation, no cross-session churn)", async () => {
    let cancelled = false;
    const { sendOne, calls } = sender({
      a: { status: "accepted" },
      b: { status: "accepted" },
    });
    const cancelAfterFirst = async (scan: HeldScan): Promise<SendOutcome> => {
      const outcome = await sendOne(scan);
      cancelled = true;
      return outcome;
    };
    const result = await drainHeldScans(
      [held("a", 1), held("b", 2), held("c", 3)],
      cancelAfterFirst,
      () => cancelled,
    );
    expect(calls).toEqual(["a"]);
    expect(result.acceptedIds).toEqual(["a"]);
  });

  it("retries an out-of-order transient scan and succeeds once the predecessor lands", async () => {
    const queue = [held("seq2", 2)];
    let predecessorLanded = false;
    const sendOne = async (): Promise<SendOutcome> =>
      predecessorLanded ? { status: "accepted" } : { status: "retry" };

    const firstTick = await drainHeldScans(queue, sendOne);
    expect(firstTick.acceptedIds).toEqual([]); // out_of_order -> stays queued

    predecessorLanded = true;
    const secondTick = await drainHeldScans(queue, sendOne);
    expect(secondTick.acceptedIds).toEqual(["seq2"]); // later succeeds
  });

  it("does not re-accept a scan the caller already removed from the queue", async () => {
    // Mirrors the component: sendOne acknowledges (removes) accepted scans, so a
    // duplicate retry cannot produce a second durable result for the same id.
    let queue = [held("dup", 1)];
    const sendOne = async (scan: HeldScan): Promise<SendOutcome> => {
      queue = acknowledgeHeldScan(queue, scan.scanId);
      return { status: "accepted" };
    };
    const first = await drainHeldScans([...queue], sendOne);
    expect(first.acceptedIds).toEqual(["dup"]);
    const second = await drainHeldScans([...queue], sendOne); // queue now empty
    expect(second.acceptedIds).toEqual([]);
  });
});
