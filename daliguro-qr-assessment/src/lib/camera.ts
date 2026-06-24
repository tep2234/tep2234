// Camera startup state machine + diagnostics (pure, framework-free, testable).
// The React component drives these transitions; all the "why did it fail"
// reasoning lives here so it can be unit-tested without a browser.

export type CameraState =
  | "IDLE"
  | "CHECKING"
  | "REQUESTING_PERMISSION"
  | "STARTING_STREAM"
  | "READY"
  | "SCANNING"
  | "PAUSED"
  | "PERMISSION_DENIED"
  | "PERMISSION_DISMISSED"
  | "INSECURE_CONTEXT"
  | "NO_CAMERA"
  | "CAMERA_BUSY"
  | "CONSTRAINT_FAILED"
  | "PLAYBACK_FAILED"
  | "UNSUPPORTED_BROWSER"
  | "ERROR";

export type StateKind = "idle" | "progress" | "active" | "error";

export interface StateMeta {
  label: string;
  kind: StateKind;
}

export const STATE_META: Record<CameraState, StateMeta> = {
  IDLE: { label: "Not connected", kind: "idle" },
  CHECKING: { label: "Checking environment…", kind: "progress" },
  REQUESTING_PERMISSION: { label: "Allow camera…", kind: "progress" },
  STARTING_STREAM: { label: "Starting camera…", kind: "progress" },
  READY: { label: "Camera ready", kind: "active" },
  SCANNING: { label: "Scanning…", kind: "active" },
  PAUSED: { label: "QR found", kind: "active" },
  PERMISSION_DENIED: { label: "Permission blocked", kind: "error" },
  PERMISSION_DISMISSED: { label: "Permission dismissed", kind: "error" },
  INSECURE_CONTEXT: { label: "Not a secure page", kind: "error" },
  NO_CAMERA: { label: "No camera found", kind: "error" },
  CAMERA_BUSY: { label: "Camera in use", kind: "error" },
  CONSTRAINT_FAILED: { label: "Camera unsupported", kind: "error" },
  PLAYBACK_FAILED: { label: "Preview failed", kind: "error" },
  UNSUPPORTED_BROWSER: { label: "Browser unsupported", kind: "error" },
  ERROR: { label: "Camera error", kind: "error" },
};

export interface CameraOutcome {
  state: CameraState;
  // Stable machine-readable reason (DOMException name or our own code).
  reason: string;
  // Plain-language guidance for the teacher.
  message: string;
}

// A page can use the camera only in a secure context. localhost/127.0.0.1 are
// treated as secure by browsers even over plain http.
export function isSecureLike(
  win: Pick<Window, "isSecureContext"> = window,
  hostname: string = window.location.hostname,
): boolean {
  return (
    win.isSecureContext === true ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

// Shown when the page is not a secure context. Kept jargon-free and points to
// the HTTPS tunnel link, which is the only thing that works on a phone.
export const INSECURE_MESSAGE =
  "Camera is blocked because this page is not secure. On iPhone, open the HTTPS " +
  "Cloudflare tunnel link, for example https://xxxxx.trycloudflare.com (the " +
  "address must start with https://). You can still use QR Paste or Manual select.";

// Visible checklist for fixing camera access on a phone.
export const SECURE_CONTEXT_CHECKLIST: string[] = [
  "Make sure the URL starts with https://",
  "Do not use localhost on iPhone",
  "Do not use http://192.168…",
  "Use the Cloudflare tunnel URL (https://….trycloudflare.com)",
  "Allow camera permission in Safari",
];

// Dev-only context log to help diagnose secure-context issues.
export function logCameraContext(tag: string): void {
  if (import.meta.env.DEV) {
    console.log(
      `[camera:${tag}] protocol=${window.location.protocol} host=${window.location.hostname} secureContext=${window.isSecureContext}`,
    );
  }
}

// Map a getUserMedia rejection to a precise state + message.
// `hasDevices` distinguishes "no camera at all" from "constraints too strict".
export function classifyMediaError(err: unknown, hasDevices: boolean): CameraOutcome {
  const name =
    err instanceof DOMException
      ? err.name
      : err instanceof Error
        ? err.name
        : "";
  const msg = err instanceof Error ? err.message : String(err ?? "");

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      // Some browsers report a dismissed prompt as NotAllowedError too.
      if (/dismiss/i.test(msg)) {
        return {
          state: "PERMISSION_DISMISSED",
          reason: "PERMISSION_DISMISSED",
          message:
            "The camera prompt was closed without choosing. Tap Start camera again and choose Allow.",
        };
      }
      return {
        state: "PERMISSION_DENIED",
        reason: name,
        message:
          "Camera permission is blocked for this site. Click the camera/lock icon in the address bar (or the browser's site settings), set Camera to Allow, reload, then tap Start camera.",
      };
    case "SecurityError":
      return {
        state: "INSECURE_CONTEXT",
        reason: name,
        message: INSECURE_MESSAGE,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        state: "NO_CAMERA",
        reason: name,
        message: "No camera was found on this device. Use QR Paste or Manual select.",
      };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return hasDevices
        ? {
            state: "CONSTRAINT_FAILED",
            reason: name,
            message:
              "This camera can't satisfy the requested settings. Retried with default settings; if it still fails, use QR Paste.",
          }
        : {
            state: "NO_CAMERA",
            reason: name,
            message: "No usable camera was found. Use QR Paste or Manual select.",
          };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return {
        state: "CAMERA_BUSY",
        reason: name,
        message:
          "The camera is being used by another app or browser tab. Close it (Zoom, FaceTime, another tab), then tap Start camera again.",
      };
    case "TypeError":
      return {
        state: "UNSUPPORTED_BROWSER",
        reason: name,
        message:
          "This browser doesn't expose the camera API here. Update the browser, or use QR Paste or Manual select.",
      };
    default:
      return {
        state: "ERROR",
        reason: name || "UNKNOWN",
        message:
          "Could not start the camera" +
          (msg ? " (" + msg + ")" : "") +
          ". Use QR Paste or Manual select.",
      };
  }
}

// Independent environment checks captured during startup, surfaced in the UI.
export interface CameraDiagnostics {
  secureContext: boolean | null;
  mediaDevices: boolean | null;
  getUserMedia: boolean | null;
  inIframe: boolean | null;
  iframeAllowsCamera: boolean | null;
  permissionState: PermissionState | "unsupported" | "unknown";
  videoInputCount: number | null;
  gotStream: boolean | null;
  srcObjectSet: boolean | null;
  playSucceeded: boolean | null;
  videoWidth: number | null;
  videoHeight: number | null;
  detector: "BarcodeDetector" | "jsQR" | null;
  lastErrorName: string | null;
}

export function emptyDiagnostics(): CameraDiagnostics {
  return {
    secureContext: null,
    mediaDevices: null,
    getUserMedia: null,
    inIframe: null,
    iframeAllowsCamera: null,
    permissionState: "unknown",
    videoInputCount: null,
    gotStream: null,
    srcObjectSet: null,
    playSucceeded: null,
    videoWidth: null,
    videoHeight: null,
    detector: null,
    lastErrorName: null,
  };
}
