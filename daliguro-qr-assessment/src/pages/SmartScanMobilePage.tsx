// Phone scanner page (deep-linked from the PC pairing QR):
//   /smartscan/mobile/:sessionId?t=RAW_TOKEN&a=ASSESSMENT_ID
// The phone is intentionally NOT a second dashboard. It is a temporary camera
// companion. The signed-in PC remains the system of record: it verifies the
// pairing token, writes the scan, scores against the local answer key, then
// broadcasts the score back to this phone.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { classifyMediaError, isSecureLike } from "../lib/camera";
import { isSupabaseConfigured } from "../lib/supabase/client";
import { decodeQrPayload } from "../lib/qr-parse";
import { assessmentMatches, type ScanDetection, type ScoreBroadcast } from "../lib/sync/pairing";
import { joinScanChannel, type ScanChannel } from "../lib/sync/realtimeSmartScan";
import { buildTemplate } from "../lib/scanner/omr-template";
import { findCornerMarkers, readSheet, toGray, type SheetReading } from "../lib/scanner/omr-detect";
import { readQrSmart } from "../lib/scanner/qr-detect";
import { REVIEW_CONFIDENCE } from "../lib/scanner/omr-score";
import { scanQuality, type ScanQuality } from "../lib/scanner/scan-quality";
import { Button } from "../components/ui";

type Flow = "ready" | "live" | "review" | "done";
type SyncState = "idle" | "pending" | "sent" | "pc_received" | "saved" | "scored" | "failed";
type SignalTone = "good" | "warn" | "bad";

interface MobileScan {
  learnerId: string;
  version: string;
  detected: ScanDetection[];
  confidence: number;
  quality: ScanQuality;
  hasDoubt: boolean;
  signature: string;
}

interface FrameResult {
  scan: MobileScan | null;
  status: string;
  qrVisible: boolean;
  markersVisible: boolean;
  brightness: number;
  aligned: boolean;
  message: string;
}

interface StableCandidate {
  signature: string;
  count: number;
  scan: MobileScan;
}

const AUTO_ACCEPT = 0.8;
const STABLE_FRAMES = 2;
const FRAME_W = 1300;
const COOLDOWN_MS = 2500;

function avgConfidence(data: ScanDetection[]): number {
  return data.length ? data.reduce((s, d) => s + d.confidence, 0) / data.length : 0;
}

function scanSignature(lId: string, ver: string, data: ScanDetection[]): string {
  return lId + "|" + ver + "|" + data.map((d) => d.item + ":" + d.answer + ":" + d.status).join(",");
}

function quickBrightness(data: Uint8ClampedArray | number[]): number {
  let sum = 0;
  let n = 0;
  const step = Math.max(4, Math.floor(data.length / 36000) * 4);
  for (let i = 0; i < data.length; i += step) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    n += 1;
  }
  return n ? Math.round(sum / n) : 255;
}

function readingShadowLevel(reading: SheetReading): number {
  const values = reading.items.flatMap((item) => item.fill).filter((n) => Number.isFinite(n));
  if (values.length === 0) return 100;
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  const variance = values.reduce((sum, n) => sum + (n - mean) * (n - mean), 0) / values.length;
  return Math.round(Math.max(0, Math.min(100, Math.sqrt(variance) * 180)));
}

function readingTiltAngle(reading: SheetReading): number {
  const corners = reading.corners;
  if (!corners || corners.length < 2) return 45;
  const [tl, tr] = corners;
  return Math.abs(Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180 / Math.PI);
}

function readingBubbleDarkness(reading: SheetReading): number {
  const maxes = reading.items.map((item) => Math.max(...item.fill, 0));
  return maxes.length ? maxes.reduce((sum, value) => sum + value, 0) / maxes.length : 0;
}

