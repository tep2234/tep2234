import { describe, expect, it } from "vitest";
import { getSupabaseClient, isSupabaseConfigured } from "../src/lib/supabase/client";
import {
  claimSession,
  createPairingSession,
  endSession,
  fetchCheckedResults,
  PairingSessionError,
  pairingSessionErrorMessage,
  upsertCheckedResult,
} from "../src/lib/sync/smartscanSync";
import { subscribeCheckedResults, subscribePhoneSubmissions, subscribeSession } from "../src/lib/sync/realtimeSmartScan";
import type { CheckedResultRow } from "../src/lib/sync/pairing";

// No VITE_SUPABASE_* in the test env -> everything must degrade safely so the
// offline app is unaffected. This is the "Supabase disabled mode" contract.
describe("Supabase disabled mode (offline safety)", () => {
  it("reports not configured and returns a null client", () => {
    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabaseClient()).toBeNull();
  });

  it("session helpers no-op without throwing", async () => {
    expect(await createPairingSession({ assessmentId: "A1", learnerIds: ["L1"], allowedVersions: ["A"], itemCount: 1 })).toBeNull();
    const claim = await claimSession("s", "t", "device");
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.reason).toBe("offline");
    await expect(endSession("s")).resolves.toBeUndefined();
  });

  it("result helpers no-op without throwing", async () => {
    const row = { assessment_id: "A1", teacher_user_id: "u", learner_id: "L1" } as unknown as CheckedResultRow;
    expect(await upsertCheckedResult(row)).toBe(false);
    expect(await fetchCheckedResults("u", "A1")).toEqual([]);
  });
});

describe("pairing session diagnostics", () => {
  it("distinguishes a missing hardened RPC from a network failure", () => {
    expect(pairingSessionErrorMessage(new PairingSessionError("PGRST202", "missing"))).toContain(
      "realtime migration",
    );
  });

  it("explains the direct-auth prerequisite without requesting email", () => {
    expect(pairingSessionErrorMessage(new PairingSessionError("28000", "auth required"))).toContain(
      "Anonymous Sign-Ins",
    );
  });

  it("keeps unknown transport failures actionable and generic", () => {
    expect(pairingSessionErrorMessage(new Error("socket failure"))).toContain("Check the connection");
  });

  it("points insecure-context Web Crypto failures at HTTPS/localhost", () => {
    expect(
      pairingSessionErrorMessage(new Error("Web Crypto unavailable in this environment")),
    ).toContain("secure page (HTTPS or localhost)");
  });
});

describe("realtime subscriptions (disabled mode)", () => {
  it("return a no-op unsubscribe that is safe to call", () => {
    const off1 = subscribeCheckedResults("u", "A1", () => {});
    const off2 = subscribeSession("s", () => {});
    const off3 = subscribePhoneSubmissions("u", "A1", () => {});
    expect(typeof off1).toBe("function");
    expect(typeof off2).toBe("function");
    expect(() => { off1(); off2(); off3(); }).not.toThrow();
  });
});
