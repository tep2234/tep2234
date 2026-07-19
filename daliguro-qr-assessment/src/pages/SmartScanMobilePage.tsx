// Phone scanner page (deep-linked from the PC pairing QR):
//   /smartscan/mobile/:sessionId?t=ONE_TIME_PAIRING_SECRET
// The phone is intentionally NOT a second dashboard. It is a temporary camera
// companion. The one-time secret is exchanged for a short-lived capability and
// stripped from the URL. The database inbox is durable before the PC processes
// the scan, and the phone polls only its capability-scoped status RPC.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { classifyMediaError, isSecureLike } from "../lib/camera";
import { isSupabaseConfigured } from "../lib/supabase/client";
import { type ScanDetection, type ScoreBroadcast } from "../lib/sync/pairing";
import { claimSession, getPhoneSubmissionStatus, submitPhoneScan } from "../lib/sync/smartscanSync";
import {
  buildPhoneSubmissionEnvelope,
  clearPhoneCapability,
  loadPhoneCapability,
  nextPhoneSequence,
  safePhoneError,
  savePhoneCapability,
  stripPairingSecretFromUrl,
  type PhoneCapability,
} from "../lib/sync/realtime-security";
import { CHOICES } from "../lib/scanner/omr-template";
import { BLANK_REVIEW_CONFIDENCE, REVIEW_CONFIDENCE } from "../lib/scanner/omr-score";
import { buildConsensusScan, type FillAccum } from "../lib/scanner/mobile-consensus";
import {
  advanceFrameStability,
  REQUIRED_STABLE_FRAMES,
  type FrameStabilityState,
} from "../lib/scanner/frame-stability";
import { verifyFinalMobileCapture } from "../lib/scanner/final-capture";
import {
  ingestGalleryImage,
  ScannerGeneration,
} from "../lib/scanner/image-ingestion";
import {
  CameraLifecycleMachine,
  stopCameraStreamOnce,
  type CameraLifecycleOutcome,
} from "../lib/scanner/camera-lifecycle";
import {
  analyzeFrameData,
  type FrameAnalysis,
  type FrameResult,
  type MobileScan,
} from "../lib/scanner/mobile-analyze";
import {
  acknowledgeHeldScan,
  buildSafeScanDiagnostic,
  generateScanId,
  parseHeldScans,
  upsertHeldScan,
  type HeldScan,
} from "../lib/sync/scan-outbox";
import type { FrameRequest, FrameResponse } from "../lib/scanner/omr-frame-worker";
import { Button } from "../components/ui";

type Flow = "ready" | "live" | "review" | "done";
type SyncState = "idle" | "pending" | "sent" | "pc_received" | "saved" | "scored" | "failed";
type SignalTone = "good" | "warn" | "bad";
type CapturedMobileScan = MobileScan & {
  scanId: string;
  capturedAt: number;
  captureSource: "gallery" | "camera-final" | "manual-capture";
};

// Number of aligned frames averaged before we trust a reading. A short burst
// denoises the read while still locking fast (~3 good frames).
const CONSENSUS_FRAMES = REQUIRED_STABLE_FRAMES;
const FRAME_W = 1300;
const FINAL_CAPTURE_W = 2200;
const COOLDOWN_MS = 2500;
// Throttle the heavy analysis so the RAF loop yields the main thread to touch
// events — keeps buttons responsive on phones instead of janky/laggy.
const ANALYZE_INTERVAL_MS = 90;
// If the worker hangs (rare — bad frame, browser bug), fall back to the
// main-thread pipeline rather than stalling the scan loop forever.
const WORKER_TIMEOUT_MS = 2000;

// Human-readable status for the review screen — every item carries a clear
// label and (when uncertain) a reason, so nothing is silently empty.
function statusLabel(status: string, confidence: number): { label: string; review: boolean } {
  if (status === "multiple") return { label: "Multiple Marks", review: true };
  if (status === "unclear") return { label: "Ambiguous", review: true };
  if (status === "unreadable") return { label: "Unreadable", review: true };
  if (status === "blank") {
    return confidence < BLANK_REVIEW_CONFIDENCE
      ? { label: "Low-confidence blank", review: true }
      : { label: "Blank", review: false };
  }
  // selected
  if (confidence < REVIEW_CONFIDENCE) return { label: "Low Confidence", review: true };
  return { label: "OK", review: false };
}

async function readNativeQr(source: CanvasImageSource): Promise<string | null> {
  const Detector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const detector = new Detector({ formats: ["qr_code"] });
    const hits = await detector.detect(source);
    return hits.find((hit) => typeof hit.rawValue === "string" && hit.rawValue.trim())?.rawValue ?? null;
  } catch {
    return null;
  }
}

