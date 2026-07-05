import { describe, expect, it } from "vitest";
import {
  classifyMediaError,
  emptyDiagnostics,
  isSecureLike,
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
