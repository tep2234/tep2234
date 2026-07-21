import {
  ScannerGeneration,
  ingestGalleryImage,
  inspectImageHeader,
  orientedDimensions,
  validateImageDimensions,
  type DecodedRaster,
  type ImageIngestionDiagnostic,
  type ImageIngestionResult,
  type RasterDecoderAdapter,
} from "../src/lib/scanner/image-ingestion";

interface HarnessResult {
  result: Omit<Extract<ImageIngestionResult, { ok: true }>, "image"> | Extract<ImageIngestionResult, { ok: false }>;
  samples?: Record<string, number[]>;
  diagnostic?: ImageIngestionDiagnostic;
}

const canvas = document.querySelector<HTMLCanvasElement>("#scanner-canvas")!;
const output = document.querySelector<HTMLElement>("#result")!;
const generation = new ScannerGeneration();
let resultCount = 0;

function rgbaAt(image: ImageData, xRatio: number, yRatio: number): number[] {
  const x = Math.min(image.width - 1, Math.max(0, Math.floor(image.width * xRatio)));
  const y = Math.min(image.height - 1, Math.max(0, Math.floor(image.height * yRatio)));
  const offset = (y * image.width + x) * 4;
  return Array.from(image.data.slice(offset, offset + 4));
}

async function processFile(file: File): Promise<HarnessResult> {
  const request = generation.begin();
  let diagnostic: ImageIngestionDiagnostic | undefined;
  const ingested = await ingestGalleryImage(file, canvas, request.signal, {
    onDiagnostic: (value) => { diagnostic = value; },
  });
  if (!generation.isCurrent(request.generation)) {
    return { result: { ok: false, code: "STALE_IMAGE_ANALYSIS", message: "stale" }, diagnostic };
  }
  if (!ingested.ok) return { result: ingested, diagnostic };
  const { image, ...result } = ingested;
  return {
    result,
    diagnostic,
    samples: {
      topLeft: rgbaAt(image, 0.1, 0.1),
      topRight: rgbaAt(image, 0.9, 0.1),
      bottomLeft: rgbaAt(image, 0.1, 0.9),
      bottomRight: rgbaAt(image, 0.9, 0.9),
      center: rgbaAt(image, 0.5, 0.5),
    },
  };
}

async function handleInput(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const value = await processFile(file);
  resultCount += 1;
  output.dataset.count = String(resultCount);
  output.textContent = JSON.stringify(value);
}

for (const id of ["take-photo", "existing-image"]) {
  const input = document.querySelector<HTMLInputElement>(`#${id}`)!;
  input.addEventListener("change", () => { void handleInput(input); });
}

async function cancelAfterBitmapAcquisition(file: File): Promise<{ result: ImageIngestionResult; closeCount: number }> {
  const controller = new AbortController();
  let closeCount = 0;
  const decoder: RasterDecoderAdapter = {
    async decode(source, _signal, orientationHandling): Promise<DecodedRaster> {
      const bitmap = await createImageBitmap(source, { imageOrientation: "none" });
      controller.abort();
      return {
        drawable: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        decoderType: "image-bitmap",
        orientationHandling,
        close: () => {
          closeCount += 1;
          bitmap.close();
        },
      };
    },
  };
  const result = await ingestGalleryImage(file, canvas, controller.signal, { decoder, onDiagnostic: () => undefined });
  return { result, closeCount };
}

async function fallbackDecode(file: File): Promise<{ result: ImageIngestionResult; revokeCount: number }> {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalRevoke = URL.revokeObjectURL.bind(URL);
  let revokeCount = 0;
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: undefined });
  URL.revokeObjectURL = (url: string) => {
    revokeCount += 1;
    originalRevoke(url);
  };
  try {
    const result = await ingestGalleryImage(file, canvas, new AbortController().signal, {
      onDiagnostic: () => undefined,
    });
    return { result, revokeCount };
  } finally {
    Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: originalCreateImageBitmap });
    URL.revokeObjectURL = originalRevoke;
  }
}

function inspectBytes(bytes: number[], mime: string) {
  const inspected = inspectImageHeader(new Uint8Array(bytes), mime);
  if ("ok" in inspected) return inspected;
  const dimensions = orientedDimensions(inspected.encodedWidth, inspected.encodedHeight, inspected.orientation);
  return validateImageDimensions(dimensions.width, dimensions.height) ?? inspected;
}

declare global {
  interface Window {
    scannerHarness: {
      processFile: typeof processFile;
      cancelAfterBitmapAcquisition: typeof cancelAfterBitmapAcquisition;
      fallbackDecode: typeof fallbackDecode;
      inspectBytes: typeof inspectBytes;
    };
  }
}

window.scannerHarness = { processFile, cancelAfterBitmapAcquisition, fallbackDecode, inspectBytes };