export default function SmartScanMobilePage() {
  const { sessionId = "" } = useParams();
  const pairingTokenRef = useRef(
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("t") ?? "",
  );
  const claimRef = useRef<ReturnType<typeof claimSession> | null>(null);
  const [capability, setCapability] = useState<PhoneCapability | null>(() => {
    if (typeof window === "undefined" || !sessionId) return null;
    return loadPhoneCapability(window.sessionStorage, sessionId);
  });
  const [pairingPending, setPairingPending] = useState(!capability);
  const assessmentId = capability?.assessmentId ?? "";
  // Field-test override: append &engine=sync to the pairing URL to force the
  // main-thread fallback pipeline, so testers can verify both paths.
  const forceSyncEngine = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("engine") === "sync";
  const configured = isSupabaseConfigured();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackEndedCleanupRef = useRef<(() => void) | null>(null);
  const rafRef = useRef<number | null>(null);
  const cameraRunRef = useRef(0);
  const loopRef = useRef<() => void>(() => {});
  const accumRef = useRef<FillAccum | null>(null);
  const stabilityRef = useRef<FrameStabilityState | null>(null);
  const lastAnalyzeRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const workerFailedRef = useRef(forceSyncEngine);
  const lastEngineRef = useRef<"worker" | "fallback">(forceSyncEngine ? "fallback" : "worker");
  const workerReqIdRef = useRef(0);
  const workerPendingRef = useRef(new Map<number, (a: FrameAnalysis) => void>());
  const submittingRef = useRef(false);
  const retryingRef = useRef(false);
  const pendingScanRef = useRef<CapturedMobileScan | null>(null);
  const committedScanIdsRef = useRef(new Set<string>());
  const galleryGenerationRef = useRef(new ScannerGeneration());
  const lifecycleRef = useRef(new CameraLifecycleMachine((snapshot) => {
    if (import.meta.env.DEV) console.info("[camera-lifecycle]", { cameraLifecycleOutcome: snapshot.outcome });
  }));
  const startCameraRef = useRef<(recovering?: boolean) => void>(() => {});

  const [stage, setStage] = useState<Flow>("ready");
  const [error, setError] = useState("");
  const [cameraMessage, setCameraMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastFrame, setLastFrame] = useState<FrameResult | null>(null);
  const [stableCount, setStableCount] = useState(0);
  const [pendingScan, setPendingScan] = useState<CapturedMobileScan | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [engineInfo, setEngineInfo] = useState<{ engine: "worker" | "fallback"; ms: number } | null>(null);
  // Outbox of captured-but-unsent scans, persisted per session so neither
  // "Scan next sheet" nor a page reload can lose a teacher's work.
  const outboxKey = `smartscan_outbox_${sessionId}_${assessmentId}`;
  const [outbox, setOutbox] = useState<HeldScan[]>(() => {
    try {
      const raw = localStorage.getItem(outboxKey);
      return parseHeldScans(raw, sessionId, assessmentId);
    } catch {
      return [];
    }
  });
  const outboxRef = useRef(outbox);
  const replaceOutbox = useCallback((next: HeldScan[]) => {
    outboxRef.current = next;
    try {
      if (next.length === 0) localStorage.removeItem(outboxKey);
      else localStorage.setItem(outboxKey, JSON.stringify(next));
    } catch {
      // Keep the in-memory queue, but never describe it as reload-safe below.
      setError("This scan is queued in memory, but browser storage is unavailable. Keep this page open until the PC confirms it.");
    }
    setOutbox(next);
  }, [outboxKey]);
  const [sentCount, setSentCount] = useState(0);
  const [lastSent, setLastSent] = useState("");
  const [lastScore, setLastScore] = useState<ScoreBroadcast | null>(null);
  const [lastReceiptId, setLastReceiptId] = useState("");

  useEffect(() => {
    pendingScanRef.current = pendingScan;
  }, [pendingScan]);

  // Consume the QR secret once. A short-lived scoped capability is kept only in
  // sessionStorage so a same-tab reconnect can recover; the pairing token is
  // immediately removed from the address bar and is never persisted. The claim
  // promise lives in a ref because the token is single-use: if the effect
  // re-runs (StrictMode double-invoke, remount), the rerun must adopt the
  // in-flight claim rather than find the consumed token and report it missing.
  useEffect(() => {
    if (!configured || !sessionId) return;
    if (capability) {
      if (window.location.search) stripPairingSecretFromUrl(window.location, window.history);
      return;
    }
    const pairingToken = pairingTokenRef.current;
    if (!pairingToken && !claimRef.current) {
      setPairingPending(false);
      setError("This pairing credential is missing or expired. Generate a new QR on the teacher PC.");
      return;
    }
    if (!claimRef.current) {
      pairingTokenRef.current = "";
      stripPairingSecretFromUrl(window.location, window.history);
      claimRef.current = claimSession(sessionId, pairingToken, navigator.userAgent.slice(0, 160));
    }
    let active = true;
    void claimRef.current.then((result) => {
      if (!active) return;
      setPairingPending(false);
      if (!result.ok) {
        setError("This pairing QR is invalid, expired, revoked, or already used. Generate a new QR on the teacher PC.");
        return;
      }
      savePhoneCapability(window.sessionStorage, result.capability);
      setCapability(result.capability);
      setError("");
    });
    return () => { active = false; };
  }, [capability, configured, sessionId]);

  useEffect(() => {
    if (!sessionId || !assessmentId) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const restored = parseHeldScans(localStorage.getItem(outboxKey), sessionId, assessmentId);
        outboxRef.current = restored;
        setOutbox(restored);
      } catch {
        outboxRef.current = [];
        setOutbox([]);
      }
    });
    return () => { active = false; };
  }, [assessmentId, outboxKey, sessionId]);

  const linkOk = Boolean(configured && sessionId && capability && assessmentId);
  const canUseLiveCamera = useMemo(
    () => typeof window !== "undefined" && isSecureLike(window, window.location.hostname),
    [],
  );

  const releaseCamera = useCallback(() => {
    cameraRunRef.current += 1;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    trackEndedCleanupRef.current?.();
    trackEndedCleanupRef.current = null;
    if (streamRef.current) stopCameraStreamOnce(streamRef.current);
    streamRef.current = null;
    accumRef.current = null;
    stabilityRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStableCount(0);
    setTorchAvailable(false);
    setTorchOn(false);
  }, []);

  const closeCamera = useCallback(() => {
    const stoppedGeneration = lifecycleRef.current.stop();
    releaseCamera();
    lifecycleRef.current.stopped(stoppedGeneration);
  }, [releaseCamera]);

  // Toggle the camera flashlight (Android Chrome and other torch-capable
  // devices). Low light is the #1 real-world scan failure; this fixes it at
  // the source instead of trying to recover a dark frame in software.
  const applyTorch = useCallback(async (on: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorchOn(on);
    } catch {
      setTorchAvailable(false);
    }
  }, []);

  useEffect(() => {
    const galleryGeneration = galleryGenerationRef.current;
    return () => {
      galleryGeneration.cancel();
      closeCamera();
    };
  }, [closeCamera]);

  const grabFrame = useCallback((maximumMinorSide = FRAME_W): ImageData | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    // Cap the SMALLER side of the frame. Phones deliver landscape or portrait
    // buffers depending on device and orientation; capping the width alone
    // crushes a landscape frame's portrait sheet (and its QR) below what jsQR
    // can decode, which presents as "Find the sheet QR" forever.
    const scale = Math.min(1, maximumMinorSide / Math.min(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, []);

  // Worker-first frame analysis. QR decoding + OMR run off the main thread so
  // the camera preview and buttons never stutter; the pixel buffer is
  // TRANSFERRED (zero-copy). If workers are unavailable, error, or hang, we
  // permanently fall back to the identical pure pipeline on the main thread.
  const analyzeAsync = useCallback(
    (img: ImageData, qrText: string | null, thoroughQr: boolean): Promise<FrameAnalysis> => {
      if (workerFailedRef.current) {
        lastEngineRef.current = "fallback";
        return Promise.resolve(analyzeFrameData(img, assessmentId, qrText, thoroughQr));
      }
      lastEngineRef.current = "worker";
      try {
        if (!workerRef.current) {
          const w = new Worker(new URL("../lib/scanner/omr-frame-worker.ts", import.meta.url), { type: "module" });
          w.onmessage = (e: MessageEvent<FrameResponse>) => {
            const pending = workerPendingRef.current.get(e.data.id);
            workerPendingRef.current.delete(e.data.id);
            pending?.(e.data.analysis);
          };
          w.onerror = () => {
            workerFailedRef.current = true;
          };
          workerRef.current = w;
        }
        const worker = workerRef.current;
        const id = (workerReqIdRef.current += 1);
        return new Promise<FrameAnalysis>((resolve) => {
          const timer = setTimeout(() => {
            // Hung worker: drop this frame, use the sync path from now on.
            if (workerPendingRef.current.delete(id)) {
              workerFailedRef.current = true;
              resolve({
                result: { scan: null, status: "searching", qrVisible: false, markersVisible: false, brightness: 0, aligned: false, message: "Find the sheet QR" },
                qrText: null,
              });
            }
          }, WORKER_TIMEOUT_MS);
          workerPendingRef.current.set(id, (analysis) => {
            clearTimeout(timer);
            resolve(analysis);
          });
          const req: FrameRequest = {
            id,
            buffer: img.data.buffer as ArrayBuffer,
            width: img.width,
            height: img.height,
            assessmentId,
            qrText,
            thoroughQr,
          };
          worker.postMessage(req, [req.buffer]);
        });
      } catch {
        workerFailedRef.current = true;
        lastEngineRef.current = "fallback";
        return Promise.resolve(analyzeFrameData(img, assessmentId, qrText, thoroughQr));
      }
    },
    [assessmentId],
  );

  // Tear the worker down when the page unmounts.
  useEffect(() => {
    const pendingRequests = workerPendingRef.current;
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      pendingRequests.clear();
    };
  }, []);

  const sendHeld = useCallback(
    async (held: HeldScan): Promise<boolean> => {
      if (!capability) return false;
      const envelope = await buildPhoneSubmissionEnvelope({
        capability,
        sequenceNumber: held.sequenceNumber,
        issuedAt: new Date(held.issuedAt),
        scan: {
        scanId: held.scanId,
        sessionId: held.sessionId,
        assessmentId: held.assessmentId,
        learnerId: held.learnerId,
        version: held.version,
        answerMap: held.answerMap,
        detected: held.detected,
        confidence: held.confidence,
        capturedAt: held.capturedAt,
          deviceName: navigator.userAgent.slice(0, 160),
        },
      });
      const result = await submitPhoneScan(envelope);
      if (!result.ok) return false;
      replaceOutbox(acknowledgeHeldScan(outboxRef.current, held.scanId));
      if (!committedScanIdsRef.current.has(held.scanId)) {
        committedScanIdsRef.current.add(held.scanId);
        setSentCount((count) => count + 1);
      }
      if (pendingScanRef.current?.scanId === held.scanId) {
        setLastSent(held.learnerId);
        setSyncState("pc_received");
      }
      return true;
    },
    [capability, replaceOutbox],
  );

  const submitScan = useCallback(
    async (scan: CapturedMobileScan) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setPendingScan(scan);
      pendingScanRef.current = scan;
      setSyncState("pending");
      setError("");
      setLastScore(null);
      setLastReceiptId("");
      const answerMap: Record<string, string> = {};
      scan.detected.forEach((d) => { answerMap[String(d.item)] = d.answer; });
      const held: HeldScan = {
        scanId: scan.scanId,
        sessionId,
        assessmentId,
        learnerId: scan.learnerId,
        version: scan.version,
        answerMap,
        detected: scan.detected,
        confidence: scan.confidence,
        capturedAt: scan.capturedAt,
        sequenceNumber: capability ? nextPhoneSequence(window.sessionStorage, capability) : 0,
        issuedAt: new Date().toISOString(),
      };
      if (!capability || held.sequenceNumber < 1) {
        submittingRef.current = false;
        setSyncState("failed");
        setError("The secure phone capability is unavailable or expired. Generate a new pairing QR.");
        return;
      }
      // Persist before transport. The local copy remains until the database
      // returns the immutable inbox receipt for this exact message and digest.
      replaceOutbox(upsertHeldScan(outboxRef.current, held));
      let ok: boolean;
      try {
        ok = await sendHeld(held);
      } catch {
        ok = false;
      } finally {
        submittingRef.current = false;
      }
      if (!ok) {
        setSyncState("failed");
        setError("The secure inbox did not accept this scan. It remains queued while the active pairing can retry.");
        setStage("done");
        closeCamera();
        return;
      }
      setSyncState((previous) => previous === "scored" ? previous : "pc_received");
      setLastSent(scan.learnerId);
      setError("");
      setStage("done");
      closeCamera();
    },
    [assessmentId, capability, closeCamera, replaceOutbox, sendHeld, sessionId],
  );

  // Auto-retry the outbox every few seconds while anything is held. Successes
  // leave the queue; failures stay for the next tick. Also persisted to
  // localStorage so a page reload cannot lose captured scans.
  useEffect(() => {
    if (outbox.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || submittingRef.current || retryingRef.current) return;
      retryingRef.current = true;
      let transportAccepted = false;
      for (const held of outboxRef.current) {
        const ok = !cancelled && (await sendHeld(held));
        if (ok) {
          transportAccepted = true;
          if (pendingScanRef.current?.scanId === held.scanId) {
            setLastSent(held.learnerId);
          }
        }
      }
      retryingRef.current = false;
      if (cancelled) return;
      if (transportAccepted && pendingScanRef.current) {
        setSyncState((state) =>
          state === "saved" || state === "scored" ? state : "pc_received",
        );
      }
    };
    const t = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      retryingRef.current = false;
      clearInterval(t);
    };
  }, [outbox, sendHeld]);

  // Reconnect/status recovery always comes from the authoritative inbox row.
  // Exact polling is capability scoped; no transient channel payload is used.
  useEffect(() => {
    const scanId = pendingScan?.scanId;
    if (!capability || !scanId || syncState === "scored" || syncState === "failed") return;
    let cancelled = false;
    const poll = async () => {
      const status = await getPhoneSubmissionStatus(capability, scanId);
      if (cancelled || !status) {
        if (!cancelled && Date.now() >= capability.capabilityExpiresAtMs) {
          clearPhoneCapability(window.sessionStorage, capability.sessionId);
          setCapability(null);
          setSyncState("failed");
          setError("This secure pairing capability expired. The PC can still recover any inbox receipt already stored.");
        }
        return;
      }
      if (status.status === "received") {
        setSyncState("pc_received");
        return;
      }
      if (status.status === "rejected") {
        setSyncState("failed");
        setError(safePhoneError(status.rejectionCode));
        return;
      }
      if (status.resultReceiptId && status.score) {
        setLastReceiptId(status.resultReceiptId);
        setLastScore(status.score);
        setSyncState("scored");
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [capability, pendingScan?.scanId, syncState]);

  const handleStableScan = useCallback(
    (scan: MobileScan, captureSource: CapturedMobileScan["captureSource"] = "camera-final") => {
      const captured: CapturedMobileScan = {
        ...scan,
        scanId: generateScanId(),
        capturedAt: Date.now(),
        captureSource,
      };
      setPendingScan(captured);
      pendingScanRef.current = captured;
      setLastScore(null);
      setLastReceiptId("");
      closeCamera();
      // Phase 1 safety policy: no unattended auto-submit. Even a clean scan is
      // shown to the teacher before it can enter the durable sync workflow;
      // doubtful scans remain flagged for the PC Review queue.
      setStage("review");
    },
    [closeCamera],
  );

  const loop = useCallback(async () => {
    const runId = cameraRunRef.current;
    const runIsActive = () => runId === cameraRunRef.current && streamRef.current !== null;
    if (!runIsActive()) return;
    const now = Date.now();
    // Throttle heavy work so the main thread stays free for taps/scrolling.
    if (now - lastAnalyzeRef.current < ANALYZE_INTERVAL_MS) {
      if (runIsActive()) rafRef.current = requestAnimationFrame(() => void loopRef.current());
      return;
    }
    lastAnalyzeRef.current = now;

    const frame = grabFrame();
    if (frame && now >= cooldownUntilRef.current) {
      // Fast path first: the native BarcodeDetector (Android / iOS 17+) reads
      // the QR quickly off the main thread. Everything else — jsQR fallback,
      // marker search, homography, bubble sampling — runs in the Web Worker,
      // so the preview and buttons stay responsive on low-end phones.
      const nativeQr = canvasRef.current ? await readNativeQr(canvasRef.current) : null;
      if (!runIsActive()) return;
      const t0 = performance.now();
      // Identity must be decoded freshly on every counted frame. Reusing a QR
      // from a prior frame can bind the next physical sheet to the wrong learner.
      const analysis = await analyzeAsync(frame, nativeQr, false);
      if (!runIsActive()) return;
      setEngineInfo({ engine: lastEngineRef.current, ms: Math.round(performance.now() - t0) });
      const result = analysis.result;
      const genuineQr = analysis.qrText;
      setLastFrame(result);
      if (result.scan && genuineQr) {
        // Trusted layer: accumulate per-bubble darkness across aligned frames of
        // the same freshly identified, geometrically stable sheet.
        const scan = result.scan;
        const stability = advanceFrameStability(stabilityRef.current, {
          identity: genuineQr,
          geometry: scan.geometry,
          luminance: scan.frameBrightness,
          sharpness: scan.frameSharpness,
          sharpnessWidth: scan.frameWidth,
          observedAt: now,
          freshIdentity: true,
        }, CONSENSUS_FRAMES);
        stabilityRef.current = stability.state;
        if (stability.resetReason === "motion") {
          setLastFrame({ ...result, message: `Movement detected. Hold the sheet still for ${CONSENSUS_FRAMES} consecutive frames.` });
        } else if (stability.resetReason === "quality_changed") {
          setLastFrame({ ...result, message: `Focus or lighting changed. Keep the sheet still and clear for ${CONSENSUS_FRAMES} consecutive frames.` });
        } else if (stability.resetReason === "timeout") {
          setLastFrame({ ...result, message: `Frame analysis paused. Hold the same sheet still for ${CONSENSUS_FRAMES} new consecutive frames.` });
        }
        const key = genuineQr;
        const acc = accumRef.current;
        let active: FillAccum;
        if (!acc || acc.key !== key || stability.state?.consecutive === 1) {
          const fills = new Map<number, number[]>();
          const unreadableChoices = new Map<number, Set<number>>();
          scan.detected.forEach((d) => fills.set(d.item, (d.fill ?? []).slice()));
          scan.detected.forEach((d) => {
            unreadableChoices.set(d.item, new Set(d.unreadableChoices ?? []));
          });
          active = { key, n: 1, fills, unreadableChoices, base: scan };
        } else {
          scan.detected.forEach((d) => {
            const f = d.fill ?? [];
            const cur = acc.fills.get(d.item);
            if (cur) for (let i = 0; i < f.length; i += 1) cur[i] += f[i] ?? 0;
            else acc.fills.set(d.item, f.slice());
            const unreadable = acc.unreadableChoices.get(d.item) ?? new Set<number>();
            (d.unreadableChoices ?? []).forEach((choice) => unreadable.add(choice));
            acc.unreadableChoices.set(d.item, unreadable);
          });
          acc.n += 1;
          acc.base = scan;
          active = acc;
        }
        accumRef.current = active;
        setStableCount(stability.state?.consecutive ?? 0);
        if (stability.ready && active.n >= CONSENSUS_FRAMES) {
          const consensus = buildConsensusScan(active);
          const expectation = stability.state
            ? { identity: genuineQr, state: stability.state }
            : null;
          const finalFrame = grabFrame(FINAL_CAPTURE_W);
          const capturedAt = Date.now();
          if (!expectation || !finalFrame) {
            stabilityRef.current = null;
            accumRef.current = null;
            setStableCount(0);
            setLastFrame({
              ...result,
              scan: null,
              status: "final_capture_rejected",
              message: "The final still could not be captured. Hold the sheet still and try again.",
            });
            if (runIsActive()) {
              rafRef.current = requestAnimationFrame(() => void loopRef.current());
            }
            return;
          }
          // The exact high-resolution still entering review is independently
          // decoded and analyzed. Never reuse preview identity for this step.
          const finalNativeQr = canvasRef.current
            ? await readNativeQr(canvasRef.current)
            : null;
          if (!runIsActive()) return;
          const finalAnalysis = await analyzeAsync(finalFrame, finalNativeQr, true);
          if (!runIsActive()) return;
          const verified = verifyFinalMobileCapture(
            expectation,
            consensus,
            finalAnalysis,
            capturedAt,
          );
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
          accumRef.current = null;
          stabilityRef.current = null;
          setStableCount(0);
          if (!verified.ok) {
            setLastFrame({
              ...finalAnalysis.result,
              scan: null,
              status: "final_capture_rejected",
              message: verified.message,
            });
            if (runIsActive()) {
              rafRef.current = requestAnimationFrame(() => void loopRef.current());
            }
            return;
          }
          setLastFrame({
            ...finalAnalysis.result,
            scan: verified.scan,
            status: verified.scan.hasDoubt ? "review" : "ready",
            message: verified.evidenceDisagreed
              ? "Final still disagreed with preview evidence. Teacher review is required."
              : finalAnalysis.result.message,
          });
          handleStableScan(verified.scan);
          return;
        }
      } else {
        // Any lost QR, failed gate, or missing geometry breaks consecutiveness.
        // The next good frame starts at 1/N instead of bridging across motion.
        stabilityRef.current = null;
        accumRef.current = null;
        setStableCount(0);
      }
    }
    if (runIsActive()) rafRef.current = requestAnimationFrame(() => void loopRef.current());
  }, [analyzeAsync, grabFrame, handleStableScan]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  async function startLiveCamera(recovering = false) {
    if (!linkOk) return;
    galleryGenerationRef.current.cancel();
    const lifecycleGeneration = recovering
      ? lifecycleRef.current.recover()
      : lifecycleRef.current.request();
    if (lifecycleGeneration === null) return;
    setError("");
    setCameraMessage("");
    setLastFrame(null);
    if (!canUseLiveCamera || !navigator.mediaDevices?.getUserMedia) {
      lifecycleRef.current.fail(lifecycleGeneration, "start-failed");
      setCameraMessage("Live camera requires HTTPS and browser camera access. Take a photo or choose an existing image instead.");
      photoInputRef.current?.click();
      return;
    }
    releaseCamera();
    const runId = cameraRunRef.current;
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices
        .getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            // Ask generously: the sheet QR needs pixels. Capable cameras give
            // 1440p+; anything else settles on its best supported mode.
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        })
        .catch((err) => {
          if (err instanceof DOMException && (err.name === "OverconstrainedError" || err.name === "NotFoundError")) {
            return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
          throw err;
        });
      if (runId !== cameraRunRef.current) {
        stopCameraStreamOnce(stream);
        return;
      }
      if (!lifecycleRef.current.starting(lifecycleGeneration)) {
        stopCameraStreamOnce(stream);
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        lifecycleRef.current.fail(lifecycleGeneration, "start-failed");
        stopCameraStreamOnce(stream);
        streamRef.current = null;
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (runId !== cameraRunRef.current || !lifecycleRef.current.isCurrent(lifecycleGeneration)) {
        stopCameraStreamOnce(stream);
        return;
      }
      // Optional camera upgrades: continuous autofocus keeps a handheld sheet
      // sharp, and torch support unlocks the flashlight button in low light.
      // Both are best-effort — unsupported devices just skip them.
      try {
        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }) | undefined;
        setTorchAvailable(Boolean(caps?.torch));
        if (caps?.focusMode?.includes("continuous")) {
          await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
        }
      } catch {
        /* best-effort enhancements only */
      }
      if (!lifecycleRef.current.activate(lifecycleGeneration)) {
        releaseCamera();
        return;
      }
      const activeTrack = stream.getVideoTracks()[0];
      if (activeTrack) {
        const onEnded = () => {
          if (lifecycleRef.current.snapshot().state !== "ACTIVE") return;
          lifecycleRef.current.suspend("track-ended");
          releaseCamera();
          setStage("ready");
          if (document.visibilityState === "visible") {
            startCameraRef.current(true);
          }
        };
        activeTrack.addEventListener("ended", onEnded, { once: true });
        trackEndedCleanupRef.current = () => activeTrack.removeEventListener("ended", onEnded);
      }
      setStage("live");
      rafRef.current = requestAnimationFrame(() => loopRef.current());
    } catch (err) {
      if (lifecycleRef.current.isCurrent(lifecycleGeneration)) {
        lifecycleRef.current.fail(
          lifecycleGeneration,
          err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
            ? "permission-denied"
            : "start-failed",
        );
      }
      releaseCamera();
      const outcome = classifyMediaError(err, true);
      setCameraMessage(outcome.message);
    } finally {
      if (lifecycleRef.current.isCurrent(lifecycleGeneration)) setBusy(false);
    }
  }

  useEffect(() => {
    startCameraRef.current = (recovering = false) => { void startLiveCamera(recovering); };
  });

  useEffect(() => {
    const suspend = (outcome: Extract<CameraLifecycleOutcome, "page-hidden" | "focus-lost" | "device-change">) => {
      const state = lifecycleRef.current.snapshot().state;
      const canSuspend = outcome === "page-hidden"
        ? ["REQUESTING_PERMISSION", "STARTING", "ACTIVE"].includes(state)
        : state === "ACTIVE";
      if (!canSuspend) return;
      if (!lifecycleRef.current.suspend(outcome)) return;
      releaseCamera();
      setStage("ready");
    };
    const recover = () => {
      if (document.visibilityState !== "visible") return;
      startCameraRef.current(true);
    };
    const onVisibility = () => document.visibilityState === "hidden" ? suspend("page-hidden") : recover();
    const onBlur = () => suspend("focus-lost");
    const onFocus = () => recover();
    const onDeviceChange = () => {
      suspend("device-change");
      recover();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    };
  }, [releaseCamera]);

  async function readPhoto(file: File, captureSource: CapturedMobileScan["captureSource"]) {
    // Gallery/capture decoding owns the canvas until it completes. Invalidate
    // any in-flight live analysis first so the two paths cannot corrupt pixels.
    closeCamera();
    const request = galleryGenerationRef.current.begin();
    setStage("ready");
    setBusy(true);
    setError("");
    setLastScore(null);
    const canvas = canvasRef.current;
    if (!canvas) {
      setBusy(false);
      setError("[IMAGE_DECODE_FAILED] The image-processing canvas is unavailable.");
      return;
    }
    const ingested = await ingestGalleryImage(file, canvas, request.signal);
    if (!galleryGenerationRef.current.isCurrent(request.generation)) return;
    if (!ingested.ok) {
      setBusy(false);
      setError(`[${ingested.code}] ${ingested.message}`);
      return;
    }
    const analysisStartedAt = performance.now();
    const analysis = await analyzeAsync(ingested.image, null, true);
    if (import.meta.env.DEV) {
      console.info("[scanner-analysis]", {
        analysisDurationMs: Math.round((performance.now() - analysisStartedAt) * 100) / 100,
      });
    }
    if (!galleryGenerationRef.current.isCurrent(request.generation)) return;
    setLastFrame(analysis.result);
    setBusy(false);
    if (!analysis.result.scan) {
      setError(analysis.result.message);
      return;
    }
    handleStableScan(analysis.result.scan, captureSource);
  }

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>, captureSource: CapturedMobileScan["captureSource"]) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void readPhoto(file, captureSource);
  }

  function resetForNext() {
    setPendingScan(null);
    pendingScanRef.current = null;
    setLastScore(null);
    setLastReceiptId("");
    setError("");
    setSyncState("idle");
    setLastFrame(null);
    setStage("ready");
  }

  async function copyDiagnostic() {
    if (!pendingScan) return;
    const text = JSON.stringify(buildSafeScanDiagnostic(pendingScan, syncState), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setError("Diagnostic payload copied.");
    } catch {
      setError(text);
    }
  }

  const signal = makeSignals(lastFrame, stableCount);
  const confirmed = Boolean(
    pendingScan &&
    lastScore &&
    lastScore.scanId === pendingScan.scanId &&
    lastScore.learnerId === lastSent &&
    lastReceiptId &&
    lastScore.receiptId === lastReceiptId &&
    (syncState === "saved" || syncState === "scored"),
  );

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-950 p-3 text-white">
      <header className="mb-3 rounded-xl bg-indigo-700 px-4 py-3 text-white">
        <div className="text-lg font-extrabold">DALIguro Phone Scanner</div>
        {linkOk ? (
          <div className="text-xs opacity-90">
            Camera companion · PC dashboard is the system of record{assessmentId ? ` · ${assessmentId}` : ""}
          </div>
        ) : null}
      </header>

      {error ? (
        <div className={"mb-3 rounded-lg border p-2 text-sm " + (error.startsWith("{") ? "border-slate-500 bg-slate-900 text-slate-100" : "border-red-300 bg-red-50 text-red-700")}>
          {error}
        </div>
      ) : null}
      {cameraMessage ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">{cameraMessage}</div>
      ) : null}
      {outbox.length > 0 ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm font-bold text-amber-800">
          📤 {outbox.length} scan{outbox.length === 1 ? "" : "s"} held on this phone — auto-sending when the PC session is reachable.
          Keep SmartScan open on the computer. Held scans survive reloads.
        </div>
      ) : null}

      {!configured ? (
        <Info>Realtime sync is not enabled on this build. Ask your admin to configure Supabase.</Info>
      ) : pairingPending ? (
        <Info>Securely claiming this one-time pairing session…</Info>
      ) : !sessionId || !capability || !assessmentId ? (
        <Info>Invalid or expired secure pairing. Generate a new phone scanner QR on the PC.</Info>
      ) : (
        <>
          {(stage === "ready" || stage === "live") ? (
            <section className="rounded-xl border border-white/10 bg-white p-3 text-slate-950">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-extrabold">Live SmartScan</div>
                  <div className="text-xs text-slate-500">Averages {CONSENSUS_FRAMES} steady reads, then requires teacher confirmation before submission.</div>
                  {engineInfo ? (
                    <div className={"mt-0.5 text-[10px] font-bold " + (engineInfo.engine === "worker" ? "text-emerald-600" : "text-amber-600")}>
                      Engine: {engineInfo.engine === "worker" ? "worker ✓" : "main-thread fallback"} · {engineInfo.ms}ms/frame
                    </div>
                  ) : null}
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-extrabold text-emerald-700">
                  PC paired
                </span>
              </div>

              <div className="relative mt-3 overflow-hidden rounded-xl bg-black">
                <video ref={videoRef} playsInline muted autoPlay className="aspect-[3/4] w-full object-cover" />
                {stage !== "live" ? (
                  <div className="absolute inset-0 grid place-items-center px-8 text-center text-sm font-bold text-slate-300">
                    Start live camera or scan one photo.
                  </div>
                ) : null}
                {stage === "live" && torchAvailable ? (
                  <button
                    type="button"
                    onClick={() => void applyTorch(!torchOn)}
                    className={"absolute right-2 top-2 z-10 rounded-full px-3 py-2 text-base font-black " + (torchOn ? "bg-yellow-300 text-yellow-950" : "bg-black/60 text-white")}
                  >
                    {torchOn ? "🔦 On" : "💡 Light"}
                  </button>
                ) : null}
                <ScannerOverlay signals={signal} />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button onClick={() => void startLiveCamera()} disabled={busy || stage === "live"}>
                  {stage === "live" ? "Scanning…" : "Start live camera"}
                </Button>
                <Button variant="ghost" onClick={() => photoInputRef.current?.click()} disabled={busy}>
                  Take Photo
                </Button>
                <Button variant="ghost" onClick={() => galleryInputRef.current?.click()} disabled={busy}>
                  Choose Existing Image
                </Button>
                {stage === "live" ? (
                  <Button variant="smallDanger" onClick={() => { closeCamera(); setStage("ready"); }}>
                    Stop camera
                  </Button>
                ) : null}
                <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" capture="environment" hidden onChange={(event) => onPhoto(event, "manual-capture")} />
                <input ref={galleryInputRef} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={(event) => onPhoto(event, "gallery")} />
              </div>
              {lastFrame?.message ? (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700" role="status" aria-live="polite">
                  {lastFrame.message}
                </div>
              ) : null}
              {busy ? <div className="mt-2 text-center text-xs font-bold text-slate-500">Preparing camera…</div> : null}
              {sentCount > 0 ? (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
                  {sentCount} sheet{sentCount === 1 ? "" : "s"} submitted this session{lastSent ? ` · last: ${lastSent}` : ""}
                </div>
              ) : null}
            </section>
          ) : null}

          {stage === "review" && pendingScan ? (
            <section className="rounded-xl border border-amber-200 bg-white p-3 text-slate-950">
              <div className="text-sm font-extrabold">Confirm detected answers</div>
              <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-slate-600">
                <span>Learner: <b className="text-slate-900">{pendingScan.learnerId}</b></span>
                <span>Source: <b className="text-slate-900">{pendingScan.captureSource}</b></span>
                <span>Version: <b className="text-slate-900">{pendingScan.version || "—"}</b></span>
                <span>Assessment: <b className="text-slate-900">{assessmentId || "—"}</b></span>
                <span>Items: <b className="text-slate-900">{pendingScan.detected.length}/{pendingScan.totalItems}</b></span>
                <span>Confidence: <b className="text-slate-900">{Math.round(pendingScan.confidence * 100)}%</b></span>
                <span>Quality: <b className="text-slate-900">{pendingScan.quality.score}/100</b></span>
              </div>
              {pendingScan.reviewCount > 0 ? (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  ⚠ {pendingScan.reviewCount} item{pendingScan.reviewCount === 1 ? "" : "s"} need review (highlighted below). Check each before submitting.
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
                  All {pendingScan.totalItems} items read cleanly. Confirm to submit.
                </div>
              )}
              <MobileQuality scan={pendingScan} />
              <AnswerGrid detected={pendingScan.detected} />
              <div className="mt-3 grid gap-2">
                <Button onClick={() => void submitScan(pendingScan)} disabled={syncState === "pending"}>
                  {pendingScan.reviewCount > 0
                    ? `Send ${pendingScan.reviewCount} doubtful item(s) to PC Review`
                    : "Teacher confirm & submit"}
                </Button>
                <Button variant="ghost" onClick={resetForNext}>Scan again</Button>
              </div>
            </section>
          ) : null}

          {stage === "done" ? (
            <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-center text-slate-950">
              <div className="text-sm font-extrabold text-emerald-800">
                {syncState === "failed"
                  ? "Scan held for retry"
                  : syncState === "saved" || syncState === "scored"
                    ? "Saved with receipt"
                    : "Waiting for durable receipt"}
                {lastSent ? ` · ${lastSent}` : ""}
              </div>
              {pendingScan ? <MobileQuality scan={pendingScan} /> : null}
              <SyncTimeline state={syncState} />
              {confirmed ? (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-white p-3 text-left">
                  <div className="mb-2 rounded bg-emerald-50 px-2 py-1 text-center text-[11px] font-extrabold text-emerald-800">
                    PC confirmed durable save{lastReceiptId ? ` · receipt ${lastReceiptId}` : ""}. Dashboard, Reports, and Analysis updated.
                  </div>
                  <div className="flex items-end justify-between">
                    <span className="text-xs font-bold text-slate-500">Score</span>
                    <span className="text-3xl font-black leading-none text-indigo-700">{lastScore!.raw}/{lastScore!.total}</span>
                  </div>
                  <div className="mt-0.5 text-right text-lg font-extrabold" style={{ color: lastScore!.pct >= 75 ? "#15803d" : "#b45309" }}>
                    {lastScore!.pct}% · {lastScore!.pct >= 75 ? "Passed" : "Below target"}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
                    <MiniScore label="correct" value={lastScore!.correct} cls="text-emerald-700" />
                    <MiniScore label="wrong" value={lastScore!.wrong} cls="text-red-700" />
                    <MiniScore label="blank" value={lastScore!.blank} cls="text-slate-700" />
                  </div>
                  <div className="mt-1.5 text-center text-xs font-bold text-slate-600">{lastScore!.mastery}</div>
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-amber-200 bg-white p-3 text-xs text-amber-800">
                  Keep the SmartScan tab open on the computer until confirmation appears.
                  The scan is held here until you scan next.
                </div>
              )}
              <div className="mt-3 grid gap-2">
                {pendingScan && !confirmed ? (
                  <Button onClick={() => void submitScan(pendingScan)} disabled={syncState === "pending"}>
                    Retry submit to PC
                  </Button>
                ) : null}
                {pendingScan ? <Button variant="ghost" onClick={() => void copyDiagnostic()}>Copy diagnostic payload</Button> : null}
                <Button onClick={resetForNext} disabled={!confirmed && syncState !== "failed"}>
                  Scan next sheet
                </Button>
              </div>
            </section>
          ) : null}
        </>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

function makeSignals(frame: FrameResult | null, stableCount: number) {
  const lightTone: SignalTone = !frame
    ? "bad"
    : frame.brightness > 245 || frame.brightness < 55
      ? "bad"
      : frame.brightness < 70
        ? "warn"
        : "good";
  return [
    { label: "QR", text: frame?.qrVisible ? "visible" : "searching", tone: frame?.qrVisible ? "good" : "bad" },
    { label: "Targets", text: frame?.markersVisible ? "4 found" : "align sheet", tone: frame?.markersVisible ? "good" : "bad" },
    { label: "Light", text: frame ? String(frame.brightness) : "waiting", tone: lightTone },
    { label: "Hold", text: `${Math.min(stableCount, CONSENSUS_FRAMES)}/${CONSENSUS_FRAMES}`, tone: stableCount >= CONSENSUS_FRAMES ? "good" : stableCount > 0 ? "warn" : "bad" },
  ] as { label: string; text: string; tone: SignalTone }[];
}

function ScannerOverlay({ signals }: { signals: { label: string; text: string; tone: SignalTone }[] }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-8 top-[14%] bottom-[12%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]">
        <Corner cls="left-0 top-0 rounded-tl-2xl border-l-4 border-t-4" />
        <Corner cls="right-0 top-0 rounded-tr-2xl border-r-4 border-t-4" />
        <Corner cls="bottom-0 left-0 rounded-bl-2xl border-b-4 border-l-4" />
        <Corner cls="bottom-0 right-0 rounded-br-2xl border-b-4 border-r-4" />
      </div>
      <div className="absolute inset-x-3 bottom-3 grid grid-cols-4 gap-1">
        {signals.map((s) => (
          <div key={s.label} className={"rounded-lg px-2 py-1 text-center text-[10px] font-black " + signalCls(s.tone)}>
            <div>{s.label}</div>
            <div className="font-semibold">{s.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Corner({ cls }: { cls: string }) {
  return <div className={"absolute h-12 w-12 border-yellow-300 " + cls} />;
}

function signalCls(tone: SignalTone): string {
  if (tone === "good") return "bg-emerald-400 text-emerald-950";
  if (tone === "warn") return "bg-amber-300 text-amber-950";
  return "bg-white/85 text-slate-800";
}

function AnswerGrid({ detected }: { detected: ScanDetection[] }) {
  return (
    <div className="mt-2 grid max-h-72 grid-cols-2 gap-1 overflow-y-auto text-xs">
      {detected.map((d) => {
        const { label, review } = statusLabel(d.status, d.confidence);
        const affected = (d.unreadableChoices ?? []).map((index) => CHOICES[index] ?? `#${index + 1}`);
        const detail = affected.length > 0 ? `${label}: ${affected.join(", ")}` : label;
        return (
          <div key={d.item} className={"flex items-center justify-between gap-1 rounded border px-2 py-1 " +
            (review ? "border-amber-400 bg-amber-50" : "border-slate-200")}>
            <span className="w-6 font-bold">{d.item}</span>
            <span className="w-4 text-center font-extrabold">{d.answer || "–"}</span>
            <span className={"flex-1 truncate text-right text-[10px] font-semibold " + (review ? "text-amber-700" : "text-slate-400")}>
              {detail}
            </span>
            <span className="w-8 text-right text-slate-400">{Math.round(d.confidence * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function MobileQuality({ scan }: { scan: MobileScan }) {
  const cls =
    scan.quality.score >= 74
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : scan.quality.score >= 55
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-red-200 bg-red-50 text-red-700";
  return (
    <div className={"mt-2 rounded-lg border px-3 py-2 text-left text-xs " + cls}>
      <div className="flex items-center justify-between font-extrabold">
        <span>Capture Quality: {scan.quality.label}</span>
        <span>{scan.quality.score}/100</span>
      </div>
      <div className="mt-1 font-semibold">
        {scan.quality.issues.length > 0 ? scan.quality.issues.join(" · ") : "Clean QR, targets, focus, and marks."}
      </div>
    </div>
  );
}

function SyncTimeline({ state }: { state: SyncState }) {
  const steps: { key: SyncState; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "sent", label: "Sent" },
    { key: "pc_received", label: "PC received" },
    { key: "saved", label: "Saved" },
    { key: "scored", label: "Scored" },
  ];
  const activeIndex = state === "failed" ? -1 : Math.max(0, steps.findIndex((s) => s.key === state));
  return (
    <div className="mt-3 grid grid-cols-5 gap-1 text-[10px] font-bold">
      {steps.map((s, i) => (
        <div key={s.key} className={(i <= activeIndex ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500") + " rounded px-1 py-1"}>
          {s.label}
        </div>
      ))}
    </div>
  );
}

function MiniScore({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded bg-slate-50 py-1">
      <b className={cls}>{value}</b>
      <div className="text-slate-500">{label}</div>
    </div>
  );
}

function Info({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">{children}</div>;
}
