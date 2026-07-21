// Phase D of the 98% mandate, verified end-to-end on rendered sheets:
//  1. Post-homography QR rescue — the marker-located QR zone is independently
//     decodable when it contains sufficient module detail.
//  2. Preserved answers — when the QR cannot be decoded at all, a cleanly
//     read sheet is NOT discarded: processStillImage returns "unidentified"
//     with the full reading, and completeUnidentifiedScan finishes it after
//     an explicit teacher learner selection (source: "manual").

import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { buildQrPayload, payloadChecksum, qrText } from "../src/lib/qr";
import { decodeQrPayload } from "../src/lib/qr-parse";
import {
  buildTemplate,
  MARKER_RECTS,
  QR_ZONE,
  SHEET_H,
  SHEET_W,
} from "../src/lib/scanner/omr-template";
import { readQrSmart, readQrWholeFrame } from "../src/lib/scanner/qr-detect";
import {
  QR_ZONE_RESCUE_LIMITS,
  readQrFromSheetZone,
} from "../src/lib/scanner/qr-zone-rescue";
import { findCornerMarkers, toGray } from "../src/lib/scanner/omr-detect";
import {
  completeUnidentifiedScan,
  processStillImage,
} from "../src/lib/scanner/still-pipeline";
import { analyzeFrameData } from "../src/lib/scanner/mobile-analyze";
import type { Item, Learner, QrAssessmentState } from "../src/lib/types";

const PAPER = 232;
const INK = 22;
const OUTLINE = 95;

interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function sheet(w: number, h: number): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = PAPER;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}
function setPix(img: Raster, x: number, y: number, v: number) {
  if (x < 0 || y < 0 || x >= img.width) return;
  const i = (y * img.width + x) * 4;
  if (i < 0 || i >= img.data.length) return;
  img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
}
function rect(img: Raster, x: number, y: number, w: number, h: number, v: number) {
  for (let yy = Math.floor(y); yy < y + h; yy += 1)
    for (let xx = Math.floor(x); xx < x + w; xx += 1) setPix(img, xx, yy, v);
}
function disc(img: Raster, cx: number, cy: number, r: number, v: number) {
  for (let yy = Math.floor(cy - r); yy <= cy + r; yy += 1)
    for (let xx = Math.floor(cx - r); xx <= cx + r; xx += 1)
      if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) setPix(img, xx, yy, v);
}
function ring(img: Raster, cx: number, cy: number, r: number, v: number, thickness: number) {
  const rOut = r + thickness / 2;
  const rIn = r - thickness / 2;
  for (let yy = Math.floor(cy - rOut); yy <= cy + rOut; yy += 1)
    for (let xx = Math.floor(cx - rOut); xx <= cx + rOut; xx += 1) {
      const d2 = (xx - cx) ** 2 + (yy - cy) ** 2;
      if (d2 <= rOut * rOut && d2 >= rIn * rIn) setPix(img, xx, yy, v);
    }
}

const SHADED = ["B", "C", "A", "D", "B", "C", "A", "D", "B", "C"];

