import { describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { ensureDirectPairingUser, teacherPrincipalId } from "../src/lib/auth/supabaseAuth";

function user(id: string, anonymous: boolean): User {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: anonymous ? undefined : "teacher@example.com",
    is_anonymous: anonymous,
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: new Date(0).toISOString(),
  };
}

describe("direct SmartScan pairing authentication", () => {
  it("reuses an existing teacher session without creating another identity", async () => {
    const existing = user("teacher-1", false);
    const signInAnonymously = vi.fn();
    const result = await ensureDirectPairingUser({
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: existing } }, error: null }),
      signInAnonymously,
    } as never);

    expect(result).toEqual({ user: existing, error: null });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("creates a browser-scoped anonymous identity without requesting email", async () => {
    const anonymous = user("direct-1", true);
    const signInAnonymously = vi.fn().mockResolvedValue({
      data: { user: anonymous, session: { user: anonymous } },
      error: null,
    });
    const result = await ensureDirectPairingUser({
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInAnonymously,
    } as never);

    expect(result).toEqual({ user: anonymous, error: null });
    expect(signInAnonymously).toHaveBeenCalledOnce();
  });

  it("surfaces the required project setting when anonymous access is disabled", async () => {
    const result = await ensureDirectPairingUser({
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInAnonymously: vi.fn().mockResolvedValue({
        data: { user: null, session: null },
        error: { message: "Anonymous sign-ins are disabled" },
      }),
    } as never);

    expect(result.user).toBeNull();
    expect(result.error).toContain("Enable Anonymous Sign-Ins");
  });
});

describe("teacher principal classification", () => {
  it("documents that anonymous authenticated users are not teacher principals", () => {
    const anonymous = user("anonymous-1", true);
    expect(teacherPrincipalId(anonymous)).toBeNull();
    expect(teacherPrincipalId(user("teacher-1", false))).toBe("teacher-1");
  });
});
