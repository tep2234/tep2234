// Camera-scanner phase — live QR decode loop.
// Isolated from React: hands back a stop() handle. Not unit-tested (no real
// camera in the test environment) — see qr-payload.test.ts for the logic that
// actually matters (payload validation).

import jsQR from "jsqr";
import { hasBarcodeDetector } from "./camera-support";

export interface QrCameraHandle {
  stop: () => void;
}

export interface StartQrCameraOptions {
  video: HTMLVideoElement;
  onDetected: (text: string) => void;
  onError: (err: unknown) => void;
}

interface MinimalBarcodeDetector {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
}

export async function startQrCamera(
  opts: StartQrCameraOptions,
): Promise<QrCameraHandle> {
  const { video, onDetected, onError } = opts;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });

  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  await video.play();

  let stopped = false;
  let rafId = 0;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  if (hasBarcodeDetector()) {
    const Detector = (
      globalThis as unknown as {
        BarcodeDetector: new (opts: { formats: string[] }) => MinimalBarcodeDetector;
      }
    ).BarcodeDetector;
    const detector = new Detector({ formats: ["qr_code"] });

    const tick = () => {
      if (stopped) return;
      detector
        .detect(video)
        .then((codes) => {
          if (stopped) return;
          if (codes.length > 0) {
            onDetected(codes[0].rawValue);
            stop();
            return;
          }
          rafId = requestAnimationFrame(tick);
        })
        .catch((err) => {
          if (stopped) return;
          onError(err);
        });
    };
    rafId = requestAnimationFrame(tick);
    return { stop };
  }

  // Fallback: capture frames to a canvas and decode with jsQR.
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    stop();
    onError(new Error("Canvas 2D context unavailable."));
    return { stop };
  }

  const tick = () => {
    if (stopped) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(frame.data, frame.width, frame.height);
      if (code) {
        onDetected(code.data);
        stop();
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return { stop };
}
