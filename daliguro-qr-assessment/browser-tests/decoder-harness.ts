// Browser harness for the REAL zxing-wasm decoder.
//
// Unit tests mock `zxing-wasm/reader`, which certifies our cascade and trust
// gate but proves nothing about the decoder itself. This harness runs the
// actual WASM binary in a real browser against QR images rendered from the real
// DALIguro encoder, so Playwright can assert both decode behaviour and the
// network origin the binary was fetched from.
//
// Everything here is synthetic: a fixed fake learner and assessment. No student
// data, no real tokens.

import QRCode from "qrcode";
import { buildQrPayload, qrText } from "../src/lib/qr";
import { decodeQrPayload } from "../src/lib/qr-parse";
import { analyzeFrameAsync } from "../src/lib/scanner/analyze-frame";
import { readQrWithZxing, zxingDiagnostics, resetZxingForTests } from "../src/lib/scanner/zxing-qr";
import type { Learner } from "../src/lib/types";

const ASSESSMENT_ID = "A1";

const LEARNER: Learner = {
  id: "L1",
  lrn: "100000000001",
  fullName: "Synthetic, Fixture",
  sex: "M",
  gradeLevel: "12",
  section: "Aristotle",
};

const canvas = document.querySelector<HTMLCanvasElement>("#qr-canvas")!;

export type Degradation =
  | "none"
  | "small"
  | "rotated"
  | "low-contrast"
  | "grayscale"
  | "blurred"
  | "shadowed";

interface RenderOptions {
  text: string;
  moduleSize?: number;
  quietZone?: number;
  degradation?: Degradation;
}

// Draw a QR to the canvas and return its ImageData, optionally degraded to
// mimic a real handheld photo.
function renderQr(options: RenderOptions): ImageData {
  const { text, degradation = "none" } = options;
  const moduleSize = options.moduleSize ?? (degradation === "small" ? 3 : 8);
  const quiet = options.quietZone ?? 4;

  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const symbolSide = (size + quiet * 2) * moduleSize;
  const rotated = degradation === "rotated";
  // A rotation inside a canvas the same size as the symbol clips the corners
  // and destroys the finder patterns. Enlarge the canvas so the whole rotated
  // symbol fits: a square of side S rotated by θ needs S*(|cosθ|+|sinθ|).
  const angle = rotated ? (15 * Math.PI) / 180 : 0;
  const side = rotated
    ? Math.ceil(symbolSide * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle))))
    : symbolSide;
  canvas.width = side;
  canvas.height = side;

  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, side, side);

  if (rotated) {
    // Rotate about the canvas centre, then draw the symbol centred within it.
    ctx.translate(side / 2, side / 2);
    ctx.rotate(angle);
    ctx.translate(-symbolSide / 2, -symbolSide / 2);
  }

  // Low contrast models faded toner / bad photocopy; the modules stay dark
  // enough for a good decoder but wash out a naive threshold.
  const dark = degradation === "low-contrast" ? "#6e6e6e" : "#000000";
  const light = degradation === "low-contrast" ? "#c8c8c8" : "#ffffff";
  // Fill the SYMBOL's own background (including its quiet zone) in the current
  // — possibly rotated — frame. Filling the whole canvas here would paint a
  // rotated square and leave stray white wedges in the corners.
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, symbolSide, symbolSide);
  ctx.fillStyle = dark;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (qr.modules.data[r * size + c]) {
        ctx.fillRect((c + quiet) * moduleSize, (r + quiet) * moduleSize, moduleSize, moduleSize);
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (degradation === "shadowed") {
    // A soft shadow falling across one corner, as a hand or head casts on a
    // sheet. Kept partial and graded: a decoder with a local/adaptive binarizer
    // should handle this, and that capability is precisely what this fixture is
    // meant to exercise. A full-frame heavy wash would test nothing but the
    // fixture's own severity.
    const gradient = ctx.createLinearGradient(0, 0, side * 0.7, side * 0.7);
    gradient.addColorStop(0, "rgba(0,0,0,0.35)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, side, side);
  }

  let image = ctx.getImageData(0, 0, side, side);
  if (degradation === "grayscale") image = toGrayscale(image);
  if (degradation === "blurred") image = boxBlur(image, 1);
  return image;
}

function toGrayscale(image: ImageData): ImageData {
  const out = new Uint8ClampedArray(image.data);
  for (let i = 0; i < out.length; i += 4) {
    const y = Math.round(out[i] * 0.299 + out[i + 1] * 0.587 + out[i + 2] * 0.114);
    out[i] = out[i + 1] = out[i + 2] = y;
  }
  return new ImageData(out, image.width, image.height);
}

// Small separable box blur — enough to defeat a brittle decoder without
// destroying the symbol.
function boxBlur(image: ImageData, radius: number): ImageData {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = Math.min(width - 1, Math.max(0, x + dx));
          const sy = Math.min(height - 1, Math.max(0, y + dy));
          const i = (sy * width + sx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return new ImageData(out, width, height);
}

export interface DecodeReport {
  text: string | null;
  matchedExpected: boolean;
  payloadValid: boolean;
  initCount: number;
  decodeCount: number;
  failureCount: number;
  elapsedMs: number;
}

// Decode a freshly rendered QR with the REAL WASM decoder.
async function decodeRendered(
  degradation: Degradation,
  overrides: { assessmentId?: string; learnerId?: string; items?: number } = {},
): Promise<DecodeReport> {
  const learner = overrides.learnerId ? { ...LEARNER, id: overrides.learnerId } : LEARNER;
  const payload = buildQrPayload(
    overrides.assessmentId ?? ASSESSMENT_ID,
    learner,
    "A",
    overrides.items ?? 10,
  );
  const expected = qrText(payload);
  const image = renderQr({ text: expected, degradation });

  const started = performance.now();
  const text = await readQrWithZxing(image);
  const elapsedMs = performance.now() - started;
  const diagnostics = zxingDiagnostics();

  return {
    text,
    matchedExpected: text === expected,
    payloadValid: text ? decodeQrPayload(text).ok : false,
    initCount: diagnostics.initCount,
    decodeCount: diagnostics.decodeCount,
    failureCount: diagnostics.failureCount,
    elapsedMs,
  };
}

// Decode arbitrary raw text (used for malformed / tampered payload cases).
async function decodeRawText(raw: string): Promise<DecodeReport> {
  const image = renderQr({ text: raw });
  const started = performance.now();
  const text = await readQrWithZxing(image);
  const elapsedMs = performance.now() - started;
  const diagnostics = zxingDiagnostics();
  return {
    text,
    matchedExpected: text === raw,
    payloadValid: text ? decodeQrPayload(text).ok : false,
    initCount: diagnostics.initCount,
    decodeCount: diagnostics.decodeCount,
    failureCount: diagnostics.failureCount,
    elapsedMs,
  };
}

// Run the full cascade (trust gate included) over a rendered QR, so the browser
// can prove an invalid payload is rejected end to end rather than just decoded.
async function analyzeRendered(
  raw: string,
  assessmentId = ASSESSMENT_ID,
): Promise<{ qrSource: string | null; scanIsNull: boolean; reasonCodes: string[] }> {
  const image = renderQr({ text: raw });
  const analysis = await analyzeFrameAsync(image, assessmentId, null, false);
  return {
    qrSource: analysis.qrSource,
    scanIsNull: analysis.result.scan === null,
    reasonCodes: analysis.result.reasonCodes ?? [],
  };
}

// Simulate the NATIVE BarcodeDetector fast path: the caller already has an
// identity, so `analyzeFrameAsync` must skip ZXing entirely and never fetch the
// binary. Returns the attribution plus decoder diagnostics.
async function analyzeWithNativeResult(
  raw: string,
  assessmentId = ASSESSMENT_ID,
): Promise<{ qrSource: string | null; scanIsNull: boolean; initCount: number; decodeCount: number }> {
  const image = renderQr({ text: raw });
  const analysis = await analyzeFrameAsync(image, assessmentId, raw, false);
  const diagnostics = zxingDiagnostics();
  return {
    qrSource: analysis.qrSource,
    scanIsNull: analysis.result.scan === null,
    initCount: diagnostics.initCount,
    decodeCount: diagnostics.decodeCount,
  };
}

// Report where the worker script itself was loaded from, so a test can prove
// the worker is same-origin and not pulled from a CDN.
function workerAssetOrigin(): { url: string; sameOrigin: boolean } {
  const worker = new Worker(
    new URL("../src/lib/scanner/omr-frame-worker.ts", import.meta.url),
    { type: "module" },
  );
  const url = new URL("../src/lib/scanner/omr-frame-worker.ts", import.meta.url).href;
  worker.terminate();
  return { url, sameOrigin: url.startsWith(location.origin) };
}

// Fire several decodes concurrently to prove one shared initialization.
async function decodeConcurrently(count: number): Promise<DecodeReport> {
  const payload = qrText(buildQrPayload(ASSESSMENT_ID, LEARNER, "A", 10));
  const image = renderQr({ text: payload });
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: count }, () => readQrWithZxing(image)),
  );
  const elapsedMs = performance.now() - started;
  const diagnostics = zxingDiagnostics();
  return {
    text: results[0],
    matchedExpected: results.every((r) => r === payload),
    payloadValid: true,
    initCount: diagnostics.initCount,
    decodeCount: diagnostics.decodeCount,
    failureCount: diagnostics.failureCount,
    elapsedMs,
  };
}