function analyzeDecodedFrame(img: ImageData, assessmentId: string, qrText: string): FrameResult {
  const brightness = quickBrightness(img.data);
  const decoded = decodeQrPayload(qrText);
  if (!decoded.ok) {
    return { scan: null, status: "qr_error", qrVisible: true, markersVisible: false, brightness, aligned: false, message: decoded.reason };
  }
  if (assessmentId && !assessmentMatches(assessmentId, decoded.payload.assessmentId)) {
    return { scan: null, status: "wrong_assessment", qrVisible: true, markersVisible: false, brightness, aligned: false, message: "Wrong assessment sheet" };
  }
  const gray = toGray(img);
  const markersVisible = findCornerMarkers(gray) !== null;
  const template = buildTemplate(Math.max(1, decoded.payload.n || 1));
  const reading: SheetReading = readSheet(gray, template);
  if (!reading.aligned) {
    return { scan: null, status: "markers", qrVisible: true, markersVisible, brightness, aligned: false, message: "Show all 4 corner targets" };
  }
  const detected: ScanDetection[] = reading.items.map((r) => ({
    item: r.item,
    answer: r.detected ?? "",
    status: r.status,
    confidence: r.confidence,
    fill: r.fill,
  }));
  const confidence = avgConfidence(detected);
  const hasDoubt = detected.some(
    (d) => d.status === "unclear" || d.status === "multiple" || (d.status === "selected" && d.confidence < REVIEW_CONFIDENCE),
  );
  const doubtfulItems = detected.filter(
    (d) => d.status === "unclear" || d.status === "multiple" || (d.status === "selected" && d.confidence < REVIEW_CONFIDENCE),
  ).length;
  const quality = scanQuality({
    confidence,
    brightness: reading.brightness,
    sharpness: reading.sharpness,
    aligned: reading.aligned,
    doubtfulItems,
    shadowLevel: readingShadowLevel(reading),
    tiltAngle: readingTiltAngle(reading),
    bubbleDarkness: readingBubbleDarkness(reading),
  });
  const scan: MobileScan = {
    learnerId: decoded.payload.learnerId,
    version: decoded.payload.version,
    detected,
    confidence,
    quality,
    hasDoubt,
    signature: scanSignature(decoded.payload.learnerId, decoded.payload.version, detected),
  };
  return {
    scan,
    status: hasDoubt || confidence < AUTO_ACCEPT ? "review" : "ready",
    qrVisible: true,
    markersVisible: true,
    brightness,
    aligned: true,
    message: hasDoubt ? "Needs confirmation" : "Hold steady",
  };
}

