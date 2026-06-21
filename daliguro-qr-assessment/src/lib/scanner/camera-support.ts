// Camera-scanner phase — capability detection and teacher-friendly error text.
// Kept separate from qr-camera.ts so capability checks stay testable without
// touching live media APIs.

export type CameraErrorKind =
  | "permission-denied"
  | "no-camera"
  | "unsupported"
  | "unknown";

export const CAMERA_ERROR_MESSAGES: Record<CameraErrorKind, string> = {
  "permission-denied": "Camera permission was denied.",
  "no-camera": "No camera was detected.",
  unsupported:
    "Camera scanning is not supported in this browser. Use QR payload paste or manual selection.",
  unknown: "Camera could not be started. Use QR payload paste or manual selection.",
};

export function hasMediaDevices(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

export function hasBarcodeDetector(): boolean {
  return typeof (globalThis as Record<string, unknown>).BarcodeDetector !== "undefined";
}

export function isCameraScanSupported(): boolean {
  return hasMediaDevices();
}

// Map a getUserMedia() rejection (DOMException-like) to a scan-mode error kind.
export function classifyCameraError(err: unknown): CameraErrorKind {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "permission-denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "no-camera";
  }
  if (!hasMediaDevices()) return "unsupported";
  return "unknown";
}

export function cameraErrorMessage(err: unknown): string {
  return CAMERA_ERROR_MESSAGES[classifyCameraError(err)];
}
