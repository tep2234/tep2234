import { describe, expect, it } from "vitest";
import {
  advanceFrameStability,
  normalizedSheetGeometry,
  type FrameStabilityState,
} from "../src/lib/scanner/frame-stability";

function geometry(dx = 0, dy = 0, scale = 1) {
  const base = [
    { x: 100, y: 100 },
    { x: 700, y: 100 },
    { x: 700, y: 1000 },
    { x: 100, y: 1000 },
  ].map((point) => ({
    x: 400 + (point.x - 400) * scale + dx,
    y: 550 + (point.y - 550) * scale + dy,
  }));
  return normalizedSheetGeometry(base, 800, 1100)!;
}

function observe(
  previous: FrameStabilityState | null,
  identity: string,
  dx = 0,
  freshIdentity = true,
  luminance = 180,
  sharpness = 6,
  observedAt = (previous?.lastObservedAt ?? 0) + 100,
) {
  return advanceFrameStability(previous, {
    identity,
    geometry: geometry(dx),
    freshIdentity,
    luminance,
    sharpness,
    observedAt,
  });
}

describe("automatic-capture temporal stability", () => {
  it("requires four consecutive geometrically stable frames", () => {
    let state: FrameStabilityState | null = null;
    for (let frame = 1; frame <= 4; frame += 1) {
      const decision = observe(state, "qr-a", frame % 2);
      state = decision.state;
      expect(decision.ready).toBe(frame === 4);
    }
  });

  it("resets immediately on QR loss instead of bridging misses", () => {
    let decision = observe(null, "qr-a");
    decision = observe(decision.state, "qr-a", 1);
    expect(decision.state?.consecutive).toBe(2);
    decision = advanceFrameStability(decision.state, null);
    expect(decision.state).toBeNull();
    decision = observe(decision.state, "qr-a");
    expect(decision.state?.consecutive).toBe(1);
  });

  it("does not count cached identity as capture evidence", () => {
    const first = observe(null, "qr-a");
    const cached = observe(first.state, "qr-a", 0, false);
    expect(cached.state).toBeNull();
    expect(cached.resetReason).toBe("identity_missing");
  });

  it("resets on sheet identity change or visible movement", () => {
    const first = observe(null, "qr-a");
    const second = observe(first.state, "qr-a", 1);
    const moved = observe(second.state, "qr-a", 40);
    expect(moved.state?.consecutive).toBe(1);
    expect(moved.resetReason).toBe("motion");
    const changed = observe(moved.state, "qr-b", 40);
    expect(changed.state?.consecutive).toBe(1);
    expect(changed.resetReason).toBe("identity_changed");
  });

  it("resets when lighting or focus changes indicate an unstable capture", () => {
    const first = observe(null, "qr-a");
    const second = observe(first.state, "qr-a", 0, true, 181, 6.1);
    expect(second.state?.consecutive).toBe(2);
    const lightingChanged = observe(second.state, "qr-a", 0, true, 220, 6.1);
    expect(lightingChanged.state?.consecutive).toBe(1);
    expect(lightingChanged.resetReason).toBe("quality_changed");
    const focusChanged = observe(lightingChanged.state, "qr-a", 0, true, 220, 2.5);
    expect(focusChanged.state?.consecutive).toBe(1);
    expect(focusChanged.resetReason).toBe("quality_changed");
  });

  it("uses the first frame as an anchor so slow cumulative drift cannot pass", () => {
    const first = observe(null, "qr-a", 0);
    const second = observe(first.state, "qr-a", 10);
    expect(second.state?.consecutive).toBe(2);
    const drifted = observe(second.state, "qr-a", 20);
    expect(drifted.state?.consecutive).toBe(1);
    expect(drifted.resetReason).toBe("motion");
  });

  it("resets after a long analysis gap", () => {
    const first = observe(null, "qr-a", 0, true, 180, 6, 100);
    const delayed = observe(first.state, "qr-a", 0, true, 180, 6, 2000);
    expect(delayed.state?.consecutive).toBe(1);
    expect(delayed.resetReason).toBe("timeout");
  });
});
