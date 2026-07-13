// Pure frame-analysis pipeline shared by the phone's Web Worker and the
// main-thread fallback. These tests pin the guard rails (bad QR, wrong
// assessment, item-count, version mismatch) and the strict completeness
// contract, independent of any browser APIs.
import { describe, expect, it } from "vitest";
import { buildQrPayload, qrText as serializeQr } from "../src/lib/qr";
import { analyzeFrameData, isDoubtful, type FrameImage } from "../src/lib/scanner/mobile-analyze";
import { buildTemplate, MARKER_RECTS, SHEET_H, SHEET_W } from "../src/lib/scanner/omr-template";
import type { Learner, TestVersion } from "../src/lib/types";

function whiteRgba(width: number, height: number): FrameImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { data, width, height };
}

function fillRectRgba(img: FrameImage, x: number, y: number, w: number, h: number, v: number) {
  for (let yy = Math.floor(y); yy < y + h; yy += 1) {
    for (let xx = Math.floor(x); xx < x + w; xx += 1) {
      const i = (yy * img.width + xx) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
  }
}

function fillDiscRgba(img: FrameImage, cx: number, cy: number, r: number, v: number) {
  for (let yy = Math.floor(cy - r); yy <= cy + r; yy += 1) {
    for (let xx = Math.floor(cx - r); xx <= cx + r; xx += 1) {
      if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) {
        const i = (yy * img.width + xx) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
    }
  }
}

function drawRingRgba(img: FrameImage, cx: number, cy: number, r: number, v: number) {
  for (let yy = Math.floor(cy - r); yy <= cy + r; yy += 1) {
    for (let xx = Math.floor(cx - r); xx <= cx + r; xx += 1) {
      const distance = Math.hypot(xx - cx, yy - cy);
      if (distance >= r * 0.78 && distance <= r) {
        const i = (yy * img.width + xx) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
    }
  }
}

// Canonical-size sheet: markers + optional shaded bubbles + version bubble.
function syntheticSheet(items: number, version: "A" | "B" | null): FrameImage {
  const img = whiteRgba(SHEET_W, SHEET_H);
  for (let i = 0; i < img.data.length; i += 4) {
    // A photographed/printed sheet has fine paper and sensor texture. Keep
    // that texture bright enough to remain background while giving the focus
    // gate a realistic, deterministic edge signal.
    const x = (i / 4) % img.width;
    const paper = x % 2 === 0 ? 234 : 242;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = paper;
  }
  MARKER_RECTS.forEach((m) => fillRectRgba(img, m.x, m.y, m.w, m.h, 0));
  const t = buildTemplate(items);
  // Approximate the printed column/table edges so the synthetic fixture has
  // realistic sharp high-frequency structure for the focus safety gate.
  for (const x of [160, 320, 480, 640]) {
    fillRectRgba(img, x, 180, 2, SHEET_H - 360, 80);
  }
  t.bubbles.forEach((bubble) => drawRingRgba(img, bubble.cx, bubble.cy, bubble.r, 45));
  t.versionBubbles.forEach((bubble) => drawRingRgba(img, bubble.cx, bubble.cy, bubble.r, 45));
  const shade = (item: number, ci: number) => {
    const b = t.bubbles.find((x) => x.item === item && x.choiceIndex === ci)!;
    fillDiscRgba(img, b.cx, b.cy, b.r * 0.8, 0);
  };
  shade(1, 0);
  shade(items, 3);
  if (version) {
    const vb = t.versionBubbles.find((v) => v.version === version)!;
    fillDiscRgba(img, vb.cx, vb.cy, vb.r * 0.8, 0);
  }
  return img;
}

const testLearner: Learner = {
  id: "L1",
  lrn: "123456789012",
  fullName: "Learner One",
  sex: "F",
  gradeLevel: "10",
  section: "A",
};

const qrFor = (n: number, version: TestVersion = "A", assessment = "AX") =>
  serializeQr(buildQrPayload(assessment, testLearner, version, n));

describe("analyzeFrameData guard rails", () => {
  it("reports searching when no QR is present or provided", () => {
    const { result, qrText } = analyzeFrameData(whiteRgba(200, 200), "AX", null, false);
    expect(result.status).toBe("searching");
    expect(result.scan).toBeNull();
    expect(qrText).toBeNull();
  });

  it("rejects garbage QR text", () => {
    const { result } = analyzeFrameData(whiteRgba(200, 200), "AX", "not-json", false);
    expect(result.status).toBe("qr_error");
    expect(result.scan).toBeNull();
  });

  it("blocks a QR for a different assessment", () => {
    const { result } = analyzeFrameData(whiteRgba(200, 200), "AX", qrFor(10, "A", "OTHER"), false);
    expect(result.status).toBe("wrong_assessment");
  });

  it("blocks an unsupported item count", () => {
    const { result } = analyzeFrameData(whiteRgba(200, 200), "AX", qrFor(999), false);
    expect(result.status).toBe("qr_error");
  });

  it("blocks a sheet whose printed VERSION row disagrees with the QR", () => {
    const img = syntheticSheet(10, "B");
    const { result } = analyzeFrameData(img, "AX", qrFor(10, "A"), false);
    expect(result.status, JSON.stringify(result)).toBe("wrong_version");
    expect(result.scan).toBeNull();
  });
});

describe("isDoubtful blank handling", () => {
  it("flags a low-confidence blank (washed-out real mark) for review", () => {
    // Darkest bubble near the shade threshold → blank with weak confidence.
    expect(isDoubtful({ item: 1, answer: "", status: "blank", confidence: 0.4 })).toBe(true);
  });
  it("keeps a clean blank (near-zero darkness) out of review", () => {
    expect(isDoubtful({ item: 1, answer: "", status: "blank", confidence: 1 })).toBe(false);
  });
  it("still flags unclear, multiple, and weak selected reads", () => {
    expect(isDoubtful({ item: 1, answer: "A", status: "unclear", confidence: 0.4 })).toBe(true);
    expect(isDoubtful({ item: 1, answer: "", status: "multiple", confidence: 0.2 })).toBe(true);
    expect(isDoubtful({ item: 1, answer: "B", status: "selected", confidence: 0.5 })).toBe(true);
    expect(isDoubtful({ item: 1, answer: "B", status: "selected", confidence: 0.95 })).toBe(false);
  });
});

describe("analyzeFrameData complete coverage", () => {
  it("returns exactly items 1..N for a matching sheet", () => {
    const img = syntheticSheet(40, "A");
    const encodedQr = qrFor(40, "A");
    const { result, qrText } = analyzeFrameData(img, "AX", encodedQr, false);
    expect(qrText).toBe(encodedQr);
    expect(result.scan, JSON.stringify(result)).not.toBeNull();
    const detected = result.scan!.detected;
    expect(detected).toHaveLength(40);
    expect(detected.map((d) => d.item)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(detected[0]).toMatchObject({ answer: "A", status: "selected" });
    expect(detected[39]).toMatchObject({ answer: "D", status: "selected" });
    expect(result.scan!.totalItems).toBe(40);
  });
});
