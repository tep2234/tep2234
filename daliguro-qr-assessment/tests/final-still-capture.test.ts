// R2 — high-resolution final-still capture ladder.
//
// Certifies the fallback order, that every rung releases its bitmap (including
// on failure), that an unusable result advances rather than being accepted, and
// that a device without ImageCapture still reaches the pre-existing canvas path.

import { describe, expect, it, vi } from "vitest";
import {
  captureFinalStill,
  createImageCapture,
  type FinalStillDeps,
  type ImageCaptureLike,
} from "../src/lib/scanner/final-still-capture";

function imageData(width: number, height: number): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: "srgb",
  } as ImageData;
}

// Tracks close() so resource-release assertions are real, not assumed.
function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
}

function deps(overrides: Partial<FinalStillDeps> = {}): FinalStillDeps {
  return {
    imageCapture: null,
    isTrackLive: () => true,
    decodeBlob: async () => fakeBitmap(4000, 3000),
    drawBitmap: (bmp) => imageData(Math.min(bmp.width, 2200), Math.min(bmp.height, 2200)),
    canvasCapture: () => imageData(1300, 1733),
    ...overrides,
  };
}

function capture(overrides: Partial<ImageCaptureLike> = {}): ImageCaptureLike {
  return {
    takePhoto: async () => new Blob(),
    grabFrame: async () => fakeBitmap(1920, 1080),
    ...overrides,
  };
}

describe("final-still ladder — ordering", () => {
  it("prefers takePhoto and reports the genuine sensor dimensions", async () => {
    const grabFrame = vi.fn(async () => fakeBitmap(1920, 1080));
    const result = await captureFinalStill(
      deps({
        imageCapture: capture({ grabFrame }),
        decodeBlob: async () => fakeBitmap(4000, 3000),
      }),
    );

    expect(result?.source).toBe("takePhoto");
    // The still is 4000x3000 even though processing caps the canvas at 2200.
    // Reporting the cap as the resolution would be the exact overstatement R2
    // exists to avoid.
    expect(result?.sourceWidth).toBe(4000);
    expect(result?.sourceHeight).toBe(3000);
    expect(grabFrame).not.toHaveBeenCalled();
  });

  it("falls back to grabFrame when takePhoto rejects", async () => {
    const canvasCapture = vi.fn(() => imageData(1300, 1733));
    const result = await captureFinalStill(
      deps({
        imageCapture: capture({
          takePhoto: async () => {
            throw new Error("takePhoto not supported on this device");
          },
        }),
        canvasCapture,
      }),
    );

    expect(result?.source).toBe("grabFrame");
    expect(result?.sourceWidth).toBe(1920);
    expect(canvasCapture).not.toHaveBeenCalled();
  });

  it("falls back to canvas when both ImageCapture rungs reject", async () => {
    const result = await captureFinalStill(
      deps({
        imageCapture: capture({
          takePhoto: async () => {
            throw new Error("nope");
          },
          grabFrame: async () => {
            throw new Error("nope");
          },
        }),
      }),
    );

    expect(result?.source).toBe("canvas");
    expect(result?.sourceWidth).toBe(1300);
  });

  it("goes straight to canvas when ImageCapture is unavailable (iOS Safari)", async () => {
    const decodeBlob = vi.fn();
    const result = await captureFinalStill(deps({ imageCapture: null, decodeBlob }));

    expect(result?.source).toBe("canvas");
    expect(decodeBlob).not.toHaveBeenCalled();
  });

  it("returns null only when every rung including canvas fails", async () => {
    const result = await captureFinalStill(
      deps({
        imageCapture: capture({
          takePhoto: async () => {
            throw new Error("nope");
          },
          grabFrame: async () => {
            throw new Error("nope");
          },
        }),
        canvasCapture: () => null,
      }),
    );

    expect(result).toBeNull();
  });
});

describe("final-still ladder — unusable results advance", () => {
  it("does not accept a zero-sized bitmap from takePhoto", async () => {
    const result = await captureFinalStill(
      deps({
        imageCapture: capture(),
        decodeBlob: async () => fakeBitmap(0, 0),
      }),
    );

    // A Blob that decoded to nothing must not be treated as a valid still.
    expect(result?.source).toBe("grabFrame");
  });

  it("advances when the canvas cannot draw the bitmap", async () => {
    const result = await captureFinalStill(
      deps({
        imageCapture: capture(),
        drawBitmap: () => null,
      }),
    );

    expect(result?.source).toBe("canvas");
  });
});

describe("final-still ladder — track liveness", () => {
  it("skips both ImageCapture rungs when the track has ended", async () => {
    const takePhoto = vi.fn(async () => new Blob());
    const grabFrame = vi.fn(async () => fakeBitmap(1920, 1080));

    const result = await captureFinalStill(
      deps({
        imageCapture: capture({ takePhoto, grabFrame }),
        isTrackLive: () => false,
      }),
    );

    expect(takePhoto).not.toHaveBeenCalled();
    expect(grabFrame).not.toHaveBeenCalled();
    // The canvas still holds the last painted frame, so a scan in flight when
    // the app is backgrounded still produces evidence for verification.
    expect(result?.source).toBe("canvas");
  });
});

