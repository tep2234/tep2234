import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { buildQrPayload, qrText } from "../src/lib/qr";
import { parseQrPayload } from "../src/lib/qr-parse";
import {
  buildTemplate,
  MARKER_RECTS,
  QR_ZONE,
  SHEET_H,
  SHEET_W,
} from "../src/lib/scanner/omr-template";
import { readSheet, toGray } from "../src/lib/scanner/omr-detect";
import { buildReview } from "../src/lib/scanner/omr-score";
import type { Item, Learner } from "../src/lib/types";

// Render an RGBA image (white) we can draw onto.
function rgbaSheet(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}
function setPix(img: { data: Uint8ClampedArray; width: number }, x: number, y: number, v: number) {
  const i = (y * img.width + x) * 4;
  img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
}
function rect(img: { data: Uint8ClampedArray; width: number }, x: number, y: number, w: number, h: number, v: number) {
  for (let yy = Math.floor(y); yy < y + h; yy += 1)
    for (let xx = Math.floor(x); xx < x + w; xx += 1) setPix(img, xx, yy, v);
}
function disc(img: { data: Uint8ClampedArray; width: number }, cx: number, cy: number, r: number, v: number) {
  for (let yy = Math.floor(cy - r); yy <= cy + r; yy += 1)
    for (let xx = Math.floor(cx - r); xx <= cx + r; xx += 1)
      if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) setPix(img, xx, yy, v);
}

function mcItem(n: number): Item {
  return {
    id: "i" + n,
    assessmentId: "A1",
    itemNumber: n,
    type: "Multiple Choice",
    question: "Q" + n,
    correctAnswer: "",
    acceptedAnswers: [],
    points: 1,
    competency: "",
    difficulty: "Average",
    choices: 4,
  };
}

const learner: Learner = {
  id: "L1",
  lrn: "100000000001",
  fullName: "Dela Cruz, Juan",
  sex: "M",
  gradeLevel: "12",
  section: "Aristotle",
};

describe("OMR end-to-end on a rendered image", () => {
  it("decodes the QR, validates identity, reads bubbles, and scores", () => {
    const items = Array.from({ length: 10 }, (_, i) => mcItem(i + 1));
    const t = buildTemplate(10);
    const KEY = ["B", "C", "A", "D", "B", "C", "A", "D", "B", "C"];
    const key: Record<string, string> = {};
    items.forEach((it, i) => (key[it.id] = KEY[i]));

    const img = rgbaSheet(SHEET_W, SHEET_H);

    // 1) Render a REAL QR (identity only) into the QR zone, with a quiet zone.
    const payload = qrText(buildQrPayload("A1", learner, "A"));
    const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const mod = Math.floor(QR_ZONE.w / (size + 8)); // 4-module quiet zone each side
    const ox = Math.round(QR_ZONE.x + (QR_ZONE.w - mod * size) / 2);
    const oy = Math.round(QR_ZONE.y + (QR_ZONE.h - mod * size) / 2);
    for (let r = 0; r < size; r += 1)
      for (let c = 0; c < size; c += 1)
        if (qr.modules.data[r * size + c]) rect(img, ox + c * mod, oy + r * mod, mod, mod, 0);

    // 2) Corner markers.
    MARKER_RECTS.forEach((m) => rect(img, m.x, m.y, m.w, m.h, 0));

    // 3) Shade answers: items 1–8 correct, item 9 wrong (A vs key B), item 10 blank.
    const shadeLetter = ["B", "C", "A", "D", "B", "C", "A", "D", "A" /*wrong*/];
    shadeLetter.forEach((letter, i) => {
      const ci = ["A", "B", "C", "D"].indexOf(letter);
      const b = t.bubbles.find((x) => x.item === i + 1 && x.choiceIndex === ci)!;
      disc(img, b.cx, b.cy, b.r * 0.8, 0);
    });

    // --- run the SAME pipeline the app uses ---
    const decoded = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    expect(decoded?.data).toBe(payload); // QR really decodes from the image

    const parsed = parseQrPayload(decoded!.data, {
      activeAssessmentId: "A1",
      hasLearner: (id) => id === "L1",
      versions: ["A", "B"],
    });
    expect(parsed.ok).toBe(true);

    const reading = readSheet(toGray(img), t, {});
    expect(reading.aligned).toBe(true);

    const summary = buildReview(items, key, reading.items);
    expect(summary.rawScore).toBe(8);
    expect(summary.totalScore).toBe(10);
    expect(summary.blankCount).toBe(1);
    expect(summary.needsReview).toBe(false);
  });
});
