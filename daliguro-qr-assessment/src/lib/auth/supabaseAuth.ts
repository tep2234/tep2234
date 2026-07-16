// Supabase authentication for SmartScan pairing. Existing teacher sessions are
// reused; otherwise the browser obtains an anonymous user automatically so the
// pairing QR works without email while still receiving a unique auth.uid() for
// RLS and durable receipts. Magic-link helpers remain available for an optional
// future account-upgrade flow. When Supabase is not configured, every call is a
// safe no-op so the offline app is unaffected.

import { useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/client";

export interface MagicLinkResult {
  ok: boolean;
  error?: string;
}

// Turn a Supabase auth error into a clear, actionable message. The common
// failure in the field is the email rate limit (HTTP 429): the request looks
// like it "sent" but no email goes out, so surface that explicitly.
function friendlyAuthError(status: number | undefined, message: string): string {
  const m = message.toLowerCase();
  if (status === 429 || m.includes("rate limit") || m.includes("too many")) {
    return "Too many email requests. Wait ~15–30 minutes, then send just one link. Tip: you only need to sign in once — it stays signed in on this browser.";
  }
  if (m.includes("not confirmed") || m.includes("not authorized")) {
    return "This email isn't confirmed yet. Open the confirmation link in your inbox first, then sign in.";
  }
  if (m.includes("signups not allowed") || m.includes("disabled")) {
    return "New sign-ups are disabled for this project. Use an email that already has an account.";
  }
  return message || "Could not send the link. Check your connection and try again.";
}

// Send a magic sign-in link to the teacher's email. `redirectTo` is where the
// link returns (the PC dashboard origin).
export async function sendMagicLink(email: string, redirectTo: string): Promise<MagicLinkResult> {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, error: "Sync is not configured on this build." };
  const clean = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { ok: false, error: "Enter a valid email." };
  const { error } = await sb.auth.signInWithOtp({
    email: clean,
    options: { emailRedirectTo: redirectTo },
  });
  return error ? { ok: false, error: friendlyAuthError(error.status, error.message) } : { ok: true };
}

export async function signOut(): Promise<void> {
  const sb = getSupabaseClient();
  if (sb) await sb.auth.signOut();
}

export interface AuthState {
  configured: boolean;
  loading: boolean;
  user: User | null;
  teacherUserId: string | null;
  email: string | null;
  isAnonymous: boolean;
  error: string | null;
}

function directPairingAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("anonymous") && normalized.includes("disabled")) {
    return "Direct phone pairing is disabled in the Supabase Auth settings. Enable Anonymous Sign-Ins, then retry.";
  }
  return message || "Could not prepare direct phone pairing. Check the connection and retry.";
}

type DirectPairingAuthClient = Pick<SupabaseClient["auth"], "getSession" | "signInAnonymously">;

export async function ensureDirectPairingUser(
  auth: DirectPairingAuthClient,
): Promise<{ user: User | null; error: string | null }> {
  const current = await auth.getSession();
  if (current.data.session?.user) {
    return { user: current.data.session.user, error: null };
  }
  const direct = await auth.signInAnonymously();
  if (direct.error) {
    return { user: null, error: directPairingAuthError(direct.error.message) };
  }
  return {
    user: direct.data.user ?? direct.data.session?.user ?? null,
    error: null,
  };
}

// React hook: current auth state, kept live via onAuthStateChange. When this
// browser has no existing teacher session, create an anonymous Supabase user
// automatically. That gives the pairing RPC a unique auth.uid() for RLS and
// durable receipts without asking the teacher for an email address.
export function useSupabaseAuth(): AuthState {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabaseClient();
    // When unconfigured, `loading` already initialized to false (useState above).
    if (!sb) return;
    let active = true;
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session?.user) {
        setUser(session.user);
        setError(null);
        setLoading(false);
        return;
      }
      // A null session here is either INITIAL_SESSION on a fresh browser
      // (anonymous sign-in is still in flight — keep `loading` true so the
      // panel doesn't flash "pairing unavailable") or a later sign-out.
      setUser(null);
    });
    void (async () => {
      const direct = await ensureDirectPairingUser(sb.auth);
      if (!active) return;
      if (direct.error) {
        setError(direct.error);
        setLoading(false);
        return;
      }
      setUser(direct.user);
      setLoading(false);
    })();
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    configured,
    loading,
    user,
    teacherUserId: user?.id ?? null,
    email: user?.email ?? null,
    isAnonymous: user?.is_anonymous === true,
    error,
  };
}
