// PC "Use Phone as Scanner" panel: create a short-lived pairing QR -> use the
// phone as a temporary camera companion -> receive durable inbox rows through
// RLS-filtered Postgres Changes. Pairing and phone writes use short-lived,
// server-validated capabilities; no secret is sent through Broadcast.

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { isSupabaseConfigured } from "../../lib/supabase/client";
import { sendMagicLink, useSupabaseAuth } from "../../lib/auth/supabaseAuth";
import { buildPairingUrl, checkedRowFromScan, isLoopbackOrigin, normalizePairingOrigin, scoredCheckedRow, secondsLeft, validateScanBroadcast } from "../../lib/sync/pairing";
import {
  commitCheckedResult,
  completePhoneSubmission,
  createPairingSession,
  endSession,
  fetchCheckedResults,
  fetchPhoneSubmissions,
  pairingSessionErrorMessage,
  type SessionRow,
} from "../../lib/sync/smartscanSync";
import type { CheckedResultRow, ScanBroadcast, ScoredSummary } from "../../lib/sync/pairing";
import { subscribeCheckedResults, subscribePhoneSubmissions, subscribeSession } from "../../lib/sync/realtimeSmartScan";
import type { PhoneInboxRow } from "../../lib/sync/realtime-security";
import { Button, TextInput } from "../ui";

interface FeedItem {
  learnerId: string;
  name: string;
  when: number;
  raw?: number;
  total?: number;
  pct?: number;
  review?: string;
}

const PHONE_ORIGIN_KEY = "daliguro_phone_scanner_origin";
const DEFAULT_PHONE_ORIGIN = "https://daliguro-qr-assessment.vercel.app";
const learnerSubmissionKey = (learnerId: string, version: string) => `${learnerId}|${version}`;

