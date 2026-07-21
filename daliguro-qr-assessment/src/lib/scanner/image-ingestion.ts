// Authoritative gallery/file ingestion boundary. It validates bytes before
// decode, normalizes EXIF orientation, bounds memory, and owns all temporary
// decoder resources. Scanner pipelines receive only verified RGBA pixels.

export type SupportedRasterFormat = "jpeg" | "png";

export type ImageIngestionRejectionCode =
  | "EMPTY_IMAGE_FILE"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "IMAGE_TYPE_MISMATCH"
  | "IMAGE_FILE_TOO_LARGE"
  | "IMAGE_STRUCTURE_INVALID"
  | "IMAGE_DIMENSIONS_TOO_SMALL"
  | "IMAGE_DIMENSIONS_TOO_LARGE"
  | "IMAGE_DECODE_FAILED"
  | "IMAGE_NORMALIZATION_FAILED"
  | "IMAGE_ORIENTATION_FAILED"
  | "IMAGE_ANALYSIS_CANCELLED"
  | "STALE_IMAGE_ANALYSIS";

export interface ImageIngestionFailure {
  ok: false;
  code: ImageIngestionRejectionCode;
  message: string;
}

export interface ImageIngestionSuccess {
  ok: true;
  image: ImageData;
  evidence: string | null;
  format: SupportedRasterFormat;
  orientation: number;
  originalWidth: number;
  originalHeight: number;
  normalizedWidth: number;
  normalizedHeight: number;
}

export type ImageIngestionResult = ImageIngestionSuccess | ImageIngestionFailure;

export const IMAGE_INGESTION_POLICY = {
  maximumFileBytes: 15 * 1024 * 1024,
  minimumShortEdge: 720,
  minimumLongEdge: 960,
  maximumDimension: 8192,
  maximumPixels: 32_000_000,
  maximumAnalysisEdge: 2200,
} as const;

interface HeaderInspection {
  format: SupportedRasterFormat;
  orientation: number;
  encodedWidth: number;
  encodedHeight: number;
}

interface JpegSegment {
  marker: number;
  start: number;
  end: number;
  hasExifSignature: boolean;
}

interface ParsedJpeg {
  width: number;
  height: number;
  orientation: number;
  segments: JpegSegment[];
}

function failure(
  code: ImageIngestionRejectionCode,
  message: string,
): ImageIngestionFailure {
  return { ok: false, code, message };
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function structureFailure(message: string): ImageIngestionFailure {
  return failure("IMAGE_STRUCTURE_INVALID", message);
}

function safeEnd(offset: number, length: number, total: number): number | null {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length < 0) return null;
  const end = offset + length;
  return Number.isSafeInteger(end) && end >= offset && end <= total ? end : null;
}

function uint16(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint16(offset, littleEndian);
}

function parseJpegExifOrientation(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = view.getUint16(offset + 2, false);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (
      marker === 0xe1 && length >= 10 &&
      bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78 &&
      bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66
    ) {
      const segmentEnd = offset + 2 + length;
      const tiff = offset + 10;
      if (tiff + 8 > segmentEnd) return null;
      const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
      if (!little && !big) return null;
      if (uint16(view, tiff + 2, little) !== 0x002a) return null;
      const firstIfdOffset = view.getUint32(tiff + 4, little);
      const firstIfd = safeEnd(tiff, firstIfdOffset, segmentEnd);
      if (firstIfd === null || firstIfd + 2 > segmentEnd) return null;
      const entries = uint16(view, firstIfd, little);
      for (let index = 0; index < entries; index += 1) {
        const entry = firstIfd + 2 + index * 12;
        if (entry + 12 > segmentEnd) return null;
        if (uint16(view, entry, little) === 0x0112) {
          if (uint16(view, entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) return null;
          const orientation = uint16(view, entry + 8, little);
          return orientation >= 1 && orientation <= 8 ? orientation : null;
        }
      }
    }
    offset += 2 + length;
  }
  return 1;
}

export function readJpegExifOrientation(bytes: Uint8Array): number {
  return parseJpegExifOrientation(bytes) ?? 1;
}

