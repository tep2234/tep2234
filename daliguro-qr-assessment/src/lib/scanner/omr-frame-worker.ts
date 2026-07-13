// Web Worker wrapper around the pure frame-analysis pipeline.
// The phone page transfers each camera frame's pixel buffer here so QR
// decoding and OMR (marker search, homography, bubble sampling) never block
// the main thread — camera preview and buttons stay responsive even on
// low-end phones. The page falls back to running the same pure module on the
// main thread if workers are unavailable.

import { analyzeFrameData } from "./mobile-analyze";

export interface FrameRequest {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  assessmentId: string;
  qrText: string | null;
  thoroughQr: boolean;
}

export interface FrameResponse {
  id: number;
  analysis: ReturnType<typeof analyzeFrameData>;
}

self.onmessage = (e: MessageEvent<FrameRequest>) => {
  const { id, buffer, width, height, assessmentId, qrText, thoroughQr } = e.data;
  const img = { data: new Uint8ClampedArray(buffer), width, height };
  const analysis = analyzeFrameData(img, assessmentId, qrText, thoroughQr);
  (self as unknown as Worker).postMessage({ id, analysis } satisfies FrameResponse);
};