function buildValidPayloadText(overrides: { assessmentId?: string; learnerId?: string } = {}): string {
  const learner = overrides.learnerId ? { ...LEARNER, id: overrides.learnerId } : LEARNER;
  return qrText(buildQrPayload(overrides.assessmentId ?? ASSESSMENT_ID, learner, "A", 10));
}

function buildTamperedPayloadText(mutate: Record<string, unknown>): string {
  return JSON.stringify({ ...buildQrPayload(ASSESSMENT_ID, LEARNER, "A", 10), ...mutate });
}

declare global {
  interface Window {
    decoderHarness: {
      decodeRendered: typeof decodeRendered;
      decodeRawText: typeof decodeRawText;
      analyzeRendered: typeof analyzeRendered;
      analyzeWithNativeResult: typeof analyzeWithNativeResult;
      workerAssetOrigin: typeof workerAssetOrigin;
      decodeConcurrently: typeof decodeConcurrently;
      buildValidPayloadText: typeof buildValidPayloadText;
      buildTamperedPayloadText: typeof buildTamperedPayloadText;
      diagnostics: typeof zxingDiagnostics;
      reset: typeof resetZxingForTests;
    };
  }
}

window.decoderHarness = {
  decodeRendered,
  decodeRawText,
  analyzeRendered,
  analyzeWithNativeResult,
  workerAssetOrigin,
  decodeConcurrently,
  buildValidPayloadText,
  buildTamperedPayloadText,
  diagnostics: zxingDiagnostics,
  reset: resetZxingForTests,
};

document.querySelector<HTMLElement>("#ready")!.textContent = "ready";
