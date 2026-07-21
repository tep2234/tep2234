// Async frame-analysis entry point that inserts the ZXing WASM decoder tier
// between the caller's native BarcodeDetector fast path and the synchronous
// jsQR cascade inside analyzeFrameData (R1).
//
// Both the Web Worker (normal path) and the main-thread fallback (when workers
// are unavailable) call THIS function, so the decoder cascade is identical on
// every device and there is only one place the trust gate can be bypassed.
//
// Cascade:
//   qrText != null              -> caller already has a native BarcodeDetector
//                                  hit; ZXing is skipped entirely and the WASM
//                                  binary is never even fetched.
//   qrText == null              -> try ZXing WASM. Accept its read ONLY if it
//                                  parses as a well-formed identity payload.
//   still nothing               -> analyzeFrameData runs the untouched jsQR
//                                  preprocessing cascade as the final rescue.

import { decodeQrPayload } from "../qr-parse";
import { analyzeFrameData, type FrameAnalysis, type FrameImage } from "./mobile-analyze";
import { readQrWithZxing } from "./zxing-qr";

export async function analyzeFrameAsync(
  img: FrameImage,
  assessmentId: string,
  qrText: string | null,
  thoroughQr: boolean,
): Promise<FrameAnalysis> {
  if (qrText) {
    // Native BarcodeDetector already identified the sheet. Do not pay for WASM.
    return analyzeFrameData(img, assessmentId, qrText, thoroughQr, "provided");
  }

  const zxingText = await readQrWithZxing(img);

  // TRUST GATE — deliberately mirrors the `accept()` rule inside
  // analyzeFrameData. A ZXing decode is a *candidate*, not an identity. If it
  // does not parse into a well-formed payload we discard it and fall through to
  // the jsQR cascade, exactly as a bad jsQR read would. Passing an unparseable
  // string through as `qrText` would short-circuit the rescue path and surface
  // a sticky "invalid QR" banner — the precise bug the accept() gate fixed.
  //
  // Note this only checks that the payload is well-formed. Assessment, learner,
  // version, item-count and printed-VERSION-row cross-checks all still run
  // inside analyzeDecodedFrame. Nothing here grants a ZXing read any trust that
  // a jsQR read would not receive.
  if (zxingText && decodeQrPayload(zxingText).ok) {
    return analyzeFrameData(img, assessmentId, zxingText, thoroughQr, "zxing-wasm");
  }

  return analyzeFrameData(img, assessmentId, null, thoroughQr);
}
