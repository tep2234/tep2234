// SmartScan capture pipeline (QR + OMR). Three INDEPENDENT stages:
//   1. Image  — frame quality: QR found, markers aligned, lighting, blur.
//   2. Identity — decode QR (checksum-verified), resolve assessment + learner
//      against LOCAL data, cross-check the sheet's shaded VERSION bubble and
//      printed item count. A decoded QR is NEVER shown as "rejected".
//   3. Read   — only once identity is resolved, read the bubbles + score,
//      with a per-scan trust score and a compressed evidence snapshot.
// Live mode auto-captures after ~1s of stable good frames (QR + aligned +
// lit); a cooldown stops the same sheet from firing repeatedly, so the
// teacher can batch-scan a pile of papers without touching the screen.

import { useCallback, useEffect, useRef, useState } from "react";
import type { QrAssessmentState } from "../../lib/types";
import {
  classifyMediaError,
  isSecureLike,
  logCameraContext,
  INSECURE_MESSAGE,
  SECURE_CONTEXT_CHECKLIST,
} from "../../lib/camera";
import { findCornerMarkers, sharpnessOf, toGray } from "../../lib/scanner/omr-detect";
import { readQrSmart } from "../../lib/scanner/qr-detect";
import {
  advanceFrameStability,
  normalizedSheetGeometry,
  REQUIRED_STABLE_FRAMES,
  type FrameStabilityState,
} from "../../lib/scanner/frame-stability";
import {
  type StableCaptureExpectation,
  verifyFinalCaptureStability,
} from "../../lib/scanner/final-capture";
import { resolveScanIdentity, type ScanResolution } from "../../lib/scanner/resolve";
import { processStillImage, type ScanResult } from "../../lib/scanner/still-pipeline";
import { Button } from "../ui";
import { Chip, Recovery } from "./ScanRecovery";

export type { ScanResult } from "../../lib/scanner/still-pipeline";

interface BarcodeDetectorLike {
  detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (o?: { formats: string[] }): BarcodeDetectorLike;
}

type Phase = "idle" | "checking" | "requesting" | "live" | "error";