// Render a complete sheet at scale S. `qrSpec: null` prints NO QR at all.
export function renderSheetForProbe(S: number, qrSpec: { text: string; ecc: "M" | "Q" } | null): Raster {
  return renderSheet(S, qrSpec);
}
function renderSheet(S: number, qrSpec: { text: string; ecc: "M" | "Q" } | null): Raster {
  const img = sheet(Math.round(SHEET_W * S), Math.round(SHEET_H * S));
  const t = buildTemplate(10);

  if (qrSpec) {
    const qr = QRCode.create(qrSpec.text, { errorCorrectionLevel: qrSpec.ecc });
    const size = qr.modules.size;
    const mod = Math.max(1, Math.floor((QR_ZONE.w * S) / (size + 8)));
    const ox = Math.round(QR_ZONE.x * S + (QR_ZONE.w * S - mod * size) / 2);
    const oy = Math.round(QR_ZONE.y * S + (QR_ZONE.h * S - mod * size) / 2);
    for (let r = 0; r < size; r += 1)
      for (let c = 0; c < size; c += 1)
        if (qr.modules.data[r * size + c]) rect(img, ox + c * mod, oy + r * mod, mod, mod, INK);
  }

  MARKER_RECTS.forEach((m) => rect(img, m.x * S, m.y * S, m.w * S, m.h * S, INK));
  t.bubbles.forEach((b) => ring(img, b.cx * S, b.cy * S, b.r * S, OUTLINE, Math.max(2, 2 * S)));
  t.versionBubbles.forEach((v) => ring(img, v.cx * S, v.cy * S, v.r * S, OUTLINE, Math.max(2, 2 * S)));

  const vb = t.versionBubbles.find((v) => v.version === "A")!;
  disc(img, vb.cx * S, vb.cy * S, vb.r * S * 0.8, INK);
  SHADED.forEach((letter, i) => {
    const ci = ["A", "B", "C", "D", "E"].indexOf(letter);
    const b = t.bubbles.find((x) => x.item === i + 1 && x.choiceIndex === ci)!;
    disc(img, b.cx * S, b.cy * S, b.r * S * 0.8, INK);
  });

  // Deterministic sensor noise so the blur gate sees camera-like texture.
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.max(0, Math.min(255, img.data[i] + Math.round((rand() - 0.5) * 8)));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  return img;
}

function asImageData(img: Raster): ImageData {
  return { ...img, colorSpace: "srgb" } as ImageData;
}

