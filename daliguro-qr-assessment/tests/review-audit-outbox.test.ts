import { beforeEach, describe, expect, it } from "vitest";
import {
  enqueueReviewAudit,
  flushReviewAuditOutbox,
  loadReviewAuditOutbox,
  parseReviewAuditOutbox,
} from "../src/lib/sync/review-audit-outbox";
import type { RemoteReviewDecision } from "../src/lib/sync/smartscanSync";

const decision: RemoteReviewDecision = {
  eventId: "33333333-3333-4333-8333-333333333333",
  omrRowNumber: 1,
  itemId: "item-7",
  itemNumber: 7,
  originalStatus: "unreadable",
  originalValue: "A",
  correctedValue: "B",
  source: "review_queue",
  reason: "Unreadable camera evidence required an explicit teacher decision.",
};

describe("review audit outbox", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preserves complete unreadable correction evidence and deduplicates event retries", () => {
    const batch = { scanId: "scan-unreadable-0001", decisions: [decision], queuedAt: 1_000 };
    enqueueReviewAudit(batch);
    enqueueReviewAudit(batch);
    expect(loadReviewAuditOutbox()).toEqual([batch]);
  });

  it("keeps the durable batch queued while the backend is offline", async () => {
    enqueueReviewAudit({ scanId: "scan-unreadable-0001", decisions: [decision], queuedAt: 1_000 });
    const remaining = await flushReviewAuditOutbox();
    expect(remaining).toHaveLength(1);
    expect(loadReviewAuditOutbox()[0].decisions[0]).toMatchObject({
      originalStatus: "unreadable",
      correctedValue: "B",
      itemId: "item-7",
      itemNumber: 7,
    });
  });

  it("rejects malformed persisted batches instead of sending them", () => {
    expect(parseReviewAuditOutbox("not-json")).toEqual([]);
    expect(parseReviewAuditOutbox(JSON.stringify([{ scanId: "short", decisions: [decision], queuedAt: 1 }]))).toEqual([]);
  });

  it("preserves a terminal resolution even when there are no item corrections", () => {
    const batch = {
      scanId: "scan-clean-review-0002",
      decisions: [],
      resolution: {
        eventId: "44444444-4444-4444-8444-444444444444",
        decision: "reviewed" as const,
        reason: "Teacher explicitly confirmed the provisional scan after review.",
      },
      queuedAt: 2_000,
    };
    enqueueReviewAudit(batch);
    expect(loadReviewAuditOutbox()).toEqual([batch]);
  });
});
