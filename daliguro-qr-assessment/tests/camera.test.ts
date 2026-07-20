import { describe, expect, it } from "vitest";
import {
  classifyMediaError,
  adaptiveAnalyzeInterval,
  emptyDiagnostics,
  inspectCameraTrack,
  isSecureLike,
  preferredVideoConstraints,
  rankVideoDevices,
  STATE_META,
} from "../src/lib/camera";

function domError(name: string, message = "") {
  return new DOMException(message, name);
}

describe("isSecureLike", () => {
  it("is true on a secure context", () => {
    expect(isSecureLike({ isSecureContext: true }, "example.com")).toBe(true);
  });
  it("is true on localhost over plain http", () => {
    expect(isSecureLike({ isSecureContext: false }, "localhost")).toBe(true);
    expect(isSecureLike({ isSecureContext: false }, "127.0.0.1")).toBe(true);
  });
  it("is false on a plain-http LAN IP", () => {
    expect(isSecureLike({ isSecureContext: false }, "192.168.1.9")).toBe(false);
  });
});

describe("classifyMediaError", () => {
  it("maps NotAllowedError to PERMISSION_DENIED", () => {
    const o = classifyMediaError(domError("NotAllowedError"), true);
    expect(o.state).toBe("PERMISSION_DENIED");
    expect(o.message).toMatch(/allow/i);
  });

  it("detects a dismissed prompt", () => {
    const o = classifyMediaError(domError("NotAllowedError", "Permission dismissed"), true);
    expect(o.state).toBe("PERMISSION_DISMISSED");
  });

  it("maps NotReadableError to CAMERA_BUSY", () => {
    expect(classifyMediaError(domError("NotReadableError"), true).state).toBe("CAMERA_BUSY");
  });

  it("maps NotFoundError to NO_CAMERA", () => {
    expect(classifyMediaError(domError("NotFoundError"), false).state).toBe("NO_CAMERA");
  });

  it("OverconstrainedError -> CONSTRAINT_FAILED when devices exist, else NO_CAMERA", () => {
    expect(classifyMediaError(domError("OverconstrainedError"), true).state).toBe(
      "CONSTRAINT_FAILED",
    );
    expect(classifyMediaError(domError("OverconstrainedError"), false).state).toBe(
      "NO_CAMERA",
    );
  });

  it("maps SecurityError to INSECURE_CONTEXT", () => {
    expect(classifyMediaError(domError("SecurityError"), true).state).toBe("INSECURE_CONTEXT");
  });

  it("maps a bare TypeError to UNSUPPORTED_BROWSER", () => {
    expect(classifyMediaError(new TypeError("x"), true).state).toBe("UNSUPPORTED_BROWSER");
  });

  it("falls back to ERROR with the message text", () => {
    const o = classifyMediaError(new Error("weird"), true);
    expect(o.state).toBe("ERROR");
    expect(o.message).toMatch(/weird/);
  });

  it("every state has display metadata", () => {
    (
      [
        "IDLE",
        "PERMISSION_DENIED",
        "INSECURE_CONTEXT",
        "NO_CAMERA",
        "CAMERA_BUSY",
        "SCANNING",
      ] as const
    ).forEach((s) => {
      expect(STATE_META[s].label).toBeTruthy();
    });
  });
});

describe("emptyDiagnostics", () => {
  it("starts all checks unknown", () => {
    const d = emptyDiagnostics();
    expect(d.secureContext).toBeNull();
    expect(d.permissionState).toBe("unknown");
    expect(d.gotStream).toBeNull();
  });
});

describe("camera capability negotiation", () => {
  it("prefers a remembered normal rear camera over front and ultrawide cameras", () => {
    const ranked = rankVideoDevices([
      { kind: "videoinput", deviceId: "front", label: "Front Camera" },
      { kind: "videoinput", deviceId: "ultra", label: "Back Ultra Wide 0.5x" },
      { kind: "videoinput", deviceId: "rear", label: "Back Camera" },
    ] as MediaDeviceInfo[], "rear");
    expect(ranked.map((device) => device.deviceId)).toEqual(["rear", "ultra", "front"]);
  });

  it("uses ideal acquisition settings unless the teacher selected an exact device", () => {
    expect(preferredVideoConstraints()).toMatchObject({
      facingMode: { ideal: "environment" },
      width: { ideal: 2560 },
      height: { ideal: 1440 },
    });
    expect(preferredVideoConstraints("rear-1")).toMatchObject({ deviceId: { exact: "rear-1" } });
  });

  it("reports actual granted settings and supported controls", () => {
    expect(inspectCameraTrack({
      width: 1920,
      height: 1080,
      frameRate: 29.97,
      facingMode: "environment",
      deviceId: "rear-1",
      aspectRatio: 16 / 9,
    }, { torch: true, focusMode: ["continuous"] } as never)).toMatchObject({
      width: 1920,
      height: 1080,
      facingMode: "environment",
      deviceId: "rear-1",
      torchSupported: true,
    });
  });

  it("adds backpressure when decoding is slower than the nominal interval", () => {
    expect(adaptiveAnalyzeInterval(40)).toBe(90);
    expect(adaptiveAnalyzeInterval(160)).toBe(200);
    expect(adaptiveAnalyzeInterval(1000)).toBe(500);
  });
});
