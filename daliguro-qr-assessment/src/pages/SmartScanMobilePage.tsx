// Phone scanner page (deep-linked from the PC pairing QR):
//   /smartscan/mobile/:sessionId?t=RAW_TOKEN
// Security gates, in order: Supabase configured -> teacher signed in (same
// account, RLS) -> session claimed (token hash + not expired + not ended).
// Then it decodes the sheet QR, reads the bubbles (template sized by the QR's
// item count `n`, so no PC-side assessment data is needed on the phone),
// rejects a wrong-assessment sheet, lets the teacher review, and upserts the
// detected answers to Supabase. Scoring against the answer key is finalized on
// the PC (which holds the keys); see the report's known-limitations.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import jsQR from "jsqr";
import { isSupabaseConfigured } from "../lib/supabase/client";
import { sendMagicLink, useSupabaseAuth } from "../lib/auth/supabaseAuth";
import { decodeQrPayload } from "../lib/qr-parse";
import { assessmentMatches } from "../lib/sync/pairing";
import {
  claimSession,
  upsertCheckedResult,
  type SessionRow,
} from "../lib/sync/smartscanSync";
import { buildTemplate } from "../lib/scanner/omr-template";
import { readSheet, toGray } from "../lib/scanner/omr-detect";
import { Button } from "../components/ui";

// The config/auth gate is DERIVED during render from auth state; only the
// post-auth flow (claim → scan → review → done) is kept in state.
type Flow = "claiming" | "error" | "ready" | "review" | "done";