export function UsePhoneScannerPanel({
  assessmentId,
  learnerIds,
  allowedVersions,
  itemCount,
  onSyncedRows,
}: {
  assessmentId: string;
  learnerIds: string[];
  allowedVersions: string[];
  itemCount: number;
  // Called with checked-result rows from the phone (initial fetch + realtime),
  // so the PC can score + merge them into its local results. Returns the scored
  // summaries so the PC can send the score back to the phone.
  onSyncedRows?: (rows: CheckedResultRow[], persist?: boolean) => ScoredSummary[];
}) {
  const auth = useSupabaseAuth();
  const [authErr, setAuthErr] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);

  const [session, setSession] = useState<{ id: string; url: string; expiresAtMs: number } | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [phone, setPhone] = useState<SessionRow["status"] | null>(null);
  const [phoneName, setPhoneName] = useState<string>("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [creating, setCreating] = useState(false);
  const [phoneOriginInput, setPhoneOriginInput] = useState(() => {
    try {
      return localStorage.getItem(PHONE_ORIGIN_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const processingScanIdsRef = useRef(new Set<string>());
  const processingLearnersRef = useRef(new Map<string, string>());
  const committedLearnerScansRef = useRef(new Map<string, string>());

  const configured = isSupabaseConfigured();
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const currentOriginIsLoopback = isLoopbackOrigin(currentOrigin);
  const defaultPhoneOrigin = normalizePairingOrigin(
    (import.meta.env.VITE_PUBLIC_APP_ORIGIN as string | undefined) ?? DEFAULT_PHONE_ORIGIN,
  );
  const savedPhoneOrigin = normalizePairingOrigin(phoneOriginInput);
  const savedPhoneOriginIsLoopback = Boolean(savedPhoneOrigin) && isLoopbackOrigin(savedPhoneOrigin);
  const fallbackPhoneOrigin = currentOriginIsLoopback ? defaultPhoneOrigin : currentOrigin;
  const pairingOrigin = savedPhoneOrigin && !savedPhoneOriginIsLoopback ? savedPhoneOrigin : fallbackPhoneOrigin;
  const pairingOriginIsLoopback = isLoopbackOrigin(pairingOrigin);
  const pairingOriginValid = Boolean(pairingOrigin) && !pairingOriginIsLoopback;
  // Countdown derived during render from a ticking clock (no setState-in-effect).
  const left = session ? secondsLeft(session.expiresAtMs, nowMs) : 0;

  // Tick the clock while a session is live.
  useEffect(() => {
    if (!session?.url) return;
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

  // Realtime pairing status for the live session (phone connected / ended).
  useEffect(() => {
    if (!session) return;
    const unsub = subscribeSession(session.id, (row) => {
      setPhone(row.status);
      if (row.paired_device_name) setPhoneName(row.paired_device_name);
      if (row.status === "paired") {
        // The QR secret is consumed. Remove its URL and rendered image from PC
        // memory/UI so it cannot be copied as if it were still reusable.
        setSession((current) => current ? { ...current, url: "" } : current);
        setQrUrl("");
      }
    });
    return () => unsub();
  }, [session]);

  // Results: pull anything already synced (so results the phone sent before this
  // panel mounted show up immediately), then subscribe for live ones. Gated on
  // sign-in, NOT on an open pairing session, so the PC receives results even
  // after a session ends. Each row is handed to the parent to score + merge.
  const onRows = onSyncedRows;
  useEffect(() => {
    if (!configured || !auth.teacherUserId) return;
    const teacherUserId = auth.teacherUserId;
    let active = true;
    const seed = (rows: CheckedResultRow[], scored: ScoredSummary[] = []) => {
      if (rows.length === 0) return;
      for (const row of rows) {
        const payload = row.qr_payload as { version?: unknown } | null;
        const version = typeof payload?.version === "string" ? payload.version : "";
        if (row.scan_id && version) {
          const key = learnerSubmissionKey(row.learner_id, version);
          if (row.review_status === "needs_review") {
            committedLearnerScansRef.current.set(key, row.scan_id);
          } else if (committedLearnerScansRef.current.get(key) === row.scan_id) {
            committedLearnerScansRef.current.delete(key);
          }
        }
      }
      setFeed((prev) => {
        const next = rows.map((r) => {
          const score = scored.find((s) => s.scanId === r.scan_id);
          return {
            learnerId: r.learner_id,
            name: r.learner_name ?? r.learner_id,
            when: Date.now(),
            raw: score?.raw,
            total: score?.total,
            pct: score?.pct,
            review: r.review_status === "needs_review" ? "Needs review" : "Resolved",
          };
        });
        return [...next, ...prev].slice(0, 20);
      });
    };
    const refetch = () => {
      void fetchCheckedResults(teacherUserId, assessmentId).then((rows) => {
        if (!active) return;
        const scored = onRows?.(rows.filter((row) => row.review_status === "needs_review")) ?? [];
        seed(rows, scored);
      });
    };
    refetch();
    const unsub = subscribeCheckedResults(teacherUserId, assessmentId, (row: CheckedResultRow) => {
      const scored = row.review_status === "needs_review" ? (onRows?.([row]) ?? []) : [];
      seed([row], scored);
    });
    // Realtime fallback: re-pull whenever the teacher returns to the tab, so a
    // missed Postgres Changes event can never leave a result stuck.
    const onFocus = () => { if (document.visibilityState === "visible") refetch(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      unsub();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [configured, auth.teacherUserId, assessmentId, onRows]);

  const processPhoneSubmission = useCallback(async (inbox: PhoneInboxRow) => {
    const teacherUserId = auth.teacherUserId;
    if (!teacherUserId || inbox.teacher_user_id !== teacherUserId || inbox.assessment_id !== assessmentId) return;
    const scan = inbox.payload as ScanBroadcast;
    const validation = validateScanBroadcast(scan, {
      sessionId: inbox.session_id,
      assessmentId,
    });
    if (!validation.ok || scan.scanId !== inbox.message_id) {
      await completePhoneSubmission({ sessionId: inbox.session_id, messageId: inbox.message_id, rejectionCode: "pc_validation_failed" });
      return;
    }
    const learnerKey = learnerSubmissionKey(scan.learnerId, scan.version);
    const committedScanId = committedLearnerScansRef.current.get(learnerKey);
    if (committedScanId && committedScanId !== scan.scanId) {
      await completePhoneSubmission({ sessionId: inbox.session_id, messageId: scan.scanId, rejectionCode: "duplicate_requires_review" });
      return;
    }
    if (processingScanIdsRef.current.has(scan.scanId)) return;
    const processingLearnerScan = processingLearnersRef.current.get(learnerKey);
    if (processingLearnerScan && processingLearnerScan !== scan.scanId) return;
    processingScanIdsRef.current.add(scan.scanId);
    processingLearnersRef.current.set(learnerKey, scan.scanId);
    const releaseProcessing = () => {
      processingScanIdsRef.current.delete(scan.scanId);
      if (processingLearnersRef.current.get(learnerKey) === scan.scanId) {
        processingLearnersRef.current.delete(learnerKey);
      }
    };
    try {
      const row = checkedRowFromScan(scan, {
        assessmentId,
        teacherUserId,
        schoolId: inbox.school_id,
        sessionId: inbox.session_id,
      });
      const summary = onRows?.([row], false)?.find((candidate) => candidate.scanId === scan.scanId);
      if (!summary) {
        await completePhoneSubmission({ sessionId: inbox.session_id, messageId: scan.scanId, rejectionCode: "learner_or_version_invalid" });
        return;
      }
      const scoredRow = scoredCheckedRow(row, summary);
      const receipt = await commitCheckedResult(scoredRow);
      if (!receipt.ok) return; // durable inbox row remains pending for reconnect recovery
      const merged = onRows?.([scoredRow], true) ?? [];
      if (!merged.some((candidate) => candidate.scanId === scan.scanId)) return;
      const completed = await completePhoneSubmission({
        sessionId: inbox.session_id,
        messageId: scan.scanId,
        resultReceiptId: receipt.receiptId,
        score: summary,
      });
      if (!completed) return;
      committedLearnerScansRef.current.set(learnerKey, scan.scanId);
      setFeed((prev) => [{
        learnerId: row.learner_id,
        name: row.learner_name ?? row.learner_id,
        when: Date.now(),
        raw: summary.raw,
        total: summary.total,
        pct: summary.pct,
        review: "Needs review",
      }, ...prev].slice(0, 20));
    } catch {
      // The immutable inbox row intentionally remains `received`; focus/reload
      // will fetch and retry it without trusting a delayed client message.
    } finally {
      releaseProcessing();
    }
  }, [assessmentId, auth.teacherUserId, onRows]);

  useEffect(() => {
    if (!configured || !auth.teacherUserId) return;
    const teacherUserId = auth.teacherUserId;
    let active = true;
    const refetch = async () => {
      const rows = await fetchPhoneSubmissions(teacherUserId, assessmentId);
      if (!active) return;
      for (const row of rows) {
        if (!active) break;
        await processPhoneSubmission(row);
      }
    };
    void refetch();
    const unsub = subscribePhoneSubmissions(
      teacherUserId,
      assessmentId,
      (row) => {
        if (active) void processPhoneSubmission(row);
      },
      // Supabase can report SUBSCRIBED while a cold local Realtime tenant is
      // still bringing logical replication online. Reconcile from durable
      // storage after readiness so channel timing never becomes correctness.
      () => { if (active) void refetch(); },
    );
    // Realtime remains an optimization. Periodic reconciliation closes the
    // fetch/subscribe race and recovers missed notifications without requiring
    // the teacher to focus or reload the page.
    const reconcileTimer = setInterval(() => { if (active) void refetch(); }, 4_000);
    const onFocus = () => { if (document.visibilityState === "visible") void refetch(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      unsub();
      clearInterval(reconcileTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [assessmentId, auth.teacherUserId, configured, processPhoneSubmission]);

  const start = useCallback(async () => {
    if (!auth.teacherUserId) {
      setAuthErr(auth.error ?? "Direct pairing is still being prepared. Retry in a moment.");
      return;
    }
    if (!pairingOriginValid) {
      setAuthErr("The pairing QR cannot use localhost/127.0.0.1. Enter your Mac's Wi-Fi IP address or an HTTPS tunnel URL first.");
      return;
    }
    setAuthErr("");
    setCreating(true);
    let created: Awaited<ReturnType<typeof createPairingSession>>;
    try {
      created = await createPairingSession({
        assessmentId,
        learnerIds,
        allowedVersions,
        itemCount,
      });
    } catch (error) {
      setAuthErr(pairingSessionErrorMessage(error));
      return;
    } finally {
      setCreating(false);
    }
    if (!created) {
      setAuthErr("Phone pairing is not configured in this build.");
      return;
    }
    try {
      if (savedPhoneOrigin && !savedPhoneOriginIsLoopback) localStorage.setItem(PHONE_ORIGIN_KEY, savedPhoneOrigin);
      if (savedPhoneOriginIsLoopback) localStorage.removeItem(PHONE_ORIGIN_KEY);
    } catch {
      /* ignore */
    }
    const url = buildPairingUrl(pairingOrigin, created.sessionId, created.token);
    setSession({ id: created.sessionId, url, expiresAtMs: created.expiresAtMs });
    setPhone("active");
  }, [allowedVersions, assessmentId, auth.error, auth.teacherUserId, itemCount, learnerIds, pairingOrigin, pairingOriginValid, savedPhoneOrigin, savedPhoneOriginIsLoopback]);

  // Auto-generate the pairing QR as soon as auth has settled, so it's visible
  // immediately (no extra click). A browser-scoped anonymous auth session gives
  // direct users the same RLS isolation and durable receipts without email.
  // Runs once per mount; ending the session leaves it ended until regenerated.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!configured || auth.loading || !auth.teacherUserId || session || creating || autoStartedRef.current || !pairingOriginValid) return;
    autoStartedRef.current = true;
    void start();
  }, [configured, auth.loading, auth.teacherUserId, session, creating, pairingOriginValid, start]);

  const stop = useCallback(async () => {
    if (session) await endSession(session.id);
    // Effects clean up their own subscriptions when `session` clears.
    setSession(null);
    setPhone(null);
    setPhoneName("");
  }, [session]);

  if (!configured) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        📱 <b>Use Phone as Scanner</b> — scan with your phone, results appear here automatically.
        This build is offline-only; realtime phone pairing activates once Supabase is configured
        (<code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>).
      </div>
    );
  }

  if (auth.loading) return <div className="mt-4 text-sm text-slate-500">Preparing secure direct pairing…</div>;

  const expired = session && left <= 0;
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
  const uniqueFeed = feed.filter(
    (item, index, list) => list.findIndex((other) => other.learnerId === item.learnerId) === index,
  );
  const receiptedCount = uniqueFeed.length;
  const reviewCount = uniqueFeed.filter((f) => f.review === "Needs review").length;
  const avgPct = uniqueFeed.filter((f) => typeof f.pct === "number");
  const sessionAverage = avgPct.length
    ? Math.round(avgPct.reduce((sum, f) => sum + (f.pct ?? 0), 0) / avgPct.length)
    : 0;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold">
          📱 Use Phone as Scanner{" "}
          {/* Build stamp: identifies stale cached clients from screenshots. */}
          <span className="align-middle font-mono text-[10px] font-normal text-slate-400">b{__BUILD_ID__}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {auth.teacherUserId ? (
            <span className="rounded-full bg-emerald-50 px-2 py-1 font-bold text-emerald-800">
              {auth.email ?? "Verified teacher pairing active"}
            </span>
          ) : (
            <span className="rounded-full bg-red-50 px-2 py-1 font-bold text-red-700">Direct pairing unavailable</span>
          )}
        </div>
      </div>

      {!session ? (
        <div className="mt-3">
          {!auth.teacherUserId ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-950">
              <div className="font-extrabold">Verified teacher sign-in required</div>
              <p className="mt-1">
                {auth.error ?? (auth.isAnonymous
                  ? "Anonymous sessions cannot create teacher pairing sessions or commit assessment results."
                  : "Sign in with your teacher email before using phone synchronization.")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <TextInput
                  type="email"
                  value={teacherEmail}
                  onChange={(event) => setTeacherEmail(event.target.value)}
                  placeholder="teacher@school.edu"
                  className="min-w-64 flex-1"
                />
                <Button
                  disabled={sendingLink || !teacherEmail.trim()}
                  onClick={() => {
                    setSendingLink(true);
                    setAuthErr("");
                    void sendMagicLink(teacherEmail, window.location.href).then((result) => {
                      setSendingLink(false);
                      setAuthErr(result.ok ? "Sign-in link sent. Open it in this browser." : result.error ?? "Sign-in failed.");
                    });
                  }}
                >
                  {sendingLink ? "Sending…" : "Send sign-in link"}
                </Button>
              </div>
              {authErr ? <p className="mt-2 font-bold">{authErr}</p> : null}
            </div>
          ) : (
            <>
              <PhoneAddressBox
                currentOrigin={currentOrigin}
                fallbackOrigin={fallbackPhoneOrigin}
                value={phoneOriginInput}
                normalized={pairingOrigin}
                isLoopback={pairingOriginIsLoopback}
                enteredIsLoopback={savedPhoneOriginIsLoopback}
                onChange={setPhoneOriginInput}
              />
              <p className="text-xs text-slate-500">
                {creating ? "Generating your pairing QR…" : "Scan the QR with your phone. Every accepted capture remains provisional until teacher review."}
              </p>
              <Button className="mt-2" onClick={() => void start()} disabled={creating || !pairingOriginValid}>
                {creating ? "Generating QR…" : "Show pairing QR"}
              </Button>
              {authErr ? <div className="mt-2 text-xs font-bold text-red-600">{authErr}</div> : null}
              {!pairingOriginValid ? (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  Your phone cannot open <b>{pairingOrigin || "this address"}</b>. Use your Mac's Wi-Fi IP, for example <b>http://192.168.x.x:5173</b>, or a trusted HTTPS tunnel.
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-[auto,1fr]">
          <div className="text-center">
            {qrUrl ? <img src={qrUrl} width={200} height={200} alt="Pair your phone" className="mx-auto" /> : <div className="h-[200px] w-[200px] bg-slate-100" />}
            <div className={"mt-1 text-sm font-bold " + (expired ? "text-red-600" : "text-slate-700")}>
              {expired ? "Expired" : `Expires in ${mm}:${ss}`}
            </div>
            <div className="mt-1 text-[10px] font-bold text-emerald-700">
              {phone === "paired" ? "One-time QR consumed" : "One-time QR · do not share"}
            </div>
            <div className="mt-1 text-[10px] font-bold text-emerald-700">Phone address: {pairingOrigin}</div>
            <div className="mt-1 text-[10px] font-bold text-indigo-700">
              Durable cloud session · submissions require teacher review
            </div>
          </div>
          <div>
            <div className="rounded-lg border border-slate-200 p-2 text-sm">
              Status:{" "}
              <b className={phone === "paired" ? "text-emerald-700" : "text-slate-600"}>
                {phone === "paired" ? `Phone connected${phoneName ? " · " + phoneName : ""}` : expired ? "Expired" : "Waiting for phone…"}
              </b>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
              <BatchStat label="Received" value={String(uniqueFeed.length)} tone="bg-indigo-50 text-indigo-700" />
              <BatchStat label="Receipted" value={String(receiptedCount)} tone="bg-emerald-50 text-emerald-700" />
              <BatchStat label="Review" value={String(reviewCount)} tone={reviewCount > 0 ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-500"} />
            </div>
            {avgPct.length > 0 ? (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                Provisional OMR subtotal: {sessionAverage}% · excluded from reports and remediation until teacher review.
              </div>
            ) : null}
            <div className="mt-2">
              <div className="text-xs font-bold text-slate-500">Latest scans</div>
              {feed.length === 0 ? (
                <div className="text-xs text-slate-400">No scans yet.</div>
              ) : (
                <ul className="mt-1 grid gap-1 text-sm">
                  {feed.map((f, i) => (
                    <li key={f.learnerId + i} className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{f.name}</span>
                      {typeof f.raw === "number" && typeof f.total === "number" ? (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">
                          {f.raw}/{f.total} · {f.pct}%
                        </span>
                      ) : null}
                      <span className={(f.review === "Needs review" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700") + " rounded-full px-2 py-0.5 text-xs font-bold"}>
                        {f.review ?? "Synced"}
                      </span>
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

function BatchStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={"rounded-lg px-2 py-2 " + tone}>
      <div className="text-lg font-black leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide">{label}</div>
    </div>
  );
}

function PhoneAddressBox({
  currentOrigin,
  fallbackOrigin,
  value,
  normalized,
  isLoopback,
  enteredIsLoopback,
  onChange,
}: {
  currentOrigin: string;
  fallbackOrigin: string;
  value: string;
  normalized: string;
  isLoopback: boolean;
  enteredIsLoopback: boolean;
  onChange: (value: string) => void;
}) {
  const currentIsLoopback = isLoopbackOrigin(currentOrigin);
  return (
    <div className={"mb-3 rounded-lg border p-3 text-xs " + (isLoopback ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900")}>
      <div className="font-extrabold">Phone pairing address</div>
      <p className="mt-1">
        {currentIsLoopback
          ? "This PC page is open on localhost/127.0.0.1. The phone QR will use a reachable scanner URL instead."
          : "This address will be encoded into the phone pairing QR."}
      </p>
      {enteredIsLoopback ? (
        <div className="mt-2 rounded border border-amber-200 bg-white/70 px-2 py-1 font-bold">
          Ignoring saved localhost address. Use HTTPS/Vercel or your Mac Wi-Fi IP.
        </div>
      ) : null}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={currentIsLoopback ? fallbackOrigin : currentOrigin}
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
        inputMode="url"
      />
      {currentIsLoopback ? (
        <button
          type="button"
          onClick={() => onChange(fallbackOrigin)}
          className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white"
        >
          Use recommended phone URL
        </button>
      ) : null}
      <div className="mt-1 break-all font-semibold">
        QR will use: {normalized || "enter a reachable address"}
      </div>
    </div>
  );
}
