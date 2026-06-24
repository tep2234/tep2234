// Phase 12 — Scan Answer Sheet (QR + OMR).
// Three INDEPENDENT stages, never conflated:
//   1. Image  — got a frame? found a QR? markers aligned? lighting ok?
//   2. Identity — decode QR, then resolve assessment + learner against LOCAL
//      data (a decoded QR is NEVER shown as "rejected"; it resolves to an
//      explicit state with a recovery action).
//   3. Read   — only once identity is resolved, read the bubbles + score.
// Results are self-contained (scored under the QR's OWN assessment, from local
// data) — never under whatever assessment happens to be active.

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import type { Assessment, Learner, QrAssessmentState, TestVersion } from "../../lib/types";
import {
  classifyMediaError,
  isSecureLike,
  logCameraContext,
  INSECURE_MESSAGE,
  SECURE_CONTEXT_CHECKLIST,
} from "../../lib/camera";
import { buildTemplate, omrItemsOf } from "../../lib/scanner/omr-template";
import { findCornerMarkers, readSheet, toGray, type SheetReading } from "../../lib/scanner/omr-detect";
import { buildReview, type ReviewSummary } from "../../lib/scanner/omr-score";
import { resolveScanIdentity, type ScanResolution } from "../../lib/scanner/resolve";
import { Button } from "../ui";

interface BarcodeDetectorLike {
  detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (o?: { formats: string[] }): BarcodeDetectorLike;
}

export interface ScanResult {
  assessment: Assessment;
  learner: Learner;
  version: TestVersion;
  summary: ReviewSummary;
  reading: SheetReading;
  source: "qr" | "manual";
}

type Phase = "idle" | "checking" | "requesting" | "live" | "error";

type StillOutcome =
  | { kind: "ready"; result: ScanResult }
  | { kind: "image"; message: string }
  | { kind: "identity"; resolution: ScanResolution };

const LIVE_W = 900;

function omrContext(state: QrAssessmentState, assessmentId: string) {
  const items = omrItemsOf(state.items.filter((i) => i.assessmentId === assessmentId));
  const template = buildTemplate(Math.max(1, items.length));
  const validByItem: Record<number, number> = {};
  items.forEach((it, i) => (validByItem[i + 1] = Math.max(2, Math.min(it.choices, 4))));
  return { items, template, validByItem };
}

function quickBrightness(data: Uint8ClampedArray | number[]): number {
  let sum = 0;
  let n = 0;
  const step = Math.max(4, Math.floor(data.length / 40000) * 4);
  for (let i = 0; i < data.length; i += step) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    n += 1;
  }
  return n ? sum / n : 255;
}

