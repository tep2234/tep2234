// ZXing WebAssembly QR fallback (R1).
//
// Where this sits in the cascade:
//   1. native window.BarcodeDetector  — page-side fast path, unchanged
//   2. THIS MODULE                    — ZXing WASM, lazy, once per session
//   3. jsQR preprocessing cascade     — unchanged final rescue (qr-detect.ts)
//
// Why it exists: without a native BarcodeDetector (iOS Safari < 17, Firefox
// Android) jsQR carries the entire decode load, and the iOS workaround runs the
// expensive multi-transform cascade on every eligible frame. ZXing performs the
// equivalent rotation/inversion/downscale search inside WASM at native speed.
//
// OFFLINE IS MANDATORY. zxing-wasm defaults `locateFile` to the jsDelivr CDN.
// The app's service worker deliberately never caches cross-origin responses
// (public/sw.js), so a CDN-hosted binary would be permanently unavailable
// offline — exactly when schools need it. The `?url` import below makes Vite
// emit the binary as a local, content-hashed, same-origin asset, which the
// service worker's cache-first rule then stores like any other asset.

// The decoder is imported DYNAMICALLY (see loadReader below) so neither the
// ~37 kB JS glue nor the ~1 MB binary lands in the scanner page's chunk. A
// phone with a native BarcodeDetector never downloads either.
//
// Vite rewrites this to a same-origin hashed asset URL and copies the binary
// into dist/assets. It is only a URL string, so importing it statically costs
// nothing and keeps the asset emitted for the service worker to cache.
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

type ZxingReader = typeof import("zxing-wasm/reader");

export interface ZxingFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// One instantiation per session, shared by every frame. Concurrent frames all
// await this same promise rather than each triggering a compile.
let modulePromise: Promise<ZxingReader> | null = null;
// Sticky disable: once instantiation has failed (no WASM support, blocked
// fetch, offline first-run) we stop retrying and let jsQR carry the load.
let unavailable = false;

// Diagnostics only. Never includes decoded payload text.
export interface ZxingDiagnostics {
  initCount: number;
  decodeCount: number;
  failureCount: number;
}

const diagnostics: ZxingDiagnostics = { initCount: 0, decodeCount: 0, failureCount: 0 };

export function zxingDiagnostics(): ZxingDiagnostics {
  return { ...diagnostics };
}

// Test-only reset so each case starts from a clean module state.
export function resetZxingForTests(): void {
  modulePromise = null;
  unavailable = false;
  diagnostics.initCount = 0;
  diagnostics.decodeCount = 0;
  diagnostics.failureCount = 0;
}

export function isZxingUnavailable(): boolean {
  return unavailable;
}

// Hosts the decoder must never be fetched from. zxing-wasm's own default
// `locateFile` points at jsDelivr, and `public/sw.js` deliberately declines to
// cache cross-origin responses — so a remote binary is unavailable offline
// exactly when a school needs it.
const FORBIDDEN_ASSET_HOSTS = /(^|\.)(jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)$/i;

export class RemoteWasmAssetError extends Error {
  constructor(url: string) {
    super(
      `Refusing to load the QR decoder from a remote origin (${url}). ` +
        "The WASM binary must be bundled and served from the application origin, " +
        "or offline scanning breaks. See CAMERA_SCANNER_KNOWN_FAILURES.md.",
    );
    this.name = "RemoteWasmAssetError";
  }
}

// The application-owned asset locator handed to zxing-wasm.
//
// This is deliberately more than a pass-through: it ENFORCES the offline
// contract at runtime. If a future refactor drops the override, changes the
// import, or points the asset at a CDN, this throws loudly at initialization
// instead of silently reintroducing a network dependency that only fails in the
// field, offline, in a classroom. Exported so tests exercise the real
// configuration rather than grepping the bundle for absent strings.
export function resolveZxingAssetUrl(assetUrl: string = zxingWasmUrl): string {
  if (!assetUrl) throw new RemoteWasmAssetError("(empty)");
  // Relative/root-relative paths are same-origin by construction.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(assetUrl)) return assetUrl;

  let parsed: URL;
  try {
    parsed = new URL(assetUrl);
  } catch {
    throw new RemoteWasmAssetError(assetUrl);
  }
  if (FORBIDDEN_ASSET_HOSTS.test(parsed.hostname)) throw new RemoteWasmAssetError(assetUrl);
  // An absolute URL is acceptable only when it matches the page's own origin
  // (the build can emit one when a base URL is configured). Outside a browser
  // (worker tests, SSR) there is no location to compare against, so fall back
  // to rejecting anything absolute that is not explicitly same-origin.
  const selfOrigin = typeof location !== "undefined" ? location.origin : "";
  if (selfOrigin && parsed.origin === selfOrigin) return assetUrl;
  throw new RemoteWasmAssetError(assetUrl);
}

// Resolves to the decoder module. The single cached promise means concurrent
// frames share one dynamic import AND one WASM instantiation.
function loadReader(): Promise<ZxingReader> {
  if (!modulePromise) {
    diagnostics.initCount += 1;
    modulePromise = import("zxing-wasm/reader").then(async (mod) => {
      await mod.prepareZXingModule({
        overrides: { locateFile: () => resolveZxingAssetUrl() },
        fireImmediately: true,
      });
      return mod;
    });
  }
  return modulePromise;
}

// Decode a QR from a raw RGBA frame. Returns the raw decoded text, or null.
//
// IMPORTANT: the returned string is UNTRUSTED. Callers must still run it
// through decodeQrPayload / assessment / learner / version validation exactly
// as a jsQR read is. A successful ZXing decode earns no extra trust.
export async function readQrWithZxing(img: ZxingFrame): Promise<string | null> {
  if (unavailable) return null;
  let reader: ZxingReader;
  try {
    reader = await loadReader();
  } catch {
    // Instantiation failed — disable permanently and fall through to jsQR.
    unavailable = true;
    modulePromise = null;
    diagnostics.failureCount += 1;
    return null;
  }
  try {
    const results = await reader.readBarcodes(
      // `ImageData["data"]` is typed `Uint8ClampedArray<ArrayBuffer>` while a
      // frame buffer is the wider `Uint8ClampedArray<ArrayBufferLike>`. Our
      // frames always come from canvas getImageData or a transferred
      // ArrayBuffer, never a SharedArrayBuffer, so the narrowing is sound.
      // Asserted rather than copied: a per-frame copy of a 1300px RGBA frame
      // would allocate several megabytes on every preview tick.
      {
        data: img.data as Uint8ClampedArray<ArrayBuffer>,
        width: img.width,
        height: img.height,
        // Structural ImageData also carries colorSpace. Canvas frames are sRGB.
        colorSpace: "srgb" as const,
      },
      {
        // QR only: this sheet has no other symbology, and narrowing the format
        // set keeps ZXing from searching for 1D codes in table texture.
        formats: ["QRCode"],
        // ZXing does rotation/inversion/downscale internally at WASM speed.
        // This is precisely the work the jsQR cascade does by hand in JS, so
        // enabling it here is what lets the expensive JS cascade be skipped.
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        tryDownscale: true,
        // The sheet carries exactly one QR; stopping at the first hit avoids
        // scanning the whole frame for additional symbols every frame.
        maxNumberOfSymbols: 1,
      },
    );
    diagnostics.decodeCount += 1;
    const text = results.find((r) => r.isValid && r.text)?.text;
    return text ?? null;
  } catch {
    // A per-frame decode error must never crash the preview. Drop this frame
    // and let the caller continue to the jsQR cascade.
    diagnostics.failureCount += 1;
    return null;
  }
}
