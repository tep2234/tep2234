import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_INGESTION_POLICY,
  ScannerGeneration,
  compositeImageDataOntoWhite,
  ingestGalleryImage,
  inspectImageHeader,
  orientedDimensions,
  readJpegExifOrientation,
  sanitizeJpegExif,
  validateImageDimensions,
  type DecodedRaster,
  type RasterDecoderAdapter,
} from "../src/lib/scanner/image-ingestion";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function pngHeader(width = 1200, height = 1600): Uint8Array {
  const bytes = new Uint8Array(58);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes.set([8, 6, 0, 0, 0], 24);
  view.setUint32(33, 1, false);
  bytes.set([0x49, 0x44, 0x41, 0x54], 37);
  bytes[41] = 0;
  view.setUint32(46, 0, false);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 50);
  return bytes;
}

function jpegWithOrientation(
  orientation: number,
  width = 1600,
  height = 1200,
  sofMarker = 0xc0,
): Uint8Array {
  const bytes = new Uint8Array(73);
  bytes.set([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20]);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6);
  bytes.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], 12);
  bytes.set([0x01, 0x00], 20);
  bytes.set([0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00], 22);
  bytes.set([0xff, sofMarker, 0x00, 0x11, 0x08], 36);
  const view = new DataView(bytes.buffer);
  view.setUint16(41, height, false);
  view.setUint16(43, width, false);
  bytes.set([0xff, 0xda, 0x00, 0x0c], 55);
  bytes[69] = 0x11;
  bytes[70] = 0x22;
  bytes.set([0xff, 0xd9], 71);
  return bytes;
}

function jpegWithUnrelatedApp1(): Uint8Array {
  const original = jpegWithOrientation(6);
  const unrelated = new Uint8Array([0xff, 0xe1, 0x00, 0x08, 0x58, 0x4d, 0x50, 0x31, 0x32, 0x33]);
  const combined = new Uint8Array(original.length + unrelated.length);
  combined.set(original.subarray(0, 36));
  combined.set(unrelated, 36);
  combined.set(original.subarray(36), 36 + unrelated.length);
  return combined;
}

function file(bytes: Uint8Array, type: string, name = "sheet"): File {
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  return new File([ownedBytes.buffer], name, { type });
}

function canvasFixture() {
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    globalAlpha: 0,
    fillStyle: "",
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(0),
      colorSpace: "srgb",
    }) as ImageData),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => "data:image/jpeg;base64,evidence"),
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

function raster(close: () => void = vi.fn()): DecodedRaster {
  return {
    drawable: {} as CanvasImageSource,
    width: 1200,
    height: 1600,
    decoderType: "image-bitmap",
    orientationHandling: "orientation-not-required",
    close,
  };
}

