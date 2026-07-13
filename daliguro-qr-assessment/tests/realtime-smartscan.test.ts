import { describe, expect, it } from "vitest";
import {
  isScanAckBroadcast,
  isScoreBroadcast,
  isValidReceiptId,
} from "../src/lib/sync/realtimeSmartScan";

const common = {
  token: "pairing-token",
  scanId: "scan-id-0001",
  learnerId: "learner-1",
};

describe("SmartScan realtime receipt boundary", () => {
  it("accepts saved acknowledgements only with a non-empty scan-specific receipt", () => {
    expect(isScanAckBroadcast({ ...common, status: "saved", receiptId: "receipt-0001" })).toBe(true);
    expect(isScanAckBroadcast({ ...common, status: "saved" })).toBe(false);
    expect(isScanAckBroadcast({ ...common, status: "saved", receiptId: "" })).toBe(false);
    expect(isScanAckBroadcast({ ...common, status: "saved", receiptId: "short" })).toBe(false);
  });

  it("keeps transport and failure acknowledgements distinct from durable saves", () => {
    expect(isScanAckBroadcast({ ...common, status: "pc_received" })).toBe(true);
    expect(isScanAckBroadcast({ ...common, status: "failed", reason: "expired" })).toBe(true);
    expect(isScanAckBroadcast({ ...common, status: "unknown" })).toBe(false);
    expect(isValidReceiptId("receipt-0001")).toBe(true);
  });

  it("rejects malformed or uncorrelated score payloads", () => {
    const score = {
      ...common,
      receiptId: "receipt-0001",
      raw: 8,
      total: 10,
      pct: 80,
      correct: 8,
      wrong: 2,
      blank: 0,
      mastery: "Mastered",
    };
    expect(isScoreBroadcast(score)).toBe(true);
    expect(isScoreBroadcast({ ...score, receiptId: "" })).toBe(false);
    expect(isScoreBroadcast({ ...score, pct: 101 })).toBe(false);
    expect(isScoreBroadcast({ ...score, raw: Number.NaN })).toBe(false);
  });
});