function analyzeFrame(img: ImageData, assessmentId: string): FrameResult {
  const brightness = quickBrightness(img.data);
  const qr = readQrSmart(img, true);
  if (!qr) {
    return { scan: null, status: "searching", qrVisible: false, markersVisible: false, brightness, aligned: false, message: "Find the sheet QR" };
  }
  return analyzeDecodedFrame(img, assessmentId, qr.data);
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
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const assessmentId = params.get("a") ?? "";
  const configured = isSupabaseConfigured();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const loopRef = useRef<() => void>(() => {});
  const channelRef = useRef<ScanChannel | null>(null);
  const stableRef = useRef<StableCandidate | null>(null);
  const cooldownUntilRef = useRef(0);
  const submittingRef = useRef(false);

  const [stage, setStage] = useState<Flow>("ready");
  const [error, setError] = useState("");
  const [cameraMessage, setCameraMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastFrame, setLastFrame] = useState<FrameResult | null>(null);
  const [stableCount, setStableCount] = useState(0);
  const [pendingScan, setPendingScan] = useState<MobileScan | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [sentCount, setSentCount] = useState(0);
  const [lastSent, setLastSent] = useState("");
  const [lastScore, setLastScore] = useState<ScoreBroadcast | null>(null);

  const linkOk = Boolean(configured && sessionId && token);
  const canUseLiveCamera = useMemo(
    () => typeof window !== "undefined" && isSecureLike(window, window.location.hostname),
    [],
  );

  const closeCamera = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!linkOk) return;
    const ch = joinScanChannel(sessionId, {
      onAck: (ack) => {
        if (ack.token !== token) return;
        setLastSent(ack.learnerId);
        setSyncState((prev) => {
          if (prev === "scored") return prev;
          return ack.status;
        });
      },
      onScore: (s) => {
        if (s.token !== token) return;
        setLastScore(s);
        setSyncState("scored");
      },
    });
    channelRef.current = ch;
    const device = navigator.userAgent.slice(0, 60);
    const hello = () => ch.sendHello(device, token);
    hello();
    const t1 = setTimeout(hello, 1200);
    const t2 = setTimeout(hello, 3000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ch.close();
      channelRef.current = null;
    };
  }, [linkOk, sessionId, token]);

  useEffect(() => closeCamera, [closeCamera]);

  const grabFrame = useCallback((): ImageData | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, FRAME_W / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, []);

  const submitScan = useCallback(
    async (scan: MobileScan) => {
      if (submittingRef.current) return;
      const ch = channelRef.current;
      if (!ch) {
        setPendingScan(scan);
        setSyncState("failed");
        setError("Not connected to the PC. Keep SmartScan open on the computer, then retry submit.");
        return;
      }
      submittingRef.current = true;
      setPendingScan(scan);
      setSyncState("pending");
      setError("");
      setLastScore(null);
      const answerMap: Record<string, string> = {};
      scan.detected.forEach((d) => { answerMap[String(d.item)] = d.answer; });
      const ok = await ch.sendScan({
        token,
        learnerId: scan.learnerId,
        version: scan.version,
        answerMap,
        detected: scan.detected,
        confidence: scan.confidence,
        deviceName: navigator.userAgent.slice(0, 60),
      });
      submittingRef.current = false;
      if (!ok) {
        setSyncState("failed");
        setError("Submit failed before reaching the PC. The scan is held here; retry when the PC session is open.");
        setStage("done");
        return;
      }
      setSyncState("sent");
      setSentCount((c) => c + 1);
      setLastSent(scan.learnerId);
      setStage("done");
      closeCamera();
    },
    [closeCamera, token],
  );

  const handleStableScan = useCallback(
    (scan: MobileScan) => {
      setPendingScan(scan);
      setLastScore(null);
      closeCamera();
      if (scan.confidence >= AUTO_ACCEPT && !scan.hasDoubt) {
        void submitScan(scan);
      } else {
        setStage("review");
      }
    },
    [closeCamera, submitScan],
  );

  const loop = useCallback(() => {
    const frame = grabFrame();
    if (frame && Date.now() >= cooldownUntilRef.current) {
      const result = analyzeFrame(frame, assessmentId);
      setLastFrame(result);
      if (result.scan) {
        const prev = stableRef.current;
        const nextCount = prev?.signature === result.scan.signature ? prev.count + 1 : 1;
        stableRef.current = { signature: result.scan.signature, count: nextCount, scan: result.scan };
        setStableCount(nextCount);
        if (nextCount >= STABLE_FRAMES) {
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
          stableRef.current = null;
          setStableCount(0);
          handleStableScan(result.scan);
          return;
        }
      } else {
        stableRef.current = null;
        setStableCount(0);
      }
    }
    rafRef.current = requestAnimationFrame(() => loopRef.current());
  }, [assessmentId, grabFrame, handleStableScan]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  async function startLiveCamera() {
    if (!linkOk) return;
    setError("");
    setCameraMessage("");
    setLastFrame(null);
    if (!canUseLiveCamera || !navigator.mediaDevices?.getUserMedia) {
      setCameraMessage("Live camera requires HTTPS and browser camera access. Use Scan photo as fallback.");
      fileRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices
        .getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        .catch((err) => {
          if (err instanceof DOMException && (err.name === "OverconstrainedError" || err.name === "NotFoundError")) {
            return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
          throw err;
        });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setStage("live");
      rafRef.current = requestAnimationFrame(() => loopRef.current());
    } catch (err) {
      const outcome = classifyMediaError(err, true);
      setCameraMessage(outcome.message);
    } finally {
      setBusy(false);
    }
  }

  function readPhoto(file: File) {
    setBusy(true);
    setError("");
    setLastScore(null);
    const im = new Image();
    im.onload = async () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !ctx) {
        setBusy(false);
        return;
      }
      const decodeAt = async (maxW: number) => {
        const scale = Math.min(1, maxW / im.naturalWidth);
        canvas.width = Math.round(im.naturalWidth * scale);
        canvas.height = Math.round(im.naturalHeight * scale);
        ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const nativeQr = await readNativeQr(canvas);
        if (nativeQr) return analyzeDecodedFrame(img, assessmentId, nativeQr);
        return analyzeFrame(img, assessmentId);
      };
      let result = await decodeAt(3200);
      for (const maxW of [2600, 2000, 1600, 1100]) {
        if (result.scan || result.status !== "searching") break;
        result = await decodeAt(maxW);
      }
      URL.revokeObjectURL(im.src);
      setLastFrame(result);
      setBusy(false);
      if (!result.scan) {
        setError(result.message);
        return;
      }
      handleStableScan(result.scan);
    };
    im.onerror = () => {
      setBusy(false);
      setError("Could not open that photo.");
    };
    im.src = URL.createObjectURL(file);
  }

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) readPhoto(file);
  }

  function resetForNext() {
    setPendingScan(null);
    setLastScore(null);
    setError("");
    setSyncState("idle");
    setLastFrame(null);
    setStage("ready");
  }

  async function copyDiagnostic() {
    if (!pendingScan) return;
    const text = JSON.stringify({ assessmentId, sessionId, syncState, scan: pendingScan }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setError("Diagnostic payload copied.");
    } catch {
      setError(text);
    }
  }

  const signal = makeSignals(lastFrame, stableCount);
  const confirmed = Boolean(lastScore && lastScore.learnerId === lastSent);

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

      {!configured ? (
        <Info>Realtime sync is not enabled on this build. Ask your admin to configure Supabase.</Info>
      ) : !sessionId || !token ? (
        <Info>Invalid pairing link. On the PC, open SmartScan, generate a phone scanner QR, then scan it again.</Info>
      ) : (
        <>
          {(stage === "ready" || stage === "live") ? (
            <section className="rounded-xl border border-white/10 bg-white p-3 text-slate-950">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-extrabold">Live SmartScan</div>
                  <div className="text-xs text-slate-500">Auto-submits clean sheets after {STABLE_FRAMES} matching reads.</div>
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
                <ScannerOverlay signals={signal} />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button onClick={() => void startLiveCamera()} disabled={busy || stage === "live"}>
                  {stage === "live" ? "Scanning…" : "Start live camera"}
                </Button>
                <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                  Scan photo
                </Button>
                {stage === "live" ? (
                  <Button variant="smallDanger" onClick={() => { closeCamera(); setStage("ready"); }}>
                    Stop camera
                  </Button>
                ) : null}
                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
              </div>
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
              <p className="text-xs text-slate-500">
                Learner {pendingScan.learnerId} · trust {Math.round(pendingScan.confidence * 100)}% · quality {pendingScan.quality.score}/100.
                Confirm to submit into the open PC dashboard.
              </p>
              <MobileQuality scan={pendingScan} />
              <AnswerGrid detected={pendingScan.detected} />
              <div className="mt-3 grid gap-2">
                <Button onClick={() => void submitScan(pendingScan)} disabled={syncState === "pending"}>
                  Confirm & submit
                </Button>
                <Button variant="ghost" onClick={resetForNext}>Scan again</Button>
              </div>
            </section>
          ) : null}

          {stage === "done" ? (
            <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-center text-slate-950">
              <div className="text-sm font-extrabold text-emerald-800">
                {syncState === "failed" ? "Scan held for retry" : "Submitted to PC"}
                {lastSent ? ` · ${lastSent}` : ""}
              </div>
              {pendingScan ? <MobileQuality scan={pendingScan} /> : null}
              <SyncTimeline state={syncState} />
              {confirmed ? (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-white p-3 text-left">
                  <div className="mb-2 rounded bg-emerald-50 px-2 py-1 text-center text-[11px] font-extrabold text-emerald-800">
                    PC confirmed. Dashboard, Reports, and Analysis updated.
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
  return [
    { label: "QR", text: frame?.qrVisible ? "visible" : "searching", tone: frame?.qrVisible ? "good" : "bad" },
    { label: "Targets", text: frame?.markersVisible ? "4 found" : "align sheet", tone: frame?.markersVisible ? "good" : "bad" },
    { label: "Light", text: frame ? String(frame.brightness) : "waiting", tone: frame && frame.brightness >= 75 ? "good" : frame && frame.brightness >= 55 ? "warn" : "bad" },
    { label: "Hold", text: `${Math.min(stableCount, STABLE_FRAMES)}/${STABLE_FRAMES}`, tone: stableCount >= STABLE_FRAMES ? "good" : stableCount > 0 ? "warn" : "bad" },
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
    <div className="mt-2 grid max-h-64 grid-cols-2 gap-1 overflow-y-auto text-xs">
      {detected.map((d) => (
        <div key={d.item} className={"flex items-center justify-between rounded border px-2 py-1 " +
          (d.status === "unclear" || d.status === "multiple" ? "border-amber-300 bg-amber-50" : "border-slate-200")}>
          <span className="font-bold">{d.item}</span>
          <span>{d.answer || "-"}</span>
          <span className="text-slate-400">{Math.round(d.confidence * 100)}%</span>
        </div>
      ))}
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