const LIVE_W = 900;
const HOLD_MS = 1100; // stable-good time before auto-capture
const COOLDOWN_MS = 3500; // pause after a capture before the next auto fire
const SAME_SHEET_MS = 8000; // extra wait before re-capturing the SAME learner

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
  const lastEvidenceRef = useRef<string | null>(null);
  // Auto-capture pacing.
  const goodSinceRef = useRef<number | null>(null);
  const stabilityRef = useRef<FrameStabilityState | null>(null);
  const cooldownUntilRef = useRef(0);
  const lastAcceptedRef = useRef<{ learnerId: string; at: number } | null>(null);
  const capturingRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [camMessage, setCamMessage] = useState("");
  const [insecure, setInsecure] = useState(false);
  const [imageMsg, setImageMsg] = useState("");
  const [recovery, setRecovery] = useState<ScanResolution | null>(null);
  // live feedback
  const [liveQr, setLiveQr] = useState<ScanResolution | null>(null);
  const [aligned, setAligned] = useState(false);
  const [brightness, setBrightness] = useState(255);
  const [holding, setHolding] = useState(false);
  const [stableFrames, setStableFrames] = useState(0);
  const [stabilityMessage, setStabilityMessage] = useState("");
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
    setHolding(false);
    stabilityRef.current = null;
    goodSinceRef.current = null;
    setStableFrames(0);
    setStabilityMessage("");
    setPhase("idle");
  }, [release]);

  // ---------- core pipeline (used by photo AND live capture) ----------
  // Runs the pure still-image pipeline, then routes its outcome into UI state.
  const runStill = useCallback(
    (img: ImageData) => {
      const out = processStillImage(img, state, activeId, lastEvidenceRef.current);
      cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
      if (out.kind === "ready") {
        setImageMsg("");
        setRecovery(null);
        lastAcceptedRef.current = { learnerId: out.result.learner.id, at: Date.now() };
        if (out.switchToAssessment) onSetActive(out.switchToAssessment);
        onResult(out.result);
      } else if (out.kind === "image") {
        setImageMsg(out.message);
        setRecovery(null);
      } else {
        setRecovery(out.resolution);
        setImageMsg("");
      }
    },
    [state, activeId, onSetActive, onResult],
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
      // Compressed evidence snapshot (~800px wide JPEG) for the archive.
      try {
        const ev = document.createElement("canvas");
        const es = Math.min(1, 800 / w);
        ev.width = Math.round(w * es);
        ev.height = Math.round(h * es);
        ev.getContext("2d")?.drawImage(canvas, 0, 0, ev.width, ev.height);
        lastEvidenceRef.current = ev.toDataURL("image/jpeg", 0.6);
      } catch {
        lastEvidenceRef.current = null;
      }
      return c.getImageData(0, 0, w, h);
    },
    [],
  );

  const capture = useCallback((expected?: StableCaptureExpectation): boolean => {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || capturingRef.current) return false;
    capturingRef.current = true;
    try {
      const img = grabImageData(v, v.videoWidth, v.videoHeight);
      if (!img) return false;
      if (expected) {
        const gray = toGray(img);
        const geometry = normalizedSheetGeometry(
          findCornerMarkers(gray),
          img.width,
          img.height,
        );
        const identity = readQrSmart(img, true)?.data ?? null;
        const brightness = Math.round(quickBrightness(img.data));
        const sharpness = sharpnessOf(gray);
        const finalObservation = verifyFinalCaptureStability(expected, {
          identity,
          geometry,
          luminance: brightness,
          sharpness,
          observedAt: Date.now(),
        });
        if (!finalObservation.ok) {
          setStabilityMessage(finalObservation.message);
          return false;
        }
      }
      lastImageRef.current = img;
      runStill(img);
      return true;
    } finally {
      capturingRef.current = false;
    }
  }, [grabImageData, runStill]);

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
        runStill(data);
      };
      im.onerror = () => setImageMsg("Could not open that photo. Try another.");
      im.src = URL.createObjectURL(file);
    },
    [grabImageData, runStill],
  );

  // ---------- live preview loop (status chips + auto-capture) ----------
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
    const session = sessionRef.current;
    const runIsActive = () =>
      mountedRef.current &&
      session === sessionRef.current &&
      streamRef.current !== null;
    if (!runIsActive()) return;
    const frame = liveGray();
    if (frame) {
      const canvas = liveCanvasRef.current;
      let raw: string | null = null;
      if (detectorRef.current && canvas) {
        try {
          // Identity and geometry must come from the exact same preview pixels.
          const codes = await detectorRef.current.detect(canvas);
          if (!runIsActive()) return;
          raw = codes[0]?.rawValue ?? null;
        } catch {
          if (!runIsActive()) return;
          detectorRef.current = null;
          setUsingFallback(true);
        }
      }
      if (!raw) {
        raw = readQrSmart(frame, false)?.data ?? null;
      }
      const res = raw ? resolveScanIdentity(raw, state, activeId) : null;
      setLiveQr(res);
      const gray = toGray(frame);
      const corners = findCornerMarkers(gray);
      const geometry = normalizedSheetGeometry(corners, frame.width, frame.height);
      const isAligned = geometry !== null;
      setAligned(isAligned);
      const bright = Math.round(quickBrightness(frame.data));
      const sharpness = sharpnessOf(gray);
      setBrightness(bright);

      // Auto-capture requires exact fresh QR identity plus several consecutive
      // frames with stable sheet corners, scale, rotation, lighting, and focus.
      const qrOk = res?.status === "READY" || res?.status === "ASSESSMENT_NOT_ACTIVE";
      const now = Date.now();
      const sameSheet =
        qrOk &&
        lastAcceptedRef.current !== null &&
        (res.status === "READY" || res.status === "ASSESSMENT_NOT_ACTIVE") &&
        res.learner.id === lastAcceptedRef.current.learnerId &&
        now - lastAcceptedRef.current.at < SAME_SHEET_MS;
      const good =
        qrOk &&
        raw !== null &&
        geometry !== null &&
        bright >= 70 &&
        bright <= 245 &&
        sharpness >= 2.4 &&
        now >= cooldownUntilRef.current &&
        !sameSheet;
      if (good && raw !== null && geometry !== null) {
        const decision = advanceFrameStability(stabilityRef.current, {
          identity: raw,
          geometry,
          luminance: bright,
          sharpness,
          observedAt: now,
          freshIdentity: true,
        });
        stabilityRef.current = decision.state;
        const count = decision.state?.consecutive ?? 0;
        setStableFrames(count);
        if (count === 1) goodSinceRef.current = now;
        const stableSince = goodSinceRef.current ?? now;
        goodSinceRef.current = stableSince;
        const held = now - stableSince;
        setHolding(true);
        if (decision.resetReason === "motion") {
          setStabilityMessage(`Sheet movement detected. Hold still for ${REQUIRED_STABLE_FRAMES} consecutive frames.`);
        } else if (decision.resetReason === "quality_changed") {
          setStabilityMessage(`Focus or lighting changed. Keep the sheet clear for ${REQUIRED_STABLE_FRAMES} consecutive frames.`);
        } else if (decision.resetReason === "timeout") {
          setStabilityMessage(`Frame analysis paused. Hold still for ${REQUIRED_STABLE_FRAMES} new consecutive frames.`);
        } else {
          setStabilityMessage(`Hold still: ${Math.min(count, REQUIRED_STABLE_FRAMES)}/${REQUIRED_STABLE_FRAMES} stable frames.`);
        }
        if (decision.ready && held >= HOLD_MS) {
          const expectation = stabilityRef.current && raw
            ? { identity: raw, state: stabilityRef.current }
            : null;
          goodSinceRef.current = null;
          stabilityRef.current = null;
          setStableFrames(0);
          setHolding(false);
          if (expectation && capture(expectation)) {
            setStabilityMessage("Stable capture confirmed. Processing sheet…");
          }
        }
      } else {
        goodSinceRef.current = null;
        stabilityRef.current = null;
        setStableFrames(0);
        setHolding(false);
        if (!raw) setStabilityMessage("Keep the QR fully visible on every frame.");
        else if (!isAligned) setStabilityMessage("Place the full sheet inside the frame with all four corner targets visible.");
        else if (bright < 70) setStabilityMessage("Too dark. Use brighter, even light.");
        else if (bright > 245) setStabilityMessage("Strong glare or overexposure detected. Change the angle or light.");
        else if (sharpness < 2.4) setStabilityMessage("Image is blurred. Hold still and wait for focus.");
        else if (sameSheet) setStabilityMessage("This sheet was just captured. Move to the next learner or wait before rescanning.");
      }
    }
    if (runIsActive()) rafRef.current = requestAnimationFrame(() => loopRef.current());
  }, [activeId, capture, liveGray, state]);

  useEffect(() => {
    loopRef.current = () => void loop();
  }, [loop]);

  const start = useCallback(async () => {
    const session = (sessionRef.current += 1);
    const alive = () => mountedRef.current && session === sessionRef.current;
    setCamMessage("");
    setInsecure(false);
    stabilityRef.current = null;
    goodSinceRef.current = null;
    setStableFrames(0);
    setStabilityMessage("Requesting camera access…");
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
    if (!alive()) {
      release();
      return;
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
  const lightingOk = brightness >= 70 && brightness <= 245;
  const liveQrOk = liveQr?.status === "READY" || liveQr?.status === "ASSESSMENT_NOT_ACTIVE";
  const liveLearnerName =
    liveQr && (liveQr.status === "READY" || liveQr.status === "ASSESSMENT_NOT_ACTIVE")
      ? liveQr.learner.fullName
      : "";

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-indigo-800">🗒️ SmartScan</span>
        {usingFallback && live ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">jsQR fallback</span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => fileInputRef.current?.click()}>📷 Scan with camera</Button>
          {live ? (
            <>
              <Button variant="small" onClick={() => { void capture(); }}>📸 Capture now</Button>
              <Button variant="smallDanger" onClick={stop}>Stop</Button>
            </>
          ) : (
            <Button variant="small" onClick={() => void start()} disabled={phase === "checking" || phase === "requesting"}>
              {phase === "error" ? "Retry live camera" : "Live camera (auto-capture)"}
            </Button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
      </div>

      <p className="mt-2 text-xs text-slate-500">
        <b>📷 Scan with camera</b> photographs one sheet. <b>Live camera</b> auto-captures
        each sheet after ~1 second of steady framing — all four black corners + QR visible,
        flat and well-lit — so you can go through a pile paper after paper.
      </p>

      {/* Live chips: QR decode + identity + image quality are independent. */}
      {live ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          <Chip ok={liveQrOk} okText={liveLearnerName ? "Learner: " + liveLearnerName : "QR ready"} badText={liveQr ? "QR: data not loaded" : "QR: searching…"} />
          <Chip ok={aligned} okText="Sheet aligned ✓" badText="Align all 4 corners…" />
          <Chip
            ok={lightingOk}
            okText="Lighting OK"
            badText={brightness > 245 ? "Too bright / glare" : "Too dark"}
          />
          {holding ? (
            <span className="animate-pulse rounded-full bg-indigo-100 px-2.5 py-1 text-indigo-800">
              Hold steady — {Math.min(stableFrames, REQUIRED_STABLE_FRAMES)}/{REQUIRED_STABLE_FRAMES}
            </span>
          ) : null}
          {stabilityMessage ? (
            <span className="w-full rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700" role="status">
              {stabilityMessage}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="relative mt-3 overflow-hidden rounded-lg bg-slate-900">
        <video ref={videoRef} playsInline muted autoPlay className="mx-auto block max-h-80 w-full object-contain" />
        {!live ? (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-slate-300">
            {phase === "error"
              ? "⚠ Live camera unavailable — use 📷 Scan with camera."
              : phase === "requesting"
                ? "Waiting for permission… choose Allow."
                : "Use 📷 Scan with camera, or start the live camera for hands-free batch scanning."}
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
          onSwitchActive={(id) => {
            onSetActive(id);
            const img = lastImageRef.current;
            setRecovery(null);
            if (img) runStill(img);
          }}
          onDismiss={() => setRecovery(null)}
        />
      ) : null}
    </div>
  );
}
