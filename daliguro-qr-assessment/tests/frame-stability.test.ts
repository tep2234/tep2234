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

  it("does not treat a higher-resolution final still as a focus change", () => {
    // Preview baseline is built from low-res live frames (1300px). sharpnessOf()
    // is a per-pixel gradient, so the same physically-still sheet re-measured on
    // the high-res final still (2200px) reads proportionally lower — here 6 ->
    // ~3.5, a raw drop of ~42% that would trip MAX_SHARPNESS_CHANGE_RATIO (0.4).
    const previewWidth = 1300;
    const finalWidth = 2200;
    let decision = advanceFrameStability(null, {
      identity: "qr-a",
      geometry: geometry(0),
      freshIdentity: true,
      luminance: 180,
      sharpness: 6,
      sharpnessWidth: previewWidth,
      observedAt: 100,
    });
    for (let frame = 2; frame <= 4; frame += 1) {
      decision = advanceFrameStability(decision.state, {
        identity: "qr-a",
        geometry: geometry(0),
        freshIdentity: true,
        luminance: 180,
        sharpness: 6,
        sharpnessWidth: previewWidth,
        observedAt: 100 * frame,
      });
    }
    expect(decision.ready).toBe(true);

    const finalSharpness = 6 * (previewWidth / finalWidth); // ~3.5
    const raw = Math.abs(6 - finalSharpness) / 6;
    expect(raw).toBeGreaterThan(0.4); // proves the naive comparison would reject

    const finalStill = advanceFrameStability(decision.state, {
      identity: "qr-a",
      geometry: geometry(0),
      freshIdentity: true,
      luminance: 180,
      sharpness: finalSharpness,
      sharpnessWidth: finalWidth,
      observedAt: 500,
    });
    expect(finalStill.resetReason).toBeNull();
    expect(finalStill.ready).toBe(true);
  });

  it("accepts a full-sensor ImageCapture still, a far larger jump than a canvas capture", () => {
    // R2 introduced ImageCapture.takePhoto(), which can return a genuine
    // full-sensor still (e.g. 4000px) rather than the canvas path's ~2200px
    // cap. That widens the preview->final resolution ratio from ~1.7x to ~3x,
    // so this asserts the normalization still holds at the new extreme instead
    // of rejecting good captures with FINAL_CAPTURE_UNSTABLE.
    const previewWidth = 1300;
    const finalWidth = 4000;
    let decision = advanceFrameStability(null, {
      identity: "qr-a",
      geometry: geometry(0),
      freshIdentity: true,
      luminance: 180,
      sharpness: 6,
      sharpnessWidth: previewWidth,
      observedAt: 100,
    });
    for (let frame = 2; frame <= 4; frame += 1) {
      decision = advanceFrameStability(decision.state, {
        identity: "qr-a",
        geometry: geometry(0),
        freshIdentity: true,
        luminance: 180,
        sharpness: 6,
        sharpnessWidth: previewWidth,
        observedAt: 100 * frame,
      });
    }
    expect(decision.ready).toBe(true);

    const finalSharpness = 6 * (previewWidth / finalWidth); // ~1.95
    expect(Math.abs(6 - finalSharpness) / 6).toBeGreaterThan(0.4);

    const finalStill = advanceFrameStability(decision.state, {
      identity: "qr-a",
      geometry: geometry(0),
      freshIdentity: true,
      luminance: 180,
      sharpness: finalSharpness,
      sharpnessWidth: finalWidth,
      observedAt: 500,
    });
    expect(finalStill.resetReason).toBeNull();
    expect(finalStill.ready).toBe(true);
  });

  it("still rejects a genuinely blurred high-resolution still", () => {
    // The normalization must not become a blanket excuse for any sharpness
    // drop: a real focus loss at high resolution must still fail.
    const previewWidth = 1300;
    const finalWidth = 4000;
    let decision = advanceFrameStability(null, {
      identity: "qr-a",
      geometry: geometry(0),
      freshIdentity: true,
      luminance: 180,
      sharpness: 6,
      sharpnessWidth: previewWidth,
      observedAt: 100,
    });
    for (let frame = 2; frame <= 4; frame += 1) {
      decision = advanceFrameStability(decision.state, {
        identity: "qr-a",
        geometry: geometry(0),
        freshIdentity: true,
        luminance: 180,
        sharpness: 6,
        sharpnessWidth: previewWidth,
        observedAt: 100 * frame,
      });
    }

    // Half the sharpness the resolution change alone would explain.
    const blurred = 6 * (previewWidth / finalWidth) * 0.4;
    const finalStill = advanceFrameStability(decision.state, {
      identity: "qr-a",
      geometry: geometry(0),
      freshIdentity: true,
      luminance: 180,
      sharpness: blurred,
      sharpnessWidth: finalWidth,
      observedAt: 500,
    });
    expect(finalStill.ready).toBe(false);
    expect(finalStill.resetReason).toBe("quality_changed");
  });
});