describe("final-still ladder — resource release", () => {
  it("closes the bitmap from a successful takePhoto", async () => {
    const bitmap = fakeBitmap(4000, 3000);
    await captureFinalStill(
      deps({ imageCapture: capture(), decodeBlob: async () => bitmap }),
    );

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("closes the bitmap even when drawing fails", async () => {
    const bitmap = fakeBitmap(4000, 3000);
    await captureFinalStill(
      deps({
        imageCapture: capture(),
        decodeBlob: async () => bitmap,
        drawBitmap: () => null,
      }),
    );

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("closes the grabFrame bitmap after takePhoto fell through", async () => {
    const bitmap = fakeBitmap(1920, 1080);
    await captureFinalStill(
      deps({
        imageCapture: capture({
          takePhoto: async () => {
            throw new Error("nope");
          },
          grabFrame: async () => bitmap,
        }),
      }),
    );

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("does not accumulate unreleased bitmaps across repeated captures", async () => {
    const created: Array<ReturnType<typeof fakeBitmap>> = [];

    for (let i = 0; i < 25; i += 1) {
      await captureFinalStill(
        deps({
          imageCapture: capture(),
          decodeBlob: async () => {
            const bmp = fakeBitmap(4000, 3000);
            created.push(bmp);
            return bmp;
          },
        }),
      );
    }

    expect(created).toHaveLength(25);
    // Every bitmap from every repeated scan must have been closed exactly once.
    expect(created.every((b) => b.close.mock.calls.length === 1)).toBe(true);
  });

  it("completes 100 simulated captures with no leaked bitmaps or pending state", async () => {
    // Endurance proxy for a long scanning session. Asserts three things a leak
    // would break: every bitmap closed exactly once, every capture resolved
    // (no promise left pending), and no unbounded growth in live objects.
    const created: Array<ReturnType<typeof fakeBitmap>> = [];
    const sources: string[] = [];

    for (let i = 0; i < 100; i += 1) {
      // Rotate through the rungs so each failure path is exercised repeatedly,
      // not just the happy path.
      const mode = i % 3;
      const result = await captureFinalStill(
        deps({
          imageCapture: capture({
            takePhoto:
              mode === 0
                ? async () => new Blob()
                : async () => {
                    throw new Error("takePhoto unavailable");
                  },
            grabFrame:
              mode === 1
                ? async () => {
                    const bmp = fakeBitmap(1920, 1080);
                    created.push(bmp);
                    return bmp;
                  }
                : async () => {
                    throw new Error("grabFrame unavailable");
                  },
          }),
          decodeBlob: async () => {
            const bmp = fakeBitmap(4000, 3000);
            created.push(bmp);
            return bmp;
          },
        }),
      );
      // Every iteration must actually resolve to a usable still.
      expect(result).not.toBeNull();
      sources.push(result!.source);
    }

    expect(sources).toHaveLength(100);
    // All three rungs were genuinely exercised.
    expect(new Set(sources)).toEqual(new Set(["takePhoto", "grabFrame", "canvas"]));
    // Not one bitmap left open across the whole session.
    const unclosed = created.filter((b) => b.close.mock.calls.length !== 1);
    expect(unclosed).toHaveLength(0);
  });

  it("survives a platform whose ImageBitmap has no close()", async () => {
    const bitmap = { width: 4000, height: 3000 } as unknown as ImageBitmap;

    const result = await captureFinalStill(
      deps({ imageCapture: capture(), decodeBlob: async () => bitmap }),
    );

    expect(result?.source).toBe("takePhoto");
  });
});

describe("createImageCapture — feature detection", () => {
  const liveTrack = { readyState: "live" } as MediaStreamTrack;

  it("returns null when the platform has no ImageCapture (iOS Safari)", () => {
    expect(createImageCapture(liveTrack)).toBeNull();
  });

  it("returns null for a missing or ended track", () => {
    expect(createImageCapture(null)).toBeNull();
    expect(createImageCapture({ readyState: "ended" } as MediaStreamTrack)).toBeNull();
  });

  it("returns null when the constructor throws", () => {
    const g = globalThis as unknown as { ImageCapture?: unknown };
    g.ImageCapture = function () {
      throw new Error("unsupported track");
    };
    try {
      expect(createImageCapture(liveTrack)).toBeNull();
    } finally {
      delete g.ImageCapture;
    }
  });

  it("constructs when the platform supports it", () => {
    const g = globalThis as unknown as { ImageCapture?: unknown };
    g.ImageCapture = function () {
      return { takePhoto: async () => new Blob(), grabFrame: async () => fakeBitmap(1, 1) };
    };
    try {
      expect(createImageCapture(liveTrack)).not.toBeNull();
    } finally {
      delete g.ImageCapture;
    }
  });
});