export function AnswerSheetScanner({
  state,
  activeId,
  onSetActive,
  onResult,
}: {
  state: QrAssessmentState;
  activeId: string | null;
  onSetActive: (id: string) => void;
  onResult: (r: ScanResult) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const capCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const loopRef = useRef<() => void>(() => {});
  const mountedRef = useRef(true);
  const sessionRef = useRef(0);
  const lastImageRef = useRef<ImageData | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [camMessage, setCamMessage] = useState("");
  const [insecure, setInsecure] = useState(false);
  const [imageMsg, setImageMsg] = useState("");
  const [recovery, setRecovery] = useState<ScanResolution | null>(null);
  const [manualLearnerId, setManualLearnerId] = useState("");
  // live feedback
  const [liveQr, setLiveQr] = useState<ScanResolution | null>(null);
  const [aligned, setAligned] = useState(false);
  const [brightness, setBrightness] = useState(255);
  const [usingFallback, setUsingFallback] = useState(false);

  const release = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    release();
    setLiveQr(null);
    setAligned(false);
    setPhase("idle");
  }, [release]);

  // ---------- core pipeline (used by photo AND live capture) ----------
  const processStill = useCallback(
    (img: ImageData, manualId?: string): StillOutcome => {
      const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
      if (!qr || !qr.data) {
        return { kind: "image", message: "No QR code found. Make sure the QR is fully visible, focused, and glare-free." };
      }
      const res = resolveScanIdentity(qr.data, state, activeId);

      // Decide the learner: from the QR, or a deliberate manual override.
      let learner: Learner | null = null;
      let assessment: Assessment | null = null;
      let version: TestVersion = "A";
      if (res.status === "READY" || res.status === "ASSESSMENT_NOT_ACTIVE") {
        learner = res.learner;
        assessment = res.assessment;
        version = res.version;
      } else if (res.status === "LEARNER_NOT_FOUND" && manualId) {
        const picked = state.learners.find((l) => l.id === manualId);
        if (picked) {
          learner = picked;
          assessment = res.assessment;
          version = res.payload.version;
        }
      }
      if (!learner || !assessment) {
        return { kind: "identity", resolution: res };
      }

      // Read the bubbles using the RESOLVED assessment's own template/key.
      const ctx = omrContext(state, assessment.id);
      if (ctx.items.length === 0) {
        return { kind: "image", message: "This assessment has no A–D items for OMR." };
      }
      const gray = toGray(img);
      const reading = readSheet(gray, ctx.template, ctx.validByItem);
      if (!reading.aligned) {
        return { kind: "image", message: "Found the QR, but not the 4 corner markers. Capture the WHOLE sheet, flat, all corners visible, no glare." };
      }
      if (reading.brightness < 70) {
        return { kind: "image", message: "Found the QR, but the photo is too dark — use brighter light and retake." };
      }
      const vk = (state.answerKeys[assessment.id] ?? {})[version] ?? {};
      const summary = buildReview(ctx.items, vk, reading.items);
      // Align app context to the QR's assessment so Results/Analysis match.
      if (res.status === "ASSESSMENT_NOT_ACTIVE" && manualId === undefined) {
        onSetActive(assessment.id);
      }
      return {
        kind: "ready",
        result: { assessment, learner, version, summary, reading, source: manualId ? "manual" : "qr" },
      };
    },
    [state, activeId, onSetActive],
  );

  const route = useCallback(
    (out: StillOutcome) => {
      if (out.kind === "ready") {
        setImageMsg("");
        setRecovery(null);
        onResult(out.result);
      } else if (out.kind === "image") {
        setImageMsg(out.message);
        setRecovery(null);
      } else {
        setRecovery(out.resolution);
        setImageMsg("");
        setManualLearnerId("");
      }
    },
    [onResult],
  );

  const grabImageData = useCallback(
    (src: HTMLVideoElement | HTMLImageElement, sw: number, sh: number): ImageData | null => {
      const canvas = capCanvasRef.current;
      if (!canvas || !sw || !sh) return null;
      const scale = Math.min(1, 1600 / sw);
      const w = Math.round(sw * scale);
      const h = Math.round(sh * scale);
      canvas.width = w;
      canvas.height = h;
      const c = canvas.getContext("2d", { willReadFrequently: true });
      if (!c) return null;
      c.drawImage(src, 0, 0, w, h);
      return c.getImageData(0, 0, w, h);
    },
    [],
  );

  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    const img = grabImageData(v, v.videoWidth, v.videoHeight);
    if (!img) return;
    lastImageRef.current = img;
    route(processStill(img));
  }, [grabImageData, processStill, route]);

  const onPhoto = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setImageMsg("Reading photo…");
      const im = new Image();
      im.onload = () => {
        const data = grabImageData(im, im.naturalWidth, im.naturalHeight);
        URL.revokeObjectURL(im.src);
        if (!data) {
          setImageMsg("Could not read that image.");
          return;
        }
        lastImageRef.current = data;
        route(processStill(data));
      };
      im.onerror = () => setImageMsg("Could not open that photo. Try another.");
      im.src = URL.createObjectURL(file);
    },
    [grabImageData, processStill, route],
  );

  const confirmManual = useCallback(() => {
    const img = lastImageRef.current;
    if (!img || !manualLearnerId) return;
    const picked = state.learners.find((l) => l.id === manualLearnerId);
    if (!picked) return;
    if (!window.confirm(`The QR learner was NOT found. Assign this scan to ${picked.fullName} instead?`)) return;
    route(processStill(img, manualLearnerId));
  }, [manualLearnerId, processStill, route, state.learners]);

  // ---------- live preview loop (chips only) ----------
  const liveGray = useCallback(() => {
    const v = videoRef.current;
    const canvas = liveCanvasRef.current;
    if (!v || !canvas || v.readyState < 2) return null;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.min(1, LIVE_W / vw);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d", { willReadFrequently: true });
    if (!c) return null;
    c.drawImage(v, 0, 0, w, h);
    return c.getImageData(0, 0, w, h);
  }, []);

  const loop = useCallback(async () => {
    const frame = liveGray();
    if (frame) {
      const v = videoRef.current;
      let raw: string | null = null;
      if (detectorRef.current && v) {
        try {
          const codes = await detectorRef.current.detect(v);
          raw = codes[0]?.rawValue ?? null;
        } catch {
          detectorRef.current = null;
          setUsingFallback(true);
        }
      }
      if (!raw) {
        const g = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
        raw = g ? g.data : null;
      }
      setLiveQr(raw ? resolveScanIdentity(raw, state, activeId) : null);
      const gray = toGray(frame);
      setAligned(findCornerMarkers(gray) !== null);
      setBrightness(Math.round(quickBrightness(frame.data)));
    }
    rafRef.current = requestAnimationFrame(() => loopRef.current());
  }, [activeId, liveGray, state]);

  useEffect(() => {
    loopRef.current = () => void loop();
  }, [loop]);

  const start = useCallback(async () => {
    const session = (sessionRef.current += 1);
    const alive = () => mountedRef.current && session === sessionRef.current;
    setCamMessage("");
    setInsecure(false);
    setPhase("checking");
    logCameraContext("scan-start");

    if (!isSecureLike()) {
      setPhase("error");
      setInsecure(true);
      setCamMessage(INSECURE_MESSAGE);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setCamMessage("This browser can't open a camera here. Use the photo button instead.");
      return;
    }
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    detectorRef.current = null;
    setUsingFallback(false);
    if (Ctor) {
      try {
        detectorRef.current = new Ctor({ formats: ["qr_code"] });
      } catch {
        detectorRef.current = null;
      }
    }
    if (!detectorRef.current) setUsingFallback(true);

    setPhase("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" }, audio: false })
        .catch((err) => {
          if (err instanceof DOMException && (err.name === "OverconstrainedError" || err.name === "NotFoundError")) {
            return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
          throw err;
        });
    } catch (err) {
      if (!alive()) return;
      setPhase("error");
      setCamMessage(classifyMediaError(err, true).message);
      return;
    }
    if (!alive()) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const v = videoRef.current;
    if (!v) {
      release();
      return;
    }
    setPhase("live");
    v.srcObject = stream;
    try {
      await v.play();
    } catch {
      /* muted autoplay */
    }
    rafRef.current = requestAnimationFrame(() => loopRef.current());
  }, [release]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      release();
    };
  }, [release]);

  const live = phase === "live";
  const dark = brightness < 70;
  const liveQrOk = liveQr?.status === "READY" || liveQr?.status === "ASSESSMENT_NOT_ACTIVE";
  const liveLearnerName =
    liveQr && (liveQr.status === "READY" || liveQr.status === "ASSESSMENT_NOT_ACTIVE")
      ? liveQr.learner.fullName
      : "";

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-indigo-800">🗒️ Scan Answer Sheet</span>
        {usingFallback && live ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">jsQR fallback</span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => fileInputRef.current?.click()}>📷 Take / upload photo</Button>
          {live ? (
            <>
              <Button variant="small" onClick={capture}>📸 Capture frame</Button>
              <Button variant="smallDanger" onClick={stop}>Stop</Button>
            </>
          ) : (
            <Button variant="small" onClick={() => void start()} disabled={phase === "checking" || phase === "requesting"}>
              {phase === "error" ? "Retry live camera" : "Use live camera"}
            </Button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onPhoto} />
      </div>

      <p className="mt-2 text-xs text-slate-500">
        <b>Recommended:</b> tap <b>📷 Take / upload photo</b> → <b>Take Photo</b>,
        fit the WHOLE sheet (all four black corners + the QR), flat and well-lit.
      </p>

      {/* Live chips: QR decode + identity + image quality are independent. */}
      {live ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          <Chip ok={liveQrOk} okText={liveLearnerName ? "Learner: " + liveLearnerName : "QR ready"} badText={liveQr ? "QR: data not loaded" : "QR: searching…"} />
          <Chip ok={aligned} okText="Sheet aligned ✓" badText="Align all 4 corners…" />
          <Chip ok={!dark} okText="Lighting OK" badText="Too dark" />
        </div>
      ) : null}

      <div className="relative mt-3 overflow-hidden rounded-lg bg-slate-900">
        <video ref={videoRef} playsInline muted autoPlay className="mx-auto block max-h-80 w-full object-contain" />
        {!live ? (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-slate-300">
            {phase === "error"
              ? "⚠ Live camera unavailable — use 📷 Take / upload photo."
              : phase === "requesting"
                ? "Waiting for permission… choose Allow."
                : "Use 📷 Take / upload photo (recommended), or start the live camera."}
          </div>
        ) : null}
      </div>
      <canvas ref={liveCanvasRef} className="hidden" />
      <canvas ref={capCanvasRef} className="hidden" />

      {imageMsg ? (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">{imageMsg}</div>
      ) : null}

      {camMessage ? (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">{camMessage}</div>
      ) : null}
      {insecure ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="font-bold text-slate-600">Camera checklist (iPhone):</div>
          <ul className="mt-1 list-disc pl-5">
            {SECURE_CONTEXT_CHECKLIST.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {recovery ? (
        <Recovery
          resolution={recovery}
          state={state}
          manualLearnerId={manualLearnerId}
          onManualLearnerId={setManualLearnerId}
          onConfirmManual={confirmManual}
          onSwitchActive={(id) => {
            onSetActive(id);
            const img = lastImageRef.current;
            setRecovery(null);
            if (img) route(processStill(img));
          }}
          onDismiss={() => setRecovery(null)}
        />
      ) : null}
    </div>
  );
}

function Chip({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span className={"rounded-full px-2.5 py-1 " + (ok ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500")}>
      {ok ? okText : badText}
    </span>
  );
}

// Recovery card shown when the QR decoded but identity didn't resolve. It never
// says "rejected": the QR was read; the data just isn't loaded/active here.
function Recovery({
  resolution,
  state,
  manualLearnerId,
  onManualLearnerId,
  onConfirmManual,
  onSwitchActive,
  onDismiss,
}: {
  resolution: ScanResolution;
  state: QrAssessmentState;
  manualLearnerId: string;
  onManualLearnerId: (id: string) => void;
  onConfirmManual: () => void;
  onSwitchActive: (id: string) => void;
  onDismiss: () => void;
}) {
  const r = resolution;
  const [showTech, setShowTech] = useState(false);

  let title = "QR read successfully — can't continue yet";
  let body = "";
  if (r.status === "QR_PAYLOAD_INVALID") {
    title = "This isn't a DALIguro answer-sheet QR";
    body = r.reason;
  } else if (r.status === "ASSESSMENT_NOT_FOUND") {
    title = "QR read — this assessment isn't on this device";
    body =
      "The sheet's assessment isn't loaded in this browser. On this device, import the same backup (Setup → Import/restore) or tap ⚡ Load demo if this is the demo, then scan again. Opening the same web link does NOT copy data between devices.";
  } else if (r.status === "LEARNER_NOT_FOUND") {
    title = "QR read — learner not loaded on this device";
    body =
      "The assessment is here, but the learner on the sheet isn't (the sheet may be from a different data set). Reprint sheets from this device's data, import the matching backup, or pick the learner manually below.";
  } else if (r.status === "ASSESSMENT_NOT_ACTIVE") {
    title = "QR read — switch to its assessment";
    body = "This sheet is for an assessment that's loaded but not active.";
  }

  return (
    <div className="mt-2 rounded-lg border border-indigo-300 bg-indigo-50 p-3 text-sm text-indigo-900">
      <div className="font-extrabold">✓ {title}</div>
      <p className="mt-1 text-xs">{body}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === "ASSESSMENT_NOT_ACTIVE" ? (
          <Button variant="small" onClick={() => onSwitchActive(r.assessment.id)}>
            Switch to “{r.assessment.title}” &amp; read
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onDismiss}>Scan another</Button>
      </div>

      {r.status === "LEARNER_NOT_FOUND" ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
          <div className="text-xs font-bold text-slate-600">Manual fallback (use with care):</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <select
              value={manualLearnerId}
              onChange={(e) => onManualLearnerId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
            >
              <option value="">— pick learner —</option>
              {state.learners.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.fullName}
                  {l.section ? " (" + l.section + ")" : ""}
                </option>
              ))}
            </select>
            <Button variant="small" onClick={onConfirmManual}>Use this learner</Button>
          </div>
        </div>
      ) : null}

      <button className="mt-2 text-xs font-bold text-indigo-700" onClick={() => setShowTech((s) => !s)}>
        {showTech ? "Hide" : "Show"} technical details
      </button>
      {showTech && r.status !== "QR_PAYLOAD_INVALID" ? (
        <div className="mt-1 rounded bg-white/70 p-2 font-mono text-[11px] text-slate-600">
          <div>scanned assessmentId: {r.payload.assessmentId}</div>
          <div>scanned learnerId: {r.payload.learnerId}</div>
          <div>scanned version: {r.payload.version}</div>
          <div>assessments loaded: {state.assessments.length}</div>
          <div>learners loaded: {state.learners.length}</div>
        </div>
      ) : null}
    </div>
  );
}