// Build a 4-frame stable baseline at a given capture width and sharpness.
function stableBaseline(
  width: number | undefined,
  sharpness: number,
  frames = 4,
) {
  let decision = advanceFrameStability(null, {
    identity: "qr-a",
    geometry: geometry(0),
    freshIdentity: true,
    luminance: 180,
    sharpness,
    sharpnessWidth: width,
    observedAt: 100,
  });
  for (let frame = 2; frame <= frames; frame += 1) {
    decision = advanceFrameStability(decision.state, {
      identity: "qr-a",
      geometry: geometry(0),
      freshIdentity: true,
      luminance: 180,
      sharpness,
      sharpnessWidth: width,
      observedAt: 100 * frame,
    });
  }
  return decision;
}

describe("resolution-aware final-capture stability across dimensions", () => {
  const BASELINE_SHARPNESS = 6;
  // [label, live/preview width, full-res final width]. sharpnessOf() scales ~1/w,
  // so a physically-identical sheet reads BASELINE * (liveW/finalW) on the final.
  const pairs: Array<[string, number, number]> = [
    ["640x480 -> 1280x720", 640, 1280],
    ["1280x720 preview -> 1920x1080", 900, 1920],
    ["1080p preview -> 2160 final", 1080, 2160],
    ["1440 preview -> 2560 final", 1280, 2560],
    ["1440 preview -> 3840 (4K) final", 1440, 3840],
    ["real mobile 1300 -> 2200", 1300, 2200],
    ["real desktop 900 -> 1600", 900, 1600],
    ["portrait 3024x4032: 1134 preview -> 3024 final", 1134, 3024],
    ["portrait 480x640: 480 preview -> 3024 final", 480, 3024],
  ];

  it.each(pairs)(
    "keeps a physically-stable sheet ready (%s)",
    (_label, liveWidth, finalWidth) => {
      const baseline = stableBaseline(liveWidth, BASELINE_SHARPNESS);
      expect(baseline.ready).toBe(true);
      // Requirement 1: same scene, different resolution -> comparable ratio.
      const finalSharpness = BASELINE_SHARPNESS * (liveWidth / finalWidth);
      const rawDrop = Math.abs(BASELINE_SHARPNESS - finalSharpness) / BASELINE_SHARPNESS;
      const finalStill = advanceFrameStability(baseline.state, {
        identity: "qr-a",
        geometry: geometry(0),
        freshIdentity: true,
        luminance: 180,
        sharpness: finalSharpness,
        sharpnessWidth: finalWidth,
        observedAt: 500,
      });
      expect(finalStill.resetReason).toBeNull();
      expect(finalStill.ready).toBe(true);
      // For any real upscale the naive raw comparison would have rejected once
      // the resolution jump exceeds the 0.4 tolerance — confirm the pair is a
      // meaningful test of the normalization, not a trivial pass.
      if (finalWidth / liveWidth >= 1.7) {
        expect(rawDrop).toBeGreaterThan(0.4);
      }
    },
  );

  it("does not rescue a genuinely blurred final still (no artificial high-res pass)", () => {
    // Requirements 2 & 3: a large final width must not inflate a truly blurred
    // capture into a pass. A sharp 2200px sheet would read ~3.55; this one reads
    // 1.8 (genuine defocus). Normalized: 1.8 * 2200/1300 = 3.05 vs 6 -> ratio
    // ~0.49 > 0.4, so it still fails as a quality change.
    const baseline = stableBaseline(1300, 6);
    const blurredFinal = advanceFrameStability(baseline.state, {
      identity: "qr-a",
      geometry: geometry(0),
      freshIdentity: true,
      luminance: 180,
      sharpness: 1.8,
      sharpnessWidth: 2200,
      observedAt: 500,
    });
    expect(blurredFinal.ready).toBe(false);
    expect(blurredFinal.resetReason).toBe("quality_changed");
  });

  it("falls back to a raw, fail-safe comparison when width is missing/invalid", () => {
    // Requirement 4: unknown/zero/NaN/negative width must not silently rescue a
    // real sharpness drop. With no trustworthy width the comparison stays raw
    // (pre-fix behavior), so a genuine drop still fails.
    for (const badWidth of [undefined, 0, Number.NaN, -100]) {
      const baseline = stableBaseline(badWidth, 6);
      expect(baseline.ready).toBe(true);
      const drop = advanceFrameStability(baseline.state, {
        identity: "qr-a",
        geometry: geometry(0),
        freshIdentity: true,
        luminance: 180,
        sharpness: 3.4, // raw ratio |6-3.4|/6 = 0.43 > 0.4
        sharpnessWidth: badWidth,
        observedAt: 500,
      });
      expect(drop.ready).toBe(false);
      expect(drop.resetReason).toBe("quality_changed");
    }

    // A known-width baseline compared against an unknown-width observation also
    // stays raw (both widths must be trustworthy to rescale) — never rescued.
    const mixed = stableBaseline(1300, 6);
    const unknownObs = advanceFrameStability(mixed.state, {
      identity: "qr-a",
      geometry: geometry(0),
      freshIdentity: true,
      luminance: 180,
      sharpness: 3.4,
      sharpnessWidth: undefined,
      observedAt: 500,
    });
    expect(unknownObs.ready).toBe(false);
  });
});
