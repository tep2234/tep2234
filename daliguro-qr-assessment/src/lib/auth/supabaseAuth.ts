// Magic-link authentication (Supabase Auth OTP). No passwords, no local fake
// accounts. The signed-in user's id is the teacher_user_id used for RLS and for
// scoping all sessions/results. When Supabase is not configured, every call is a
// safe no-op so the offline app is unaffected.

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
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
}

// React hook: current auth state, kept live via onAuthStateChange.
export function useSupabaseAuth(): AuthState {
  const configured = isSupabaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);

  useEffect(() => {
    const sb = getSupabaseClient();
    // When unconfigured, `loading` already initialized to false (useState above).
    if (!sb) return;
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
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
  };
}
