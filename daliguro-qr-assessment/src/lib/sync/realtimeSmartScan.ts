// Supabase Realtime subscriptions for the PC dashboard. Two channels:
//   - checked results for the active (teacher, assessment) -> live result feed
//   - the current pairing session -> phone-connected / expired / ended status
// Each subscribe returns an unsubscribe function; callers MUST call it on
// change/unmount to avoid leaks and duplicate events. No-ops when unconfigured.

import { getSupabaseClient } from "../supabase/client";
import type { CheckedResultRow } from "./pairing";
import type { PhoneInboxRow } from "./realtime-security";
import type { SessionRow } from "./smartscanSync";

export type Unsubscribe = () => void;
const NOOP: Unsubscribe = () => {};

function channelName(prefix: string): string {
  const nonce = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${nonce}`;
}

// Phone messages are already durable before this notification fires. RLS on
// smartscan_phone_submissions is evaluated by Postgres Changes for the signed-in
// teacher; channel names carry no teacher, tenant, assessment, or token data.
export function subscribePhoneSubmissions(
  teacherUserId: string,
  assessmentId: string,
  onChange: (row: PhoneInboxRow) => void,
  onSubscribed?: () => void,
): Unsubscribe {
  const sb = getSupabaseClient();
  if (!sb) return NOOP;
  const channel = sb
    .channel(channelName("smartscan-inbox"))
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "smartscan_phone_submissions",
        filter: `teacher_user_id=eq.${teacherUserId}`,
      },
      (payload) => {
        const row = payload.new as PhoneInboxRow | undefined;
        if (row?.assessment_id === assessmentId && row.status === "received") onChange(row);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onSubscribed?.();
    });
  return () => { void sb.removeChannel(channel); };
}

// Fires for immutable phone-scan submissions for this teacher+assessment.
export function subscribeCheckedResults(
  teacherUserId: string,
  assessmentId: string,
  onChange: (row: CheckedResultRow, event: "INSERT" | "UPDATE") => void,
): Unsubscribe {
  const sb = getSupabaseClient();
  if (!sb) return NOOP;
  const channel = sb
    .channel(channelName("smartscan-results"))
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "smartscan_scan_submissions",
        filter: `teacher_user_id=eq.${teacherUserId}`,
      },
      (payload) => {
        const row = payload.new as CheckedResultRow | undefined;
        if (!row || row.assessment_id !== assessmentId) return;
        if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
          onChange(row, payload.eventType);
        }
      },
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}

// Fires when the paired session's status/phone changes.
export function subscribeSession(
  sessionId: string,
  onChange: (row: SessionRow) => void,
): Unsubscribe {
  const sb = getSupabaseClient();
  if (!sb) return NOOP;
  const channel = sb
    .channel(channelName("smartscan-session"))
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "smartscan_sessions", filter: `id=eq.${sessionId}` },
      (payload) => {
        const row = payload.new as SessionRow | undefined;
        if (row) onChange(row);
      },
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}
