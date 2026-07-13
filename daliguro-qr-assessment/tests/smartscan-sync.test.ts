import { describe, expect, it } from "vitest";
import { getSupabaseClient, isSupabaseConfigured } from "../src/lib/supabase/client";
import {
  claimSession,
  createPairingSession,
  endSession,
  fetchCheckedResults,
  touchSession,
  upsertCheckedResult,
} from "../src/lib/sync/smartscanSync";
import { subscribeCheckedResults, subscribeSession } from "../src/lib/sync/realtimeSmartScan";
import type { CheckedResultRow } from "../src/lib/sync/pairing";

// No VITE_SUPABASE_* in the test env -> everything must degrade safely so the
// offline app is unaffected. This is the "Supabase disabled mode" contract.
describe("Supabase disabled mode (offline safety)", () => {
  it("reports not configured and returns a null client", () => {
    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabaseClient()).toBeNull();
  });

  it("session helpers no-op without throwing", async () => {
    expect(await createPairingSession({ teacherUserId: "u", assessmentId: "A1" })).toBeNull();
    const claim = await claimSession("s", "t", "device");
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.reason).toBe("offline");
    await expect(endSession("s")).resolves.toBeUndefined();
    await expect(touchSession("s")).resolves.toBeUndefined();
  });

  it("result helpers no-op without throwing", async () => {
    const row = { assessment_id: "A1", teacher_user_id: "u", learner_id: "L1" } as unknown as CheckedResultRow;
    expect(await upsertCheckedResult(row)).toBe(false);
    expect(await fetchCheckedResults("u", "A1")).toEqual([]);
  });
});

describe("realtime subscriptions (disabled mode)", () => {
  it("return a no-op unsubscribe that is safe to call", () => {
    const off1 = subscribeCheckedResults("u", "A1", () => {});
    const off2 = subscribeSession("s", () => {});
    expect(typeof off1).toBe("function");
    expect(typeof off2).toBe("function");
    expect(() => { off1(); off2(); }).not.toThrow();
  });
});
