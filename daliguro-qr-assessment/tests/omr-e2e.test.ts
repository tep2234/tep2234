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

// The sheet is rendered at 2x canonical scale, imitating a hi-res photo, so
// the (denser) v2 QR gets enough pixels per module to decode with jsQR.
const S = 2;

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
    topic: "",
    difficulty: "Average",
    cognitiveLevel: "",
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

describe("OMR end-to-end on a rendered image (SmartScan v2 sheet)", () => {
  it("decodes the QR, verifies the checksum, reads bubbles + version, and scores", () => {
    const items = Array.from({ length: 10 }, (_, i) => mcItem(i + 1));
    const t = buildTemplate(10);
    const KEY = ["B", "C", "A", "D", "B", "C", "A", "D", "B", "C"];
    const key: Record<string, string> = {};
    items.forEach((it, i) => (key[it.id] = KEY[i]));

    const img = rgbaSheet(SHEET_W * S, SHEET_H * S);

    // 1) Render a REAL QR (identity only, with checksum + item count) into
    //    the QR zone, with a quiet zone.
    const payload = qrText(buildQrPayload("A1", learner, "A", items.length));
    const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const mod = Math.floor((QR_ZONE.w * S) / (size + 8)); // 4-module quiet zone each side
    const ox = Math.round(QR_ZONE.x * S + (QR_ZONE.w * S - mod * size) / 2);
    const oy = Math.round(QR_ZONE.y * S + (QR_ZONE.h * S - mod * size) / 2);
    for (let r = 0; r < size; r += 1)
      for (let c = 0; c < size; c += 1)
        if (qr.modules.data[r * size + c]) rect(img, ox + c * mod, oy + r * mod, mod, mod, 0);

    // 2) Corner markers (solid at print size; knockout is cosmetic-safe).
    MARKER_RECTS.forEach((m) => rect(img, m.x * S, m.y * S, m.w * S, m.h * S, 0));

    // 3) Pre-shaded version bubble (A), as the printer does.
    const vb = t.versionBubbles.find((v) => v.version === "A")!;
    disc(img, vb.cx * S, vb.cy * S, vb.r * S * 0.8, 0);

    // 4) Shade answers: items 1–8 correct, item 9 wrong (A vs key B), item 10 blank.
    const shadeLetter = ["B", "C", "A", "D", "B", "C", "A", "D", "A" /*wrong*/];
    shadeLetter.forEach((letter, i) => {
      const ci = ["A", "B", "C", "D", "E"].indexOf(letter);
      const b = t.bubbles.find((x) => x.item === i + 1 && x.choiceIndex === ci)!;
      disc(img, b.cx * S, b.cy * S, b.r * S * 0.8, 0);
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
    if (parsed.ok) expect(parsed.payload.n).toBe(10);

    const reading = readSheet(toGray(img), t, {});
    expect(reading.aligned).toBe(true);
    // Layer-2 identity: the shaded version row matches the QR's version.
    expect(reading.version.detected).toBe("A");

    const summary = buildReview(items, key, reading.items);
    expect(summary.rawScore).toBe(8);
    expect(summary.totalScore).toBe(10);
    expect(summary.blankCount).toBe(1);
    expect(summary.needsReview).toBe(false);
  });
});
