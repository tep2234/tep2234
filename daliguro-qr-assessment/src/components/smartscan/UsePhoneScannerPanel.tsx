// PC "Use Phone as Scanner" panel: sign in (magic link) -> create a pairing
// session -> show the pairing QR + 15:00 countdown + phone-connected status ->
// live feed of results the phone submits, via Supabase Realtime. Entirely
// inert (renders a short "not configured" note) when Supabase env is unset, so
// the offline pilot is unaffected.

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { isSupabaseConfigured } from "../../lib/supabase/client";
import { sendMagicLink, signOut, useSupabaseAuth } from "../../lib/auth/supabaseAuth";
import { buildPairingUrl, secondsLeft } from "../../lib/sync/pairing";
import { createPairingSession, endSession, type SessionRow } from "../../lib/sync/smartscanSync";
import type { CheckedResultRow } from "../../lib/sync/pairing";
import { subscribeCheckedResults, subscribeSession } from "../../lib/sync/realtimeSmartScan";
import { Button } from "../ui";

interface FeedItem { learnerId: string; name: string; when: number; }

export function UsePhoneScannerPanel({ assessmentId }: { assessmentId: string }) {
  const auth = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [authErr, setAuthErr] = useState("");

  const [session, setSession] = useState<{ id: string; url: string; expiresAtMs: number } | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [phone, setPhone] = useState<SessionRow["status"] | null>(null);
  const [phoneName, setPhoneName] = useState<string>("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [creating, setCreating] = useState(false);
  const cleanupRef = useRef<(() => void)[]>([]);

  const configured = isSupabaseConfigured();
  // Countdown derived during render from a ticking clock (no setState-in-effect).
  const left = session ? secondsLeft(session.expiresAtMs, nowMs) : 0;

  // Tick the clock while a session is live.
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, [session]);

  // Render the pairing QR when a session exists.
  useEffect(() => {
    if (!session) return;
    let on = true;
    QRCode.toDataURL(session.url, { width: 240, margin: 1, errorCorrectionLevel: "M" })
      .then((u) => on && setQrUrl(u))
      .catch(() => on && setQrUrl(""));
    return () => { on = false; };
  }, [session]);

  // Realtime subscriptions for this session (phone status) + results feed.
  useEffect(() => {
    if (!session || !auth.teacherUserId) return;
    const unsubSession = subscribeSession(session.id, (row) => {
      setPhone(row.status);
      if (row.paired_device_name) setPhoneName(row.paired_device_name);
    });
    const unsubResults = subscribeCheckedResults(auth.teacherUserId, assessmentId, (row: CheckedResultRow) => {
      setFeed((prev) => [{ learnerId: row.learner_id, name: row.learner_name ?? row.learner_id, when: Date.now() }, ...prev].slice(0, 20));
    });
    cleanupRef.current = [unsubSession, unsubResults];
    return () => { cleanupRef.current.forEach((f) => f()); cleanupRef.current = []; };
  }, [session, auth.teacherUserId, assessmentId]);

  const start = useCallback(async () => {
    if (!auth.teacherUserId) return;
    setCreating(true);
    const created = await createPairingSession({ teacherUserId: auth.teacherUserId, assessmentId });
    setCreating(false);
    if (!created) { setAuthErr("Could not create a session. Check your connection."); return; }
    const url = buildPairingUrl(window.location.origin, created.sessionId, created.token);
    setSession({ id: created.sessionId, url, expiresAtMs: created.expiresAtMs });
    setPhone("active");
  }, [auth.teacherUserId, assessmentId]);

  const stop = useCallback(async () => {
    if (session) await endSession(session.id);
    cleanupRef.current.forEach((f) => f());
    cleanupRef.current = [];
    setSession(null);
    setPhone(null);
    setPhoneName("");
  }, [session]);

  async function requestLink() {
    setAuthErr("");
    const r = await sendMagicLink(email, window.location.origin);
    if (r.ok) setEmailSent(true);
    else setAuthErr(r.error ?? "Could not send the link.");
  }

  if (!configured) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        📱 <b>Use Phone as Scanner</b> — scan with your phone, results appear here automatically.
        This build is offline-only; realtime phone pairing activates once Supabase is configured
        (<code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>).
      </div>
    );
  }

  if (auth.loading) return <div className="mt-4 text-sm text-slate-500">Checking sign-in…</div>;

  // Signed-out: magic-link login.
  if (!auth.teacherUserId) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-bold">📱 Use Phone as Scanner</div>
        <p className="mt-1 text-xs text-slate-500">Sign in so results sync to your account on any device.</p>
        {emailSent ? (
          <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-800">
            Magic link sent to {email}. Open it, then come back.
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teacher@email.com"
              className="min-w-56 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" inputMode="email" />
            <Button onClick={requestLink}>Send magic link</Button>
          </div>
        )}
        {authErr ? <div className="mt-2 text-xs text-red-600">{authErr}</div> : null}
      </div>
    );
  }

  const expired = session && left <= 0;
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold">📱 Use Phone as Scanner</div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {auth.email}
          <button className="font-bold text-indigo-700" onClick={() => void signOut()}>sign out</button>
        </div>
      </div>

      {!session ? (
        <div className="mt-3">
          <p className="text-xs text-slate-500">Scan with your phone. Results appear here automatically.</p>
          <Button className="mt-2" onClick={() => void start()} disabled={creating}>
            {creating ? "Starting…" : "Use Phone as Scanner"}
          </Button>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-[auto,1fr]">
          <div className="text-center">
            {qrUrl ? <img src={qrUrl} width={200} height={200} alt="Pair your phone" className="mx-auto" /> : <div className="h-[200px] w-[200px] bg-slate-100" />}
            <div className={"mt-1 text-sm font-bold " + (expired ? "text-red-600" : "text-slate-700")}>
              {expired ? "Expired" : `Expires in ${mm}:${ss}`}
            </div>
            <div className="mt-1 break-all text-[10px] text-slate-400">{session.url}</div>
          </div>
          <div>
            <div className="rounded-lg border border-slate-200 p-2 text-sm">
              Status:{" "}
              <b className={phone === "paired" ? "text-emerald-700" : "text-slate-600"}>
                {phone === "paired" ? `Phone connected${phoneName ? " · " + phoneName : ""}` : expired ? "Expired" : "Waiting for phone…"}
              </b>
            </div>
            <div className="mt-2">
              <div className="text-xs font-bold text-slate-500">Latest scans</div>
              {feed.length === 0 ? (
                <div className="text-xs text-slate-400">No scans yet.</div>
              ) : (
                <ul className="mt-1 grid gap-1 text-sm">
                  {feed.map((f, i) => (
                    <li key={f.learnerId + i} className="flex items-center gap-2">
                      <span className="font-semibold">{f.name}</span>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">Synced</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="smallDanger" onClick={() => void stop()}>End Session</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
