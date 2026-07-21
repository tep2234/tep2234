// High-resolution final-still capture ladder (R2).
//
//   1. ImageCapture.takePhoto()  — a genuine still-camera exposure, typically
//                                  full sensor resolution on Android Chrome.
//   2. ImageCapture.grabFrame()  — a frame off the track at track resolution.
//   3. canvas drawImage          — the pre-existing path; the only one that
//                                  works on iOS Safari, which has no
//                                  ImageCapture at all.
//
// Why this matters: the preview stream is commonly 1280x720 or 1920x1080. The
// existing FINAL_CAPTURE_W = 2200 is a *processing cap*, not a source of
// detail — drawing a 1280px video frame onto a 2200px canvas only upscales.
// takePhoto() is the only path that yields detail the preview never contained,
// which is what shaded-bubble discrimination actually depends on.
//
// DOM specifics are injected so the ladder itself is unit-testable, and so this
// module never assumes ImageCapture exists merely because TypeScript has types
// for it.

export type FinalCaptureSource = "takePhoto" | "grabFrame" | "canvas";

export interface FinalStillResult {
  image: ImageData;
  source: FinalCaptureSource;
  // True source dimensions BEFORE any processing downscale, so callers can
  // report honestly rather than implying the processing cap was the resolution.
  sourceWidth: number;
  sourceHeight: number;
}

export interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
  grabFrame(): Promise<ImageBitmap>;
}

export interface FinalStillDeps {
  // null when ImageCapture is unsupported or the track cannot back it.
  imageCapture: ImageCaptureLike | null;
  // Whether the underlying track is still usable. Checked before each attempt:
  // a backgrounded app or an unplugged camera ends the track mid-ladder.
  isTrackLive: () => boolean;
  // Decode a still Blob into a bitmap.
  decodeBlob: (blob: Blob) => Promise<ImageBitmap>;
  // Draw a bitmap into the analysis canvas (applying the processing cap) and
  // return its pixels. Returns null if the canvas is unusable.
  drawBitmap: (bitmap: ImageBitmap) => ImageData | null;
  // The pre-existing canvas-from-video capture. Must remain the final rung.
  canvasCapture: () => ImageData | null;
}

// Close a bitmap if the platform supports it. Never let cleanup throw — a
// failure to release must not fail the capture that already succeeded.
function releaseBitmap(bitmap: ImageBitmap | null): void {
  try {
    bitmap?.close?.();
  } catch {
    /* older platforms lack close(); the bitmap is GC-eligible regardless */
  }
}

// Attempt one ImageCapture rung. Returns null to advance to the next rung.
// Guarantees the bitmap is released on every path, including failure.
async function tryBitmapRung(
  deps: FinalStillDeps,
  source: Extract<FinalCaptureSource, "takePhoto" | "grabFrame">,
  produce: () => Promise<ImageBitmap>,
): Promise<FinalStillResult | null> {
  if (!deps.isTrackLive()) return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await produce();
    // A rung can "succeed" and still hand back something unusable (a zero-sized
    // bitmap, or a Blob that decoded to nothing). Treat that as a miss.
    if (!bitmap || !bitmap.width || !bitmap.height) return null;
    const image = deps.drawBitmap(bitmap);
    if (!image) return null;
    return {
      image,
      source,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
    };
  } catch {
    // takePhoto/grabFrame reject routinely: track ended, camera interrupted,
    // OS denied the still, or the device simply does not implement it.
    return null;
  } finally {
    releaseBitmap(bitmap);
  }
}

// Run the ladder. Returns null only when every rung failed, which the caller
// must treat exactly as today's "final still could not be captured".
export async function captureFinalStill(deps: FinalStillDeps): Promise<FinalStillResult | null> {
  if (deps.imageCapture) {
    const photo = await tryBitmapRung(deps, "takePhoto", async () =>
      deps.decodeBlob(await deps.imageCapture!.takePhoto()),
    );
    if (photo) return photo;

    const frame = await tryBitmapRung(deps, "grabFrame", () => deps.imageCapture!.grabFrame());
    if (frame) return frame;
  }

  // Final rung. Deliberately not gated on isTrackLive: the canvas still holds
  // the last painted video frame, and this is the path iOS Safari always takes.
  const image = deps.canvasCapture();
  if (!image) return null;
  return {
    image,
    source: "canvas",
    sourceWidth: image.width,
    sourceHeight: image.height,
  };
}

// Construct an ImageCapture for a track, or null when unsupported.
// Feature-detected at runtime: TypeScript having the type proves nothing, and
// Safari has no ImageCapture at all.
export function createImageCapture(track: MediaStreamTrack | null): ImageCaptureLike | null {
  if (!track || track.readyState !== "live") return null;
  const Ctor = (globalThis as unknown as {
    ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike;
  }).ImageCapture;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor(track);
  } catch {
    // Some Android builds expose the constructor but reject non-video or
    // already-ended tracks.
    return null;
  }
}