function parseJpegStructure(bytes: Uint8Array): ParsedJpeg | ImageIngestionFailure {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;
  const segments: JpegSegment[] = [];
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return structureFailure("The JPEG marker sequence is malformed.");
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return structureFailure("The JPEG ends inside a marker.");
    const markerStart = offset - 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00) return structureFailure("The JPEG contains an invalid stuffed marker before image data.");
    if (marker === 0xd9) return structureFailure("The JPEG ended before scan data was found.");
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) return structureFailure("The JPEG scan header is truncated.");
      const scanLength = view.getUint16(offset, false);
      if (scanLength < 2) return structureFailure("The JPEG scan header length is invalid.");
      const scanEnd = safeEnd(offset, scanLength, bytes.length);
      if (scanEnd === null) return structureFailure("The JPEG scan header exceeds the file boundary.");
      if (!dimensions) return structureFailure("The JPEG does not contain a supported baseline or progressive SOF segment.");
      let hasEoi = false;
      for (let index = scanEnd; index + 1 < bytes.length; index += 1) {
        if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
          hasEoi = true;
          break;
        }
      }
      if (!hasEoi) return structureFailure("The JPEG image data is truncated before its end marker.");
      const orientation = parseJpegExifOrientation(bytes);
      if (orientation === null) return structureFailure("The JPEG Exif orientation metadata is malformed.");
      return {
        ...dimensions,
        orientation,
        segments,
      };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      return structureFailure("The JPEG contains an unexpected standalone marker before scan data.");
    }
    if (offset + 2 > bytes.length) return structureFailure("A JPEG segment length is truncated.");
    // offset points immediately after the marker code; the two-byte length is
    // included in the segment length.
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2) return structureFailure("A JPEG segment has an invalid length.");
    const segmentEnd = safeEnd(offset, segmentLength, bytes.length);
    if (segmentEnd === null) return structureFailure("A JPEG segment exceeds the file boundary.");
    const hasExifSignature = marker === 0xe1 && segmentLength >= 8 &&
      bytes[offset + 2] === 0x45 && bytes[offset + 3] === 0x78 &&
      bytes[offset + 4] === 0x69 && bytes[offset + 5] === 0x66 &&
      bytes[offset + 6] === 0x00 && bytes[offset + 7] === 0x00;
    segments.push({ marker, start: markerStart, end: segmentEnd, hasExifSignature });
    if (marker === 0xc0 || marker === 0xc2) {
      if (dimensions) return structureFailure("The JPEG contains multiple supported SOF segments.");
      if (segmentLength < 8) return structureFailure("The JPEG SOF segment is truncated.");
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      if (width === 0 || height === 0) return structureFailure("The JPEG SOF dimensions must be non-zero.");
      dimensions = { width, height };
    } else if ([0xc1, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return structureFailure("This JPEG compression type is not supported. Use baseline or progressive JPEG.");
    }
    offset = segmentEnd;
  }
  return structureFailure("The JPEG is truncated before scan data and its end marker.");
}

function parsePngStructure(bytes: Uint8Array): HeaderInspection | ImageIngestionFailure {
  if (bytes.length < 33) return structureFailure("The PNG header is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIdat = false;
  let sawIend = false;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return structureFailure("A PNG chunk header is truncated.");
    const length = view.getUint32(offset, false);
    const dataStart = offset + 8;
    const dataEnd = safeEnd(dataStart, length, bytes.length);
    if (dataEnd === null || dataEnd + 4 > bytes.length) {
      return structureFailure("A PNG chunk exceeds the file boundary.");
    }
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) return structureFailure("The PNG must begin with a valid IHDR chunk.");
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      if (width === 0 || height === 0) return structureFailure("The PNG IHDR dimensions must be non-zero.");
    } else if (type === "IHDR") {
      return structureFailure("The PNG contains more than one IHDR chunk.");
    }
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") {
      if (length !== 0) return structureFailure("The PNG IEND chunk must be empty.");
      sawIend = true;
      if (dataEnd + 4 !== bytes.length) return structureFailure("The PNG contains data after its IEND chunk.");
      break;
    }
    offset = dataEnd + 4;
    chunkIndex += 1;
  }
  if (!sawIdat || !sawIend) return structureFailure("The PNG is missing required image data or its end marker.");
  return { format: "png", orientation: 1, encodedWidth: width, encodedHeight: height };
}

