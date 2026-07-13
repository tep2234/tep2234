// Supabase Realtime subscriptions for the PC dashboard. Two channels:
//   - checked results for the active (teacher, assessment) -> live result feed
//   - the current pairing session -> phone-connected / expired / ended status
// Each subscribe returns an unsubscribe function; callers MUST call it on
// change/unmount to avoid leaks and duplicate events. No-ops when unconfigured.

import { getSupabaseClient } from "../supabase/client";
import type { CheckedResultRow, ScanBroadcast, ScoreBroadcast } from "./pairing";
import type { SessionRow } from "./smartscanSync";

export type Unsubscribe = () => void;
const NOOP: Unsubscribe = () => {};

// Live pairing channel (Supabase Realtime *broadcast*). The phone joins with only
// the anon key (no sign-in) and broadcasts each scan + a "hello"; the signed-in
// PC listens and does the DB write. Broadcast needs no RLS/auth, which is exactly
// why it lets the phone stay anonymous. Channel is keyed by the session id.
export interface ScanChannel {
  sendScan: (scan: ScanBroadcast) => Promise<boolean>;
  sendHello: (deviceName: string, token: string) => void;
  sendAck: (ack: ScanAckBroadcast) => void;
  sendScore: (score: ScoreBroadcast) => void;
  close: Unsubscribe;
}

interface ScanAckCommon {
  token: string;
  scanId: string;
  learnerId: string;
}

export type ScanAckBroadcast =
  | (ScanAckCommon & { status: "pc_received" })
  | (ScanAckCommon & { status: "saved"; receiptId: string })
  | (ScanAckCommon & { status: "failed"; reason?: string });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidReceiptId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 8 && value.length <= 160;
}

export function isScanAckBroadcast(value: unknown): value is ScanAckBroadcast {
  if (!isRecord(value)) return false;
  if (
    typeof value.token !== "string" || !value.token ||
    typeof value.scanId !== "string" || value.scanId.length < 8 ||
    typeof value.learnerId !== "string" || !value.learnerId
  ) return false;
  if (value.status === "pc_received") return true;
  if (value.status === "saved") return isValidReceiptId(value.receiptId);
  if (value.status === "failed") return value.reason === undefined || typeof value.reason === "string";
  return false;
}

export function isScoreBroadcast(value: unknown): value is ScoreBroadcast {
  if (!isRecord(value)) return false;
  return (
    typeof value.token === "string" && !!value.token &&
    typeof value.scanId === "string" && value.scanId.length >= 8 &&
    isValidReceiptId(value.receiptId) &&
    typeof value.learnerId === "string" && !!value.learnerId &&
    ["raw", "total", "pct", "correct", "wrong", "blank"].every((key) =>
      typeof value[key] === "number" && Number.isFinite(value[key]) && (value[key] as number) >= 0,
    ) &&
    (value.pct as number) <= 100 &&
    typeof value.mastery === "string"
  );
}

interface ScanChannelHandlers {
  onScan?: (scan: ScanBroadcast) => void;
  onHello?: (msg: { deviceName: string; token: string }) => void;
  onAck?: (ack: ScanAckBroadcast) => void;
  onScore?: (score: ScoreBroadcast) => void;
}

export function joinScanChannel(sessionId: string, handlers: ScanChannelHandlers = {}): ScanChannel {
  const sb = getSupabaseClient();
  if (!sb) return { sendScan: async () => false, sendHello: () => {}, sendAck: () => {}, sendScore: () => {}, close: NOOP };
  const channel = sb.channel(`smartscan-live-${sessionId}`, { config: { broadcast: { self: false } } });
  if (handlers.onScan) {
    channel.on("broadcast", { event: "scan" }, ({ payload }) => {
      if (isRecord(payload) && typeof payload.token === "string") {
        handlers.onScan?.(payload as unknown as ScanBroadcast);
      }
    });
  }
  if (handlers.onHello) {
    channel.on("broadcast", { event: "hello" }, ({ payload }) => handlers.onHello?.(payload as { deviceName: string; token: string }));
  }
  if (handlers.onAck) {
    channel.on("broadcast", { event: "ack" }, ({ payload }) => {
      if (isScanAckBroadcast(payload)) handlers.onAck?.(payload);
    });
  }
  if (handlers.onScore) {
    channel.on("broadcast", { event: "score" }, ({ payload }) => {
      if (isScoreBroadcast(payload)) handlers.onScore?.(payload);
    });
  }
  channel.subscribe();
  return {
    sendScan: async (scan) => {
      try {
        const status = await channel.send({ type: "broadcast", event: "scan", payload: scan });
        return status === "ok";
      } catch {
        return false;
      }
    },
    sendHello: (deviceName, token) => { void channel.send({ type: "broadcast", event: "hello", payload: { deviceName, token } }); },
    sendAck: (ack) => { void channel.send({ type: "broadcast", event: "ack", payload: ack }); },
    sendScore: (score) => { void channel.send({ type: "broadcast", event: "score", payload: score }); },
    close: () => { void sb.removeChannel(channel); },
  };
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
    .channel(`smartscan-results-${assessmentId}`)
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
    .channel(`smartscan-session-${sessionId}`)
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
