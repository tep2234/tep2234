// R1 — ZXing WASM decoder tier.
//
// These tests mock the `zxing-wasm/reader` boundary. The intent is to certify
// OUR cascade and trust gate, not to re-test ZXing itself: that the tier is
// skipped when a native BarcodeDetector already produced an identity, that a
// decoder fault falls through to jsQR instead of crashing, and — most
// importantly — that a successful ZXing decode earns no trust that a jsQR read
// would not also have to earn.

import { beforeEach, describe, expect, it, vi } from "vitest";

const readBarcodes = vi.fn();
const prepareZXingModule = vi.fn();

vi.mock("zxing-wasm/reader", () => ({
  readBarcodes: (...args: unknown[]) => readBarcodes(...args),
  prepareZXingModule: (...args: unknown[]) => prepareZXingModule(...args),
}));

// Vite resolves `?url` to a string at build time; under the test runner we only
// need it to be a same-origin-looking relative asset path.
vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({
  default: "/assets/zxing_reader-abc123.wasm",
}));

const { analyzeFrameAsync } = await import("../src/lib/scanner/analyze-frame");
const { readQrWithZxing, resetZxingForTests, zxingDiagnostics, isZxingUnavailable } = await import(
  "../src/lib/scanner/zxing-qr"
);

const { buildQrPayload, qrText: serializeQr } = await import("../src/lib/qr");

const ASSESSMENT = "A1";

const testLearner = {
  id: "L1",
  lrn: "123456789012",
  fullName: "Learner One",
  sex: "F" as const,
  gradeLevel: "10",
  section: "A",
};

// Build through the real encoder. Hand-written JSON is not a valid payload:
// decodeQrPayload requires a security token and an integrity checksum, and the
// trust gate correctly rejects anything lacking them.
function validPayload(assessment = ASSESSMENT, items = 10): string {
  return serializeQr(buildQrPayload(assessment, testLearner, "A", items));
}

// A payload that is well-formed JSON but whose checksum no longer matches its
// contents — i.e. an altered or damaged sheet code.
function tamperedPayload(mutate: Record<string, unknown>): string {
  return JSON.stringify({ ...buildQrPayload(ASSESSMENT, testLearner, "A", 10), ...mutate });
}

// A blank frame: no QR is physically present, so the real jsQR cascade inside
// analyzeFrameData genuinely finds nothing. That makes "what did ZXing
// contribute?" unambiguous.
function blankFrame(width = 160, height = 200) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 240;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function zxingHit(text: string) {
  return [{ isValid: true, text }];
}

beforeEach(() => {
  readBarcodes.mockReset();
  prepareZXingModule.mockReset();
  prepareZXingModule.mockResolvedValue({});
  resetZxingForTests();
});

describe("ZXing tier — activation boundary", () => {
  it("is skipped entirely when the native BarcodeDetector already decoded the QR", async () => {
    const analysis = await analyzeFrameAsync(blankFrame(), ASSESSMENT, validPayload(), false);

    // The WASM binary must never even be fetched on a device with native support.
    expect(prepareZXingModule).not.toHaveBeenCalled();
    expect(readBarcodes).not.toHaveBeenCalled();
    expect(analysis.qrSource).toBe("provided");
  });

  it("runs when no native detector supplied an identity, and is attributed to zxing-wasm", async () => {
    // Bind once: buildSecurityToken is non-deterministic, so two calls to
    // validPayload() legitimately differ.
    const payload = validPayload();
    readBarcodes.mockResolvedValue(zxingHit(payload));

    const analysis = await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);

    expect(readBarcodes).toHaveBeenCalledTimes(1);
    expect(analysis.qrText).toBe(payload);
    // Attribution must distinguish the WASM tier from a native hit.
    expect(analysis.qrSource).toBe("zxing-wasm");
  });
});

