import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { readQrSmart, type QrImage } from "../src/lib/scanner/qr-detect";

function rgbaFrame(width: number, height: number, value = 245): QrImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function rect(img: QrImage, x: number, y: number, w: number, h: number, v: number) {
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(img.height, y + h); yy += 1) {
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(img.width, x + w); xx += 1) {
      const i = (yy * img.width + xx) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
  }
}

function drawQr(img: QrImage, text: string, x: number, y: number, px: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  rect(img, x - px * 4, y - px * 4, (size + 8) * px, (size + 8) * px, 255);
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (qr.modules.data[r * size + c]) rect(img, x + c * px, y + r * px, px, px, 0);
    }
  }
}

describe("readQrSmart", () => {
  it("reads a sheet QR quickly from a noisy larger camera frame", () => {
    const payload = JSON.stringify({ assessmentId: "A1", learnerId: "L1", version: "A" });
    const img = rgbaFrame(1400, 1900, 238);

    // Simulate table texture and print artifacts outside the QR panel.
    for (let y = 20; y < img.height; y += 73) {
      for (let x = 25; x < img.width; x += 89) rect(img, x, y, 6, 6, 40);
    }
    // Simulate a white answer sheet occupying most of the frame.
    rect(img, 135, 90, 1100, 1640, 255);
    drawQr(img, payload, 240, 220, 5);

    const decoded = readQrSmart(img, true);
    expect(decoded?.data).toBe(payload);
    expect(decoded?.region).toMatch(/full|sheet|header|upper/);
  });
});
