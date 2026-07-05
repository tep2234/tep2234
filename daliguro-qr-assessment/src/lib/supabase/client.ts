// Supabase client seam. The whole realtime-sync feature is gated behind this:
// when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are unset, isSupabaseConfigured()
// is false, getSupabaseClient() returns null, and the app runs exactly as the
// offline-first pilot (no network, no crash). Only the anon (public) key is
// used — never the service-role key, which must never reach the frontend.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return typeof url === "string" && url.length > 0 &&
    typeof anonKey === "string" && anonKey.length > 0;
}

let cached: SupabaseClient | null = null;

// Returns a singleton client, or null when Supabase is not configured. Callers
// MUST null-check and fall back to local/offline behavior.
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!cached) {
    cached = createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return cached;
}