export function sanitizeJpegExif(bytes: Uint8Array): Uint8Array {
  const parsed = parseJpegStructure(bytes);
  if ("ok" in parsed) throw new Error(parsed.message);
  const removed = parsed.segments.filter((segment) => segment.hasExifSignature);
  if (removed.length === 0) return bytes.slice();
  const parts: Uint8Array[] = [];
  let cursor = 0;
  for (const segment of removed) {
    parts.push(bytes.subarray(cursor, segment.start));
    cursor = segment.end;
  }
  parts.push(bytes.subarray(cursor));
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const sanitized = new Uint8Array(total);
  let writeAt = 0;
  for (const part of parts) {
    sanitized.set(part, writeAt);
    writeAt += part.byteLength;
  }
  return sanitized;
}

export function inspectImageHeader(
  bytes: Uint8Array,
  declaredMime = "",
): HeaderInspection | ImageIngestionFailure {
  let inspected: HeaderInspection;
  if (isPng(bytes)) {
    const parsed = parsePngStructure(bytes);
    if ("ok" in parsed) return parsed;
    inspected = parsed;
  } else if (isJpeg(bytes)) {
    const parsed = parseJpegStructure(bytes);
    if ("ok" in parsed) return parsed;
    inspected = {
      format: "jpeg",
      orientation: parsed.orientation,
      encodedWidth: parsed.width,
      encodedHeight: parsed.height,
    };
  } else {
    return failure(
      "UNSUPPORTED_IMAGE_FORMAT",
      "Only genuine JPEG and PNG raster images are supported. SVG, GIF, documents, and unknown files are rejected.",
    );
  }
  const expectedMime = inspected.format === "jpeg" ? "image/jpeg" : "image/png";
  if (declaredMime && declaredMime.toLowerCase() !== expectedMime) {
    return failure(
      "IMAGE_TYPE_MISMATCH",
      `The file content is ${expectedMime}, but the browser reported ${declaredMime}. Choose the original JPEG or PNG file.`,
    );
  }
  return inspected;
}

export function orientedDimensions(
  width: number,
  height: number,
  orientation: number,
): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

export function validateImageDimensions(
  width: number,
  height: number,
): ImageIngestionFailure | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return failure("IMAGE_DECODE_FAILED", "The image has invalid decoded dimensions.");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)) {
    return failure("IMAGE_DIMENSIONS_TOO_LARGE", "The encoded image dimensions exceed safe arithmetic limits.");
  }
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  if (
    shortEdge < IMAGE_INGESTION_POLICY.minimumShortEdge ||
    longEdge < IMAGE_INGESTION_POLICY.minimumLongEdge
  ) {
    return failure(
      "IMAGE_DIMENSIONS_TOO_SMALL",
      `The image is ${width}×${height}. Use at least ${IMAGE_INGESTION_POLICY.minimumShortEdge}px on the short edge and ${IMAGE_INGESTION_POLICY.minimumLongEdge}px on the long edge.`,
    );
  }
  if (
    width > IMAGE_INGESTION_POLICY.maximumDimension ||
    height > IMAGE_INGESTION_POLICY.maximumDimension ||
    pixels > IMAGE_INGESTION_POLICY.maximumPixels
  ) {
    return failure(
      "IMAGE_DIMENSIONS_TOO_LARGE",
      `The decoded image is ${width}×${height}, which exceeds the safe ${IMAGE_INGESTION_POLICY.maximumDimension}px / ${Math.round(IMAGE_INGESTION_POLICY.maximumPixels / 1_000_000)}MP limit.`,
    );
  }
  return null;
}

export function compositeImageDataOntoWhite(image: ImageData): ImageData {
  const { data } = image;
  for (let offset = 0; offset + 3 < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha === 255) continue;
    if (alpha === 0) {
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
    } else {
      const inverse = 255 - alpha;
      data[offset] = Math.round((data[offset] * alpha + 255 * inverse) / 255);
      data[offset + 1] = Math.round((data[offset + 1] * alpha + 255 * inverse) / 255);
      data[offset + 2] = Math.round((data[offset + 2] * alpha + 255 * inverse) / 255);
    }
    data[offset + 3] = 255;
  }
  return image;
}