export default function SmartScanMobilePage() {
  const { sessionId = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const auth = useSupabaseAuth();
  const configured = isSupabaseConfigured();

  const [stage, setStage] = useState<Flow>("claiming");
  const [error, setError] = useState("");
  const [session, setSession] = useState<SessionRow | null>(null);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const capRef = useRef<HTMLCanvasElement>(null);
  const [detected, setDetected] = useState<{ item: number; answer: string; status: string; confidence: number }[]>([]);
  const [learnerId, setLearnerId] = useState("");
  const [busy, setBusy] = useState(false);

  // Claim the session once signed in (config/auth gates are derived in render).
  useEffect(() => {
    if (!configured || auth.loading || !auth.teacherUserId || stage !== "claiming") return;
    let active = true;
    claimSession(sessionId, token, navigator.userAgent.slice(0, 60)).then((res) => {
      if (!active) return;
      if (res.ok) {
        setSession(res.session);
        setStage("ready");
      } else {
        setError(
          res.reason === "expired" ? "This pairing link has expired. Ask the PC to start a new session."
          : res.reason === "invalid_token" ? "Invalid pairing link."
          : res.reason === "ended" ? "This scanning session was ended on the PC."
          : res.reason === "not_found" ? "Pairing session not found."
          : "Sync is unavailable right now.",
        );
        setStage("error");
      }
    });
    return () => { active = false; };
  }, [stage, configured, auth.loading, auth.teacherUserId, sessionId, token]);

  async function requestLink() {
    const r = await sendMagicLink(email, window.location.href);
    if (r.ok) setEmailSent(true);
    else setError(r.error ?? "Could not send the link.");
  }

  // Read one captured photo: decode QR -> match assessment -> read bubbles.
  const onPhoto = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !session) return;
      setBusy(true);
      const im = new Image();
      im.onload = () => {
        const canvas = capRef.current;
        const scale = Math.min(1, 1600 / im.naturalWidth);
        const w = Math.round(im.naturalWidth * scale);
        const h = Math.round(im.naturalHeight * scale);
        if (canvas) { canvas.width = w; canvas.height = h; }
        const c = canvas?.getContext("2d", { willReadFrequently: true });
        if (!c) { setBusy(false); return; }
        c.drawImage(im, 0, 0, w, h);
        URL.revokeObjectURL(im.src);
        const img = c.getImageData(0, 0, w, h);
        const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
        if (!qr?.data) { setError("No QR found. Retake with the whole sheet visible."); setBusy(false); return; }
        const decoded = decodeQrPayload(qr.data);
        if (!decoded.ok) { setError(decoded.reason); setBusy(false); return; }
        if (!assessmentMatches(session.assessment_id, decoded.payload.assessmentId)) {
          setError("This answer sheet belongs to a different assessment.");
          setBusy(false);
          return;
        }
        const template = buildTemplate(Math.max(1, decoded.payload.n || 1));
        const reading = readSheet(toGray(img), template);
        if (!reading.aligned) { setError("Couldn't find the 4 corner markers. Retake flat, all corners visible."); setBusy(false); return; }
        setLearnerId(decoded.payload.learnerId);
        setDetected(reading.items.map((r) => ({ item: r.item, answer: r.detected ?? "", status: r.status, confidence: r.confidence })));
        setStage("review");
        setBusy(false);
      };
      im.onerror = () => { setError("Could not open that photo."); setBusy(false); };
      im.src = URL.createObjectURL(file);
    },
    [session],
  );

  async function submit() {
    if (!session || !auth.teacherUserId) return;
    setBusy(true);
    const answerMap: Record<string, string> = {};
    detected.forEach((d) => { answerMap[String(d.item)] = d.answer; });
    const conf = detected.length ? detected.reduce((s, d) => s + d.confidence, 0) / detected.length : 0;
    const low = detected.filter((d) => d.status === "unclear" || d.status === "multiple").map((d) => d.item);
    const ok = await upsertCheckedResult({
      assessment_id: session.assessment_id,
      teacher_user_id: auth.teacherUserId,
      school_id: session.school_id,
      learner_id: learnerId,
      learner_name: null,
      section_name: null,
      subject_name: null,
      score: 0, // final scoring against the key happens on the PC
      total_items: detected.length,
      percentage: 0,
      answer_map: answerMap,
      item_results: detected,
      qr_payload: null,
      scan_session_id: session.id,
      scan_source: "phone_camera",
      scan_confidence: Math.round(conf * 100) / 100,
      low_confidence_items: low,
      corrected_by_teacher: true,
      checked_at: new Date().toISOString(),
    });
    setBusy(false);
    if (ok) { setStage("done"); }
    else setError("Upload failed — check your connection and try again.");
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white p-4">
      <header className="mb-3 rounded-lg bg-indigo-700 px-4 py-3 text-white">
        <div className="text-lg font-extrabold">DALIguro Phone Scanner</div>
        {session ? <div className="text-xs opacity-90">Paired · assessment {session.assessment_id}</div> : null}
      </header>

      {error ? (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</div>
      ) : null}

      {/* Gate: not configured / signed out / loading are DERIVED, not stateful. */}
      {!configured ? (
        <Info>Realtime sync is not enabled on this build. Ask your admin to configure Supabase.</Info>
      ) : auth.loading ? (
        <Info>Checking sign-in…</Info>
      ) : !auth.teacherUserId ? (
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-bold">Sign in to scan</div>
          <p className="mt-1 text-xs text-slate-500">Use the same teacher email you use on the PC.</p>
          {emailSent ? (
            <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-800">
              Magic link sent to {email}. Open it on this phone, then return here.
            </div>
          ) : (
            <div className="mt-3 grid gap-2">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teacher@email.com"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm" inputMode="email" />
              <Button onClick={requestLink}>Send magic link</Button>
            </div>
          )}
        </div>
      ) : (
      <>
      {stage === "claiming" ? <Info>Connecting to the PC session…</Info> : null}

      {stage === "ready" ? (
        <div className="rounded-xl border border-slate-200 p-4 text-center">
          <div className="text-sm font-bold">Connected — ready to scan</div>
          <p className="mt-1 text-xs text-slate-500">Photograph the whole answer sheet: all four black corners + QR, flat and well-lit.</p>
          <Button className="mt-3" onClick={() => fileRef.current?.click()}>📷 Scan answer sheet</Button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
          {busy ? <div className="mt-2 text-xs text-slate-400">Reading…</div> : null}
        </div>
      ) : null}

      {stage === "review" ? (
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-sm font-bold">Review detected answers</div>
          <p className="text-xs text-slate-500">Learner {learnerId} · {detected.length} items. Final score is computed on the PC.</p>
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
            {detected.map((d) => (
              <div key={d.item} className={"flex items-center justify-between rounded border px-2 py-1 " +
                (d.status === "unclear" || d.status === "multiple" ? "border-amber-300 bg-amber-50" : "border-slate-200")}>
                <span className="font-bold">{d.item}</span>
                <span>{d.answer || "—"}</span>
                <span className="text-slate-400">{Math.round(d.confidence * 100)}%</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={submit} disabled={busy}>💾 Submit to PC</Button>
            <Button variant="ghost" onClick={() => setStage("ready")}>Rescan</Button>
          </div>
        </div>
      ) : null}

      {stage === "done" ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-center">
          <div className="text-lg font-extrabold text-emerald-800">✓ Sent to PC</div>
          <p className="mt-1 text-xs text-emerald-700">The result appears on the PC dashboard automatically.</p>
          <Button className="mt-3" onClick={() => { setDetected([]); setLearnerId(""); setError(""); setStage("ready"); }}>
            Scan next sheet
          </Button>
        </div>
      ) : null}
      </>
      )}

      <canvas ref={capRef} className="hidden" />
    </div>
  );
}

function Info({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{children}</div>;
}