function placeOnDesk(source: Raster, width = 1600, height = 900): Raster {
  const framed = sheet(width, height);
  let seed = 0xdecafbad;
  for (let i = 0; i < framed.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const texture = 201 + (seed % 9);
    framed.data[i] = framed.data[i + 1] = framed.data[i + 2] = texture;
  }
  const ox = Math.floor((width - source.width) / 2);
  const oy = Math.floor((height - source.height) / 2);
  for (let y = 0; y < source.height; y += 1) {
    const src = y * source.width * 4;
    const dst = ((oy + y) * width + ox) * 4;
    framed.data.set(source.data.subarray(src, src + source.width * 4), dst);
  }
  return framed;
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

function fixedPayload(): string {
  const securityToken = "L1A-0123456789ABCDEF";
  return qrText({
    ...buildQrPayload("A1", learner, "A", 10),
    securityToken,
    checksum: payloadChecksum("A1", learner.id, "A", securityToken, 10),
  });
}

function stateOf(): QrAssessmentState {
  const items = Array.from({ length: 10 }, (_, i) => mcItem(i + 1));
  const key: Record<string, string> = {};
  items.forEach((it, i) => (key[it.id] = SHADED[i]));
  return {
    assessments: [
      {
        id: "A1",
        title: "T",
        subject: "Math",
        gradeLevel: "12",
        section: "Aristotle",
        schoolYear: "2025-2026",
        term: "First",
        component: "Written Work",
        versions: ["A", "B"],
        teacherName: "T",
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    items,
    learners: [learner],
    answerKeys: { A1: { A: key } },
    results: [],
  };
}

describe("still pipeline QR rescue + preserved answers", { timeout: 60_000 }, () => {
  it("keeps QR-zone rescue bounded on a marker-located QR miss", () => {
    expect(QR_ZONE_RESCUE_LIMITS).toEqual({
      minSide: 256,
      maxSide: 512,
      maxDecodeAttempts: 2,
    });
    const noQr = renderSheet(1, null);
    const corners = findCornerMarkers(toGray(asImageData(noQr)));
    expect(corners).not.toBeNull();
    const started = performance.now();
    expect(corners && readQrFromSheetZone(noQr, corners)).toBeNull();
    // This specifically guards the small zone decoder. The broader still-image
    // pipeline has separate work and is intentionally outside this budget.
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  it("decodes a recoverable marker-located QR zone", () => {
    const payload = fixedPayload();
    const recoverable = renderSheet(1, { text: payload, ecc: "Q" });
    const corners = findCornerMarkers(toGray(asImageData(recoverable)));
    expect(corners).not.toBeNull();
    expect(corners && readQrFromSheetZone(recoverable, corners)?.data).toBe(payload);
  });

  it("proves whole-frame failure followed by exact validated zone rescue", () => {
    const payload = fixedPayload();
    const candidates = [0.42, 0.46, 0.5, 0.54, 0.58, 0.62].map((scale) => {
      const image = placeOnDesk(renderSheet(scale, { text: payload, ecc: "Q" }));
      const whole = readQrWholeFrame(image)?.data ?? null;
      const corners = findCornerMarkers(toGray(asImageData(image)));
      const zone = corners ? readQrFromSheetZone(image, corners)?.data ?? null : null;
      const analysis = analyzeFrameData(asImageData(image), "A1", null, true);
      return { scale, image, whole, corners: Boolean(corners), zone, analysis };
    });
    const fixture = candidates.find((candidate) =>
      !candidate.whole &&
      candidate.zone === payload &&
      candidate.analysis.qrSource === "zone-rescue" &&
      candidate.analysis.result.scan,
    );
    expect(
      fixture,
      "fixture set must contain a real whole-frame miss recoverable from the sheet zone: " +
        JSON.stringify(candidates.map(({ scale, whole, corners, zone, analysis }) => ({
          scale,
          whole: Boolean(whole),
          corners,
          zone: Boolean(zone),
          source: analysis.qrSource,
          status: analysis.result.status,
        }))),
    ).toBeDefined();
    const img = fixture?.image;
    if (!img) return;
    expect(readQrWholeFrame(img)).toBeNull();

    const analysis = fixture.analysis;
    expect(analysis.qrSource).toBe("zone-rescue");
    expect(analysis.qrText).toBe(payload);
    expect(decodeQrPayload(analysis.qrText ?? "")).toMatchObject({ ok: true });
    expect(analysis.result.scan?.detected.map((item) => item.answer)).toEqual(SHADED);
    expect(analysis.qrText).not.toBe(payload + "-mutated");
  });

  it("preserves a cleanly read sheet when no QR exists, then completes via explicit teacher identification", () => {
    const img = renderSheet(1, null);
    expect(readQrSmart(img, true)).toBeNull();
    const corners = findCornerMarkers(toGray(asImageData(img)));
    expect(corners && readQrFromSheetZone(img, corners)).toBeNull();

    const state = stateOf();
    const originalResults = state.results.slice();
    const out = processStillImage(asImageData(img), state, "A1", null, "manual-capture");
    expect(out.kind).toBe("unidentified");
    if (out.kind !== "unidentified") return;
    expect(out.preserved.version).toBe("A");
    expect(out.preserved.assessmentId).toBe("A1");
    expect(out.preserved.reading.items.filter((i) => i.status === "selected").length).toBe(10);
    expect(out.preserved.reading.items.map((item) => item.detected)).toEqual(SHADED);
    expect(state.results).toEqual(originalResults);

    // Teacher explicitly identifies the learner -> scored, attributable result.
    const done = completeUnidentifiedScan(out.preserved, state, "L1", null, "manual-capture");
    expect(done.kind).toBe("ready");
    if (done.kind !== "ready") return;
    expect(done.result.source).toBe("manual");
    expect(done.result.learner.id).toBe("L1");
    expect(done.result.summary.rawScore).toBe(10);
    expect(done.result.summary.totalScore).toBe(10);

    // Same-count edits/reorders must not silently pair old positional marks
    // with a different current item template.
    state.items[0] = { ...state.items[0], question: "Changed after capture" };
    const stale = completeUnidentifiedScan(out.preserved, state, "L1", null, "manual-capture");
    expect(stale).toMatchObject({ kind: "image", reasonCodes: ["ITEM_TEMPLATE_MISMATCH"] });
  });

  it("never guesses identity: unknown learner selection fails safely", () => {
    const img = renderSheet(1, null);
    const state = stateOf();
    const out = processStillImage(asImageData(img), state, "A1", null, "gallery");
    expect(out.kind).toBe("unidentified");
    if (out.kind !== "unidentified") return;
    const done = completeUnidentifiedScan(out.preserved, state, "L_nope", null, "gallery");
    expect(done.kind).toBe("image");
  });
});