function applyExifTransform(
  context: CanvasRenderingContext2D,
  orientation: number,
  width: number,
  height: number,
): void {
  switch (orientation) {
    case 2: context.transform(-1, 0, 0, 1, width, 0); break;
    case 3: context.transform(-1, 0, 0, -1, width, height); break;
    case 4: context.transform(1, 0, 0, -1, 0, height); break;
    case 5: context.transform(0, 1, 1, 0, 0, 0); break;
    case 6: context.transform(0, 1, -1, 0, height, 0); break;
    case 7: context.transform(0, -1, -1, 0, height, width); break;
    case 8: context.transform(0, -1, 1, 0, 0, width); break;
    default: break;
  }
}

export class ScannerGeneration {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): { generation: number; signal: AbortSignal } {
    this.controller?.abort();
    this.controller = new AbortController();
    this.generation += 1;
    return { generation: this.generation, signal: this.controller.signal };
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation && this.controller?.signal.aborted === false;
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.generation += 1;
  }
}

export type RasterDecoderType = "image-bitmap" | "image-element";
export type OrientationHandlingStatus = "metadata-sanitized" | "orientation-not-required";

export interface DecodedRaster {
  drawable: CanvasImageSource;
  width: number;
  height: number;
  decoderType: RasterDecoderType;
  orientationHandling: OrientationHandlingStatus;
  close: () => void;
}

export interface RasterDecoderAdapter {
  decode(source: Blob, signal: AbortSignal, orientationHandling: OrientationHandlingStatus): Promise<DecodedRaster>;
}

export interface ImageIngestionOptions {
  decoder?: RasterDecoderAdapter;
  onDiagnostic?: (diagnostic: ImageIngestionDiagnostic) => void;
}

export interface ImageIngestionDiagnostic {
  rejectionReasonCode?: ImageIngestionRejectionCode;
  decoderPath?: RasterDecoderType;
  encodedDimensions?: { width: number; height: number };
  decodedDimensions?: { width: number; height: number };
  exifOrientation?: number;
  decodeDurationMs?: number;
  normalizationDurationMs?: number;
  analysisDurationMs?: number;
  cancellationStage?: "before-read" | "after-read" | "decode" | "after-decode";
  capabilities: {
    createImageBitmap: boolean;
    objectUrl: boolean;
    imageElement: boolean;
  };
}

function once(operation: () => void): () => void {
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    operation();
  };
}

function abortError(): DOMException {
  return new DOMException("Image analysis cancelled", "AbortError");
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function publishDiagnostic(
  options: ImageIngestionOptions,
  diagnostic: ImageIngestionDiagnostic,
): void {
  options.onDiagnostic?.(diagnostic);
  if (import.meta.env.DEV && !options.onDiagnostic) {
    console.info("[gallery-image-ingestion]", diagnostic);
  }
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function assertDecoderContract(decoded: DecodedRaster): void {
  if (
    !decoded ||
    !decoded.drawable ||
    !Number.isFinite(decoded.width) ||
    !Number.isFinite(decoded.height) ||
    typeof decoded.close !== "function" ||
    !["image-bitmap", "image-element"].includes(decoded.decoderType) ||
    !["metadata-sanitized", "orientation-not-required"].includes(decoded.orientationHandling)
  ) {
    throw new TypeError("The browser decoder returned an invalid raster resource contract");
  }
}

function validateDecoderMetadata(
  inspected: HeaderInspection,
  decoded: DecodedRaster,
): ImageIngestionFailure | null {
  if (inspected.format === "jpeg" && decoded.orientationHandling !== "metadata-sanitized") {
    return failure(
      "IMAGE_ORIENTATION_FAILED",
      "The browser decoder could not prove that the photo orientation was preserved for safe normalization.",
    );
  }
  if (
    inspected.encodedWidth !== null &&
    inspected.encodedHeight !== null &&
    (decoded.width !== inspected.encodedWidth || decoded.height !== inspected.encodedHeight)
  ) {
    return failure(
      inspected.orientation === 1 ? "IMAGE_DECODE_FAILED" : "IMAGE_ORIENTATION_FAILED",
      "The decoded image dimensions do not match its encoded metadata, so the image cannot be normalized safely.",
    );
  }
  return null;
}

async function decodeBrowserRaster(
  source: Blob,
  signal: AbortSignal,
  orientationHandling: OrientationHandlingStatus,
): Promise<DecodedRaster> {
  if (signal.aborted) throw abortError();
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(source, { imageOrientation: "none" });
    const closeBitmap = once(() => {
      if (typeof bitmap.close === "function") bitmap.close();
    });
    if (signal.aborted) {
      closeBitmap();
      throw abortError();
    }
    return {
      drawable: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      decoderType: "image-bitmap",
      orientationHandling,
      close: closeBitmap,
    };
  }
  // JPEG EXIF metadata is removed before this boundary, so fallback image
  // elements cannot apply an orientation behind the scanner's back.
  const url = URL.createObjectURL(source);
  const image = new Image();
  const revokeUrl = once(() => URL.revokeObjectURL(url));
  const closeImage = once(() => {
    image.onload = null;
    image.onerror = null;
    image.src = "";
  });
  let ownershipTransferred = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (operation: () => void) => {
        signal.removeEventListener("abort", abort);
        image.onload = null;
        image.onerror = null;
        operation();
      };
      const abort = () => finish(() => reject(abortError()));
      signal.addEventListener("abort", abort, { once: true });
      image.onload = () => finish(resolve);
      image.onerror = () => finish(() => reject(new Error("Image decoder rejected the file")));
      image.src = url;
    });
    if (signal.aborted) throw abortError();
    const decoded: DecodedRaster = {
      drawable: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      decoderType: "image-element",
      orientationHandling,
      close: closeImage,
    };
    ownershipTransferred = true;
    return decoded;
  } finally {
    revokeUrl();
    if (!ownershipTransferred) closeImage();
  }
}

