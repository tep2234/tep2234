// Camera-scanner phase — "Connect Camera Scanner" panel for the Check tab.
// Reads the live camera, decodes a QR, validates it, and hands the resulting
// payload up to the caller. It never touches results, scores, or keys.

import { useEffect, useRef, useState } from "react";
import type { Learner } from "../../lib/types";
import { validateQrPayload, type QrValidationResult } from "../../lib/scanner/qr-payload";
import {
  cameraErrorMessage,
  isCameraScanSupported,
} from "../../lib/scanner/camera-support";
import { startQrCamera, type QrCameraHandle } from "../../lib/scanner/qr-camera";
import { Button } from "../ui";

type ScanStatus = "idle" | "requesting" | "scanning" | "error";

export function CameraQrScanner({
  activeAssessmentId,
  learners,
  onValidScan,
}: {
  activeAssessmentId: string;
  learners: Learner[];
  onValidScan: (result: Extract<QrValidationResult, { ok: true }>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleRef = useRef<QrCameraHandle | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [message, setMessage] = useState<string>("");
  const [lastLearnerName, setLastLearnerName] = useState<string>("");
  const [lastVersion, setLastVersion] = useState<string>("");

  const supported = isCameraScanSupported();

  function stopCamera() {
    handleRef.current?.stop();
    handleRef.current = null;
    setStatus("idle");
  }

  useEffect(() => () => handleRef.current?.stop(), []);

  async function connect() {
    if (!supported) {
      setStatus("error");
      setMessage(
        "Camera scanning is not supported in this browser. Use QR payload paste or manual selection.",
      );
      return;
    }
    setStatus("requesting");
    setMessage("Requesting camera permission…");
    const video = videoRef.current;
    if (!video) return;
    try {
      handleRef.current = await startQrCamera({
        video,
        onDetected: (text) => {
          const result = validateQrPayload(text, {
            activeAssessmentId,
            learners,
          });
          if (!result.ok) {
            setStatus("error");
            setMessage(result.error);
            return;
          }
          const learner = learners.find((l) => l.id === result.payload.learnerId);
          setLastLearnerName(learner?.fullName ?? "");
          setLastVersion(result.payload.version);
          setStatus("idle");
          setMessage(
            "QR scanned successfully. Learner selected: " +
              (learner?.fullName ?? "?") +
              ". Version: " +
              result.payload.version +
              ". You may now check answers.",
          );
          onValidScan(result);
        },
        onError: (err) => {
          setStatus("error");
          setMessage(cameraErrorMessage(err));
        },
      });
      setStatus("scanning");
      setMessage("Point the camera at the QR code on the answer sheet.");
    } catch (err) {
      setStatus("error");
      setMessage(cameraErrorMessage(err));
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "scanning" ? (
          <Button variant="ghost" onClick={stopCamera}>
            Stop Camera
          </Button>
        ) : (
          <Button onClick={connect} disabled={status === "requesting"}>
            📷 Connect Camera Scanner
          </Button>
        )}
        <span className="text-xs font-bold text-slate-500">
          status: {status}
        </span>
        {!supported ? (
          <span className="text-xs font-bold text-amber-600">
            not supported in this browser
          </span>
        ) : null}
      </div>

      <div
        className={
          "mt-2 overflow-hidden rounded-lg bg-black " +
          (status === "scanning" ? "block" : "hidden")
        }
      >
        <video ref={videoRef} className="h-56 w-full object-cover" muted />
      </div>

      {message ? (
        <div
          className={
            "mt-2 rounded-lg p-2 text-xs font-semibold " +
            (status === "error"
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-700")
          }
        >
          {message}
        </div>
      ) : null}

      {(lastLearnerName || lastVersion) && (
        <div className="mt-1 text-xs text-slate-500">
          last scanned learner: {lastLearnerName || "—"} · version:{" "}
          {lastVersion || "—"}
        </div>
      )}

      <p className="mt-2 text-xs text-slate-500">
        Point the camera at the QR code on the answer sheet. The QR identifies
        the learner and assessment only. It does not contain the answer key.
      </p>
    </div>
  );
}