function pixels(values: number[]): ImageData {
  return {
    width: values.length / 4,
    height: 1,
    data: new Uint8ClampedArray(values),
    colorSpace: "srgb",
  } as ImageData;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("gallery byte and dimension policy", () => {
  it("accepts genuine PNG bytes", () => {
    expect(inspectImageHeader(pngHeader(), "image/png")).toMatchObject({
      format: "png",
      encodedWidth: 1200,
      encodedHeight: 1600,
    });
  });

  it("accepts genuine JPEG bytes and reads EXIF rotation", () => {
    const bytes = jpegWithOrientation(6);
    expect(readJpegExifOrientation(bytes)).toBe(6);
    expect(inspectImageHeader(bytes, "image/jpeg")).toMatchObject({ format: "jpeg", orientation: 6 });
  });

  it("accepts baseline and progressive JPEG SOF markers", () => {
    expect(inspectImageHeader(jpegWithOrientation(1, 1600, 1200, 0xc0), "image/jpeg"))
      .toMatchObject({ format: "jpeg", encodedWidth: 1600, encodedHeight: 1200 });
    expect(inspectImageHeader(jpegWithOrientation(1, 1600, 1200, 0xc2), "image/jpeg"))
      .toMatchObject({ format: "jpeg", encodedWidth: 1600, encodedHeight: 1200 });
  });

  it("removes only Exif APP1 metadata from a temporary JPEG copy", () => {
    const original = jpegWithUnrelatedApp1();
    const sanitized = sanitizeJpegExif(original);
    expect(Array.from(original.slice(6, 12))).toEqual([0x45, 0x78, 0x69, 0x66, 0, 0]);
    expect(new TextDecoder().decode(sanitized)).not.toContain("Exif");
    expect(new TextDecoder().decode(sanitized)).toContain("XMP123");
    expect(inspectImageHeader(sanitized, "image/jpeg")).toMatchObject({
      format: "jpeg",
      orientation: 1,
      encodedWidth: 1600,
      encodedHeight: 1200,
    });
    expect(original).toEqual(jpegWithUnrelatedApp1());
  });

  it("normalizes 90 and 270 degree orientation dimensions", () => {
    expect(orientedDimensions(1600, 1200, 6)).toEqual({ width: 1200, height: 1600 });
    expect(orientedDimensions(1600, 1200, 8)).toEqual({ width: 1200, height: 1600 });
  });

  it("keeps 180 degree orientation dimensions", () => {
    expect(orientedDimensions(1200, 1600, 3)).toEqual({ width: 1200, height: 1600 });
  });

  it("rejects GIF, SVG, documents, and unknown bytes", () => {
    for (const bytes of [
      new TextEncoder().encode("GIF89a"),
      new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>"),
      new TextEncoder().encode("%PDF-1.7"),
      new Uint8Array([1, 2, 3, 4]),
    ]) {
      expect(inspectImageHeader(bytes, "")).toMatchObject({ ok: false, code: "UNSUPPORTED_IMAGE_FORMAT" });
    }
  });

  it("rejects MIME/content spoofing regardless of filename", () => {
    expect(inspectImageHeader(pngHeader(), "image/jpeg")).toMatchObject({
      ok: false,
      code: "IMAGE_TYPE_MISMATCH",
    });
  });

  it("rejects malformed or missing JPEG SOF before browser decode", () => {
    const noSof = jpegWithOrientation(1);
    noSof[37] = 0xe0;
    const malformedLength = jpegWithOrientation(1);
    malformedLength[38] = 0xff;
    malformedLength[39] = 0xff;
    expect(inspectImageHeader(noSof, "image/jpeg")).toMatchObject({ code: "IMAGE_STRUCTURE_INVALID" });
    expect(inspectImageHeader(malformedLength, "image/jpeg")).toMatchObject({ code: "IMAGE_STRUCTURE_INVALID" });
    expect(inspectImageHeader(jpegWithOrientation(1).slice(0, 70), "image/jpeg"))
      .toMatchObject({ code: "IMAGE_STRUCTURE_INVALID" });
  });

  it("rejects an invalid EXIF orientation instead of guessing", () => {
    expect(inspectImageHeader(jpegWithOrientation(9), "image/jpeg"))
      .toMatchObject({ code: "IMAGE_STRUCTURE_INVALID" });
  });

  it("rejects truncated PNG structure before browser decode", () => {
    expect(inspectImageHeader(pngHeader().slice(0, 45), "image/png"))
      .toMatchObject({ code: "IMAGE_STRUCTURE_INVALID" });
  });

  it("rejects low-resolution images", () => {
    expect(validateImageDimensions(640, 900)).toMatchObject({
      ok: false,
      code: "IMAGE_DIMENSIONS_TOO_SMALL",
    });
  });

  it("rejects excessive dimensions and decoded pixel counts", () => {
    expect(validateImageDimensions(9000, 1000)).toMatchObject({ code: "IMAGE_DIMENSIONS_TOO_LARGE" });
    expect(validateImageDimensions(8000, 5000)).toMatchObject({ code: "IMAGE_DIMENSIONS_TOO_LARGE" });
  });

  it("accepts a bounded portrait or landscape raster", () => {
    expect(validateImageDimensions(1200, 1600)).toBeNull();
    expect(validateImageDimensions(1600, 1200)).toBeNull();
  });

  it("enforces exact dimension boundaries and safe pixel arithmetic", () => {
    expect(validateImageDimensions(720, 960)).toBeNull();
    expect(validateImageDimensions(719, 960)).toMatchObject({ code: "IMAGE_DIMENSIONS_TOO_SMALL" });
    expect(validateImageDimensions(8192, 3906)).toBeNull();
    expect(validateImageDimensions(8193, 3906)).toMatchObject({ code: "IMAGE_DIMENSIONS_TOO_LARGE" });
    expect(validateImageDimensions(8000, 4000)).toBeNull();
    expect(validateImageDimensions(8000, 4001)).toMatchObject({ code: "IMAGE_DIMENSIONS_TOO_LARGE" });
    expect(validateImageDimensions(Number.MAX_SAFE_INTEGER, 2)).toMatchObject({ code: "IMAGE_DIMENSIONS_TOO_LARGE" });
  });
});

describe("opaque white pixel normalization", () => {
  it("turns fully transparent black RGB pixels white", () => {
    expect(Array.from(compositeImageDataOntoWhite(pixels([0, 0, 0, 0])).data))
      .toEqual([255, 255, 255, 255]);
  });

  it("composites partially transparent dark pixels over white", () => {
    expect(Array.from(compositeImageDataOntoWhite(pixels([20, 40, 60, 128])).data))
      .toEqual([137, 147, 157, 255]);
  });

  it("turns transparent margins white while preserving opaque black marks", () => {
    expect(Array.from(compositeImageDataOntoWhite(pixels([
      0, 0, 0, 0,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ])).data)).toEqual([
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
  });

  it("preserves an already opaque white background byte-for-byte", () => {
    const image = pixels([255, 255, 255, 255, 240, 240, 240, 255]);
    const before = Array.from(image.data);
    expect(Array.from(compositeImageDataOntoWhite(image).data)).toEqual(before);
  });
});

describe("gallery ingestion resource and cancellation contract", () => {
  it("decodes and normalizes a valid PNG through the bounded canvas", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1200, height: 1600, close })));
    const { canvas, context } = canvasFixture();
    const result = await ingestGalleryImage(file(pngHeader(), "image/png"), canvas, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, format: "png", normalizedWidth: 1200, normalizedHeight: 1600 });
    expect(context.drawImage).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  it("applies EXIF orientation before extracting pixels", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1600, height: 1200, close: vi.fn() })));
    const { canvas, context } = canvasFixture();
    const result = await ingestGalleryImage(file(jpegWithOrientation(6), "image/jpeg"), canvas, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, orientation: 6, normalizedWidth: 1200, normalizedHeight: 1600 });
    expect(context.transform).toHaveBeenCalledWith(0, 1, -1, 0, 1200, 0);
  });

  it("passes an Exif-free JPEG copy to the browser decoder", async () => {
    let decodedBytes = new Uint8Array();
    vi.stubGlobal("createImageBitmap", vi.fn(async (source: Blob) => {
      decodedBytes = new Uint8Array(await source.arrayBuffer());
      return { width: 1600, height: 1200, close: vi.fn() };
    }));
    const { canvas } = canvasFixture();
    const result = await ingestGalleryImage(
      file(jpegWithOrientation(6), "image/jpeg"),
      canvas,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: true, orientation: 6 });
    expect(new TextDecoder().decode(decodedBytes)).not.toContain("Exif");
  });

  it("applies explicit transforms for all eight EXIF orientations", async () => {
    const expected: Record<number, number[] | null> = {
      1: null,
      2: [-1, 0, 0, 1, 1600, 0],
      3: [-1, 0, 0, -1, 1600, 1200],
      4: [1, 0, 0, -1, 0, 1200],
      5: [0, 1, 1, 0, 0, 0],
      6: [0, 1, -1, 0, 1200, 0],
      7: [0, -1, -1, 0, 1200, 1600],
      8: [0, -1, 1, 0, 0, 1600],
    };
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1600, height: 1200, close: vi.fn() })));
      const { canvas, context } = canvasFixture();
      const result = await ingestGalleryImage(
        file(jpegWithOrientation(orientation), "image/jpeg"),
        canvas,
        new AbortController().signal,
      );
      expect(result).toMatchObject({ ok: true, orientation });
      if (expected[orientation]) expect(context.transform).toHaveBeenCalledWith(...expected[orientation]!);
      else expect(context.transform).not.toHaveBeenCalled();
    }
  });

  it("fails closed when a decoder cannot prove raw EXIF orientation handling", async () => {
    const close = vi.fn();
    const decoder: RasterDecoderAdapter = {
      decode: vi.fn(async () => ({
        ...raster(close),
        width: 1600,
        height: 1200,
        orientationHandling: "orientation-not-required" as const,
      })),
    };
    const { canvas } = canvasFixture();
    const result = await ingestGalleryImage(
      file(jpegWithOrientation(6), "image/jpeg"),
      canvas,
      new AbortController().signal,
      { decoder },
    );
    expect(result).toMatchObject({ ok: false, code: "IMAGE_ORIENTATION_FAILED" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty file before decode", async () => {
    const { canvas } = canvasFixture();
    expect(await ingestGalleryImage(file(new Uint8Array(), "image/png"), canvas, new AbortController().signal))
      .toMatchObject({ ok: false, code: "EMPTY_IMAGE_FILE" });
  });

  it("rejects a file larger than the documented limit before decode", async () => {
    const oversized = { size: IMAGE_INGESTION_POLICY.maximumFileBytes + 1 } as File;
    const { canvas } = canvasFixture();
    expect(await ingestGalleryImage(oversized, canvas, new AbortController().signal))
      .toMatchObject({ ok: false, code: "IMAGE_FILE_TOO_LARGE" });
  });

  it("returns decode failure for corrupt content with a plausible header", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("decoder rejected"); }));
    const { canvas } = canvasFixture();
    expect(await ingestGalleryImage(file(pngHeader(), "image/png"), canvas, new AbortController().signal))
      .toMatchObject({ ok: false, code: "IMAGE_DECODE_FAILED" });
  });

  it("does not acquire decoder resources when encoded structure validation fails", async () => {
    const decode = vi.fn();
    const decoder: RasterDecoderAdapter = { decode };
    const { canvas, context } = canvasFixture();
    const result = await ingestGalleryImage(
      file(jpegWithOrientation(1).slice(0, 70), "image/jpeg"),
      canvas,
      new AbortController().signal,
      { decoder },
    );
    expect(result).toMatchObject({ ok: false, code: "IMAGE_STRUCTURE_INVALID" });
    expect(decode).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it("closes a decoded bitmap exactly once when cancellation occurs after acquisition", async () => {
    const close = vi.fn();
    const decoderStarted = deferred<void>();
    const decodedResource = deferred<DecodedRaster>();
    const resourceAcquired = deferred<void>();
    const releaseDecoder = deferred<void>();
    const decoder: RasterDecoderAdapter = {
      decode: vi.fn(async () => {
        decoderStarted.resolve();
        const decoded = await decodedResource.promise;
        resourceAcquired.resolve();
        await releaseDecoder.promise;
        return decoded;
      }),
    };
    const controller = new AbortController();
    const { canvas } = canvasFixture();
    const pending = ingestGalleryImage(
      file(pngHeader(), "image/png"),
      canvas,
      controller.signal,
      { decoder },
    );
    await decoderStarted.promise;
    decodedResource.resolve(raster(close));
    await resourceAcquired.promise;
    controller.abort();
    releaseDecoder.resolve();
    expect(await pending).toMatchObject({ ok: false, code: "IMAGE_ANALYSIS_CANCELLED" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not close a nonexistent bitmap when cancellation occurs before acquisition", async () => {
    const close = vi.fn();
    const decoderStarted = deferred<void>();
    const releaseDecoder = deferred<void>();
    const decoder: RasterDecoderAdapter = {
      decode: vi.fn(async (_source, signal) => {
        decoderStarted.resolve();
        await releaseDecoder.promise;
        if (signal.aborted) throw new DOMException("cancelled", "AbortError");
        return raster(close);
      }),
    };
    const controller = new AbortController();
    const { canvas } = canvasFixture();
    const pending = ingestGalleryImage(
      file(pngHeader(), "image/png"),
      canvas,
      controller.signal,
      { decoder },
    );
    await decoderStarted.promise;
    controller.abort();
    releaseDecoder.resolve();
    expect(await pending).toMatchObject({ ok: false, code: "IMAGE_ANALYSIS_CANCELLED" });
    expect(close).not.toHaveBeenCalled();
  });

  it("classifies canvas extraction separately and still closes the decoder resource", async () => {
    const close = vi.fn();
    const decoder: RasterDecoderAdapter = { decode: vi.fn(async () => raster(close)) };
    const { canvas, context } = canvasFixture();
    context.getImageData.mockImplementationOnce(() => { throw new Error("canvas extraction failed"); });
    const result = await ingestGalleryImage(
      file(pngHeader(), "image/png"),
      canvas,
      new AbortController().signal,
      { decoder },
    );
    expect(result).toMatchObject({ ok: false, code: "IMAGE_NORMALIZATION_FAILED" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fills the normalization canvas opaque white before drawing", async () => {
    const decoder: RasterDecoderAdapter = { decode: vi.fn(async () => raster()) };
    const { canvas, context } = canvasFixture();
    const result = await ingestGalleryImage(
      file(pngHeader(), "image/png"),
      canvas,
      new AbortController().signal,
      { decoder },
    );
    expect(result).toMatchObject({ ok: true });
    expect(context.setTransform).toHaveBeenNthCalledWith(1, 1, 0, 0, 1, 0, 0);
    expect(context.fillStyle).toBe("#ffffff");
    expect(context.globalAlpha).toBe(1);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1200, 1600);
    expect(context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(context.drawImage.mock.invocationCallOrder[0]);
    expect(context.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
  });

  it("rejects an invalid decoder contract and closes an acquired resource exactly once", async () => {
    const close = vi.fn();
    const decoder: RasterDecoderAdapter = {
      decode: vi.fn(async () => ({
        ...raster(close),
        drawable: null,
      }) as unknown as DecodedRaster),
    };
    const { canvas } = canvasFixture();
    const result = await ingestGalleryImage(
      file(pngHeader(), "image/png"),
      canvas,
      new AbortController().signal,
      { decoder },
    );
    expect(result).toMatchObject({ ok: false, code: "IMAGE_DECODE_FAILED" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not let cleanup failure overwrite a successful normalized result", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const decoder: RasterDecoderAdapter = {
      decode: vi.fn(async () => raster(() => { throw new Error("close failed"); })),
    };
    const { canvas } = canvasFixture();
    const result = await ingestGalleryImage(
      file(pngHeader(), "image/png"),
      canvas,
      new AbortController().signal,
      { decoder },
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("emits only privacy-safe ingestion diagnostics", async () => {
    const diagnostics: unknown[] = [];
    const decoder: RasterDecoderAdapter = { decode: vi.fn(async () => raster()) };
    const { canvas } = canvasFixture();
    expect(await ingestGalleryImage(
      file(pngHeader(), "image/png", "private-learner-name.png"),
      canvas,
      new AbortController().signal,
      { decoder, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
    )).toMatchObject({ ok: true });
    expect(diagnostics).toHaveLength(1);
    expect(Object.keys(diagnostics[0] as object).sort()).toEqual([
      "capabilities",
      "decodeDurationMs",
      "decodedDimensions",
      "decoderPath",
      "encodedDimensions",
      "exifOrientation",
      "normalizationDurationMs",
    ]);
    expect(JSON.stringify(diagnostics[0])).not.toContain("private-learner-name");
  });

  it("revokes the object URL on fallback decode success", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sheet");
    class FakeImage {
      naturalWidth = 1200;
      naturalHeight = 1600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { if (_value) queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", FakeImage);
    const { canvas } = canvasFixture();
    expect(await ingestGalleryImage(file(pngHeader(), "image/png"), canvas, new AbortController().signal))
      .toMatchObject({ ok: true });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:sheet");
  });

  it("revokes the object URL on fallback decoder rejection", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:bad");
    class FakeImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { if (_value) queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal("Image", FakeImage);
    const { canvas } = canvasFixture();
    expect(await ingestGalleryImage(file(pngHeader(), "image/png"), canvas, new AbortController().signal))
      .toMatchObject({ ok: false, code: "IMAGE_DECODE_FAILED" });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:bad");
  });

  it("revokes the object URL exactly once when fallback decoding is cancelled", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cancelled");
    const sourceAssigned = deferred<void>();
    class FakeImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) { if (value) sourceAssigned.resolve(); }
    }
    vi.stubGlobal("Image", FakeImage);
    const controller = new AbortController();
    const { canvas } = canvasFixture();
    const pending = ingestGalleryImage(file(pngHeader(), "image/png"), canvas, controller.signal);
    await sourceAssigned.promise;
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: "IMAGE_ANALYSIS_CANCELLED" });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:cancelled");
  });
});

describe("gallery generation guard", () => {
  it("makes a prior upload stale as soon as a newer upload begins", () => {
    const guard = new ScannerGeneration();
    const first = guard.begin();
    const second = guard.begin();
    expect(first.signal.aborted).toBe(true);
    expect(guard.isCurrent(first.generation)).toBe(false);
    expect(guard.isCurrent(second.generation)).toBe(true);
  });

  it("invalidates pending callbacks during component cleanup", () => {
    const guard = new ScannerGeneration();
    const current = guard.begin();
    guard.cancel();
    expect(current.signal.aborted).toBe(true);
    expect(guard.isCurrent(current.generation)).toBe(false);
  });

  it("prevents a stale upload result from updating consumer state", async () => {
    const guard = new ScannerGeneration();
    const committed: string[] = [];
    const first = guard.begin();
    const firstResult = deferred<string>();
    const consumeFirst = (async () => {
      const value = await firstResult.promise;
      if (guard.isCurrent(first.generation)) committed.push(value);
    })();
    const second = guard.begin();
    firstResult.resolve("stale-result");
    await consumeFirst;
    expect(committed).toEqual([]);
    expect(guard.isCurrent(second.generation)).toBe(true);
  });
});