describe("ZXing tier — trust gate", () => {
  it("does NOT accept a decoded string that is not a well-formed identity payload", async () => {
    // A real-world false positive: ZXing reads *a* QR, but it is somebody
    // else's code, not a DALIguro identity sheet.
    readBarcodes.mockResolvedValue(zxingHit("https://example.com/not-a-sheet"));

    const analysis = await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);

    // It must fall through rather than binding the frame to a bogus identity.
    expect(analysis.qrSource).not.toBe("zxing-wasm");
    expect(analysis.result.scan).toBeNull();
  });

  it("rejects a fully valid ZXing decode that belongs to a different assessment", async () => {
    // Correctly signed and checksummed — just the wrong assessment. This is the
    // case a decoder upgrade must not weaken.
    readBarcodes.mockResolvedValue(zxingHit(validPayload("OTHER-ASSESSMENT")));

    const analysis = await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);

    expect(analysis.result.scan).toBeNull();
    expect(analysis.result.reasonCodes).toContain("WRONG_ASSESSMENT");
  });

  it("rejects a ZXing decode whose payload omits learner identity", async () => {
    readBarcodes.mockResolvedValue(zxingHit(JSON.stringify({ assessmentId: ASSESSMENT })));

    const analysis = await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);

    expect(analysis.result.scan).toBeNull();
    expect(analysis.qrSource).not.toBe("zxing-wasm");
  });

  it("rejects a ZXing decode whose checksum no longer matches its contents", async () => {
    readBarcodes.mockResolvedValue(zxingHit(tamperedPayload({ learnerId: "SOMEONE-ELSE" })));

    const analysis = await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);

    expect(analysis.result.scan).toBeNull();
    expect(analysis.qrSource).not.toBe("zxing-wasm");
  });

  it("rejects a ZXing decode that smuggles answer data into an identity QR", async () => {
    readBarcodes.mockResolvedValue(zxingHit(tamperedPayload({ answers: ["A", "B"] })));

    const analysis = await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);

    expect(analysis.result.scan).toBeNull();
    expect(analysis.qrSource).not.toBe("zxing-wasm");
  });

  it("ignores a ZXing result flagged invalid by the decoder itself", async () => {
    readBarcodes.mockResolvedValue([{ isValid: false, text: validPayload() }]);

    const analysis = await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);

    expect(analysis.qrSource).not.toBe("zxing-wasm");
  });
});

describe("ZXing tier — failure containment", () => {
  it("falls through to the jsQR cascade when module instantiation fails", async () => {
    prepareZXingModule.mockRejectedValue(new Error("WASM unsupported"));

    const analysis = await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, true);

    // No throw, and the frame is still answered.
    expect(analysis.result).toBeDefined();
    expect(analysis.qrSource).not.toBe("zxing-wasm");
    expect(isZxingUnavailable()).toBe(true);
  });

  it("stops retrying instantiation after a failure instead of thrashing every frame", async () => {
    prepareZXingModule.mockRejectedValue(new Error("WASM unsupported"));

    await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);
    await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);
    await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);

    expect(prepareZXingModule).toHaveBeenCalledTimes(1);
    expect(readBarcodes).not.toHaveBeenCalled();
  });

  it("survives a per-frame decode error and keeps serving later frames", async () => {
    readBarcodes.mockRejectedValueOnce(new Error("bad frame"));
    readBarcodes.mockResolvedValueOnce(zxingHit(validPayload()));

    const first = await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);
    expect(first.result).toBeDefined();
    expect(first.qrSource).not.toBe("zxing-wasm");

    // A single bad frame must not disable the tier permanently.
    const second = await analyzeFrameAsync(blankFrame(), ASSESSMENT, null, false);
    expect(second.qrSource).toBe("zxing-wasm");
  });

  it("returns null rather than throwing when the decoder finds nothing", async () => {
    readBarcodes.mockResolvedValue([]);

    await expect(readQrWithZxing(blankFrame())).resolves.toBeNull();
  });
});

describe("ZXing tier — single initialization", () => {
  it("instantiates the module once across many sequential frames", async () => {
    readBarcodes.mockResolvedValue([]);

    for (let i = 0; i < 5; i += 1) {
      await readQrWithZxing(blankFrame());
    }

    expect(prepareZXingModule).toHaveBeenCalledTimes(1);
    expect(zxingDiagnostics().initCount).toBe(1);
  });

  it("shares one initialization promise across concurrent frames", async () => {
    readBarcodes.mockResolvedValue([]);

    // Fire frames in parallel, as the scan loop can while a decode is in flight.
    await Promise.all([
      readQrWithZxing(blankFrame()),
      readQrWithZxing(blankFrame()),
      readQrWithZxing(blankFrame()),
      readQrWithZxing(blankFrame()),
    ]);

    expect(prepareZXingModule).toHaveBeenCalledTimes(1);
  });
});

describe("ZXing tier — offline asset policy", () => {
  it("pins locateFile to a same-origin asset and never a CDN", async () => {
    readBarcodes.mockResolvedValue([]);
    await readQrWithZxing(blankFrame());

    expect(prepareZXingModule).toHaveBeenCalledTimes(1);
    const options = prepareZXingModule.mock.calls[0][0] as {
      overrides?: { locateFile?: (p: string) => string };
    };
    const located = options.overrides?.locateFile?.("zxing_reader.wasm");

    expect(located).toBeDefined();
    // The service worker never caches cross-origin responses, so an absolute
    // remote URL here would silently break offline scanning.
    expect(located).not.toMatch(/^https?:\/\//);
    expect(located).not.toMatch(/jsdelivr|unpkg|cdn/i);
  });

  it("requests QR format only, with a single-symbol cap", async () => {
    readBarcodes.mockResolvedValue([]);
    await readQrWithZxing(blankFrame());

    const options = readBarcodes.mock.calls[0][1] as {
      formats: string[];
      maxNumberOfSymbols: number;
    };
    expect(options.formats).toEqual(["QRCode"]);
    expect(options.maxNumberOfSymbols).toBe(1);
  });
});