export const browserRasterDecoder: RasterDecoderAdapter = {
  decode: decodeBrowserRaster,
};

export async function ingestGalleryImage(
  file: File,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  options: ImageIngestionOptions = {},
): Promise<ImageIngestionResult> {
  const diagnostic: ImageIngestionDiagnostic = {
    capabilities: {
      createImageBitmap: typeof createImageBitmap === "function",
      objectUrl: typeof URL?.createObjectURL === "function",
      imageElement: typeof Image === "function",
    },
  };
  let diagnosticPublished = false;
  const complete = (
    result: ImageIngestionResult,
    cancellationStage?: ImageIngestionDiagnostic["cancellationStage"],
  ): ImageIngestionResult => {
    if (!result.ok) diagnostic.rejectionReasonCode = result.code;
    if (cancellationStage) diagnostic.cancellationStage = cancellationStage;
    if (!diagnosticPublished) {
      diagnosticPublished = true;
      publishDiagnostic(options, diagnostic);
    }
    return result;
  };
  if (file.size === 0) return complete(failure("EMPTY_IMAGE_FILE", "The selected file is empty."));
  if (file.size > IMAGE_INGESTION_POLICY.maximumFileBytes) {
    return complete(failure(
      "IMAGE_FILE_TOO_LARGE",
      `The image is larger than the safe ${IMAGE_INGESTION_POLICY.maximumFileBytes / 1024 / 1024} MB limit.`,
    ));
  }
  if (signal.aborted) {
    return complete(failure("IMAGE_ANALYSIS_CANCELLED", "Image analysis was cancelled."), "before-read");
  }
  let decoded: DecodedRaster;
  let releaseDecoded: (() => void) | null = null;
  try {
    let header: Uint8Array;
    try {
      header = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (isAbortError(error, signal)) {
        return complete(failure("IMAGE_ANALYSIS_CANCELLED", "Image analysis was cancelled."), "before-read");
      }
      return complete(failure("IMAGE_DECODE_FAILED", "The browser could not read the selected image file."));
    }
    if (signal.aborted) {
      return complete(failure("IMAGE_ANALYSIS_CANCELLED", "Image analysis was cancelled."), "after-read");
    }
    const inspected = inspectImageHeader(header, file.type);
    if ("ok" in inspected) return complete(inspected);
    diagnostic.encodedDimensions = { width: inspected.encodedWidth, height: inspected.encodedHeight };
    diagnostic.exifOrientation = inspected.orientation;
    const encodedDimensions = orientedDimensions(
      inspected.encodedWidth,
      inspected.encodedHeight,
      inspected.orientation,
    );
    const encodedFailure = validateImageDimensions(encodedDimensions.width, encodedDimensions.height);
    if (encodedFailure) return complete(encodedFailure);
    const orientationHandling: OrientationHandlingStatus = inspected.format === "jpeg"
      ? "metadata-sanitized"
      : "orientation-not-required";
    let decodeSource: Blob = file;
    if (inspected.format === "jpeg") {
      const sanitized = sanitizeJpegExif(header);
      const ownedSanitized = new Uint8Array(sanitized.byteLength);
      ownedSanitized.set(sanitized);
      decodeSource = new Blob([ownedSanitized.buffer], { type: "image/jpeg" });
    }
    const decodeStartedAt = now();
    try {
      decoded = await (options.decoder ?? browserRasterDecoder).decode(
        decodeSource,
        signal,
        orientationHandling,
      );
      if (decoded && typeof decoded.close === "function") {
        releaseDecoded = once(decoded.close);
      }
      assertDecoderContract(decoded);
      diagnostic.decodeDurationMs = Math.round((now() - decodeStartedAt) * 100) / 100;
      diagnostic.decoderPath = decoded.decoderType;
      diagnostic.decodedDimensions = { width: decoded.width, height: decoded.height };
    } catch (error) {
      diagnostic.decodeDurationMs = Math.round((now() - decodeStartedAt) * 100) / 100;
      if (isAbortError(error, signal)) {
        return complete(failure("IMAGE_ANALYSIS_CANCELLED", "Image analysis was cancelled."), "decode");
      }
      return complete(failure("IMAGE_DECODE_FAILED", "The file is corrupt, incomplete, or could not be decoded as an image."));
    }
    if (signal.aborted) {
      return complete(failure("IMAGE_ANALYSIS_CANCELLED", "Image analysis was cancelled."), "after-decode");
    }
    const decoderMetadataFailure = validateDecoderMetadata(inspected, decoded);
    if (decoderMetadataFailure) return complete(decoderMetadataFailure);
    const normalized = orientedDimensions(decoded.width, decoded.height, inspected.orientation);
    const dimensionFailure = validateImageDimensions(normalized.width, normalized.height);
    if (dimensionFailure) return complete(dimensionFailure);
    const scale = Math.min(1, IMAGE_INGESTION_POLICY.maximumAnalysisEdge / Math.max(normalized.width, normalized.height));
    const outputWidth = Math.max(1, Math.round(normalized.width * scale));
    const outputHeight = Math.max(1, Math.round(normalized.height * scale));
    let image: ImageData;
    const normalizationStartedAt = now();
    try {
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D context is unavailable");
      context.save();
      try {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, outputWidth, outputHeight);
        context.scale(scale, scale);
        applyExifTransform(context, inspected.orientation, decoded.width, decoded.height);
        context.drawImage(decoded.drawable, 0, 0, decoded.width, decoded.height);
      } finally {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.restore();
      }
      image = compositeImageDataOntoWhite(context.getImageData(0, 0, outputWidth, outputHeight));
      diagnostic.normalizationDurationMs = Math.round((now() - normalizationStartedAt) * 100) / 100;
    } catch {
      diagnostic.normalizationDurationMs = Math.round((now() - normalizationStartedAt) * 100) / 100;
      return complete(failure(
        "IMAGE_NORMALIZATION_FAILED",
        "The browser could not safely normalize this image for scanning.",
      ));
    }
    let evidence: string | null = null;
    try {
      evidence = canvas.toDataURL("image/jpeg", 0.68);
    } catch {
      evidence = null;
    }
    return complete({
      ok: true,
      image,
      evidence,
      format: inspected.format,
      orientation: inspected.orientation,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      normalizedWidth: outputWidth,
      normalizedHeight: outputHeight,
    });
  } catch (error) {
    if (isAbortError(error, signal)) {
      return complete(failure("IMAGE_ANALYSIS_CANCELLED", "Image analysis was cancelled."), "decode");
    }
    return complete(failure("IMAGE_DECODE_FAILED", "The file is corrupt, incomplete, or could not be decoded as an image."));
  } finally {
    try {
      releaseDecoded?.();
    } catch { /* cleanup must never replace the primary result */ }
    try {
      canvas.width = 1;
      canvas.height = 1;
    } catch { /* cleanup must never replace the primary result */ }
  }
}
