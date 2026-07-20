// QR print-density measurement + regression (SmartScan 98% mandate, phase B).
//
// Field failure being locked out: a real iPhone photo of a correctly printed
// sheet returned "No QR found". Root cause: the v2 JSON payload (~150 bytes)
// at ECC "Q" with a 2-module quiet zone prints a ~57-module symbol in the
// 210-unit QR zone — ~3 px/module at the phone pipeline's 1300 px analysis
// cap, below reliable jsQR decode once real optics (blur, noise) apply.
//
// This test renders BOTH print formats into the same simulated camera frame
// (sheet nearly filling a landscape capture, mild blur + deterministic sensor
// noise) across phone-realistic capture sizes, and measures decode success
// with the production reader (readQrSmart). It is the before/after evidence
// table for the V3 print change and a permanent regression gate: V3 must
// decode at every capture size, and must never do worse than v2.

import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { buildQrPayload, qrText, qrTextCompact } from "../src/lib/qr";
import { decodeQrPayload } from "../src/lib/qr-parse";
import { QR_ZONE, SHEET_H, SHEET_W } from "../src/lib/scanner/omr-template";
import { readQrSmart, type QrImage } from "../src/lib/scanner/qr-detect";
import type { Learner } from "../src/lib/types";

const LEARNER: Learner = {
  id: "L_k3v9tqx1ab",
  lrn: "136000000003",
  fullName: "Reyes, Pedro",
  sex: "M",
  gradeLevel: "11",
  section: "STEM-A",
};
const ASSESSMENT_ID = "A_m2p8wq04cd";
const ITEM_COUNT = 10;

const PAPER = 232;
const INK = 22;
const DESK = 205;

// The phone pipeline's analysis caps (SmartScanMobilePage): live/full analyze
// at 1300 minor-side px, final verified capture at 2200. 900 simulates a
// low-end camera or heavy downscale; 1600 the desktop still cap.
const CAPTURE_MINOR_SIDES = [900, 1100, 1300, 1600, 2200];

interface PrintSpec {
  label: string;
  text: string;
  ecc: "M" | "Q";
  quietModules: number;
}

function renderFrame(spec: PrintSpec, minorSide: number): QrImage {
  // Landscape 16:9-ish frame, upright sheet nearly filling frame height —
  // same geometry as the certified live-camera e2e harness.
  const H = minorSide;
  const W = Math.round((minorSide * 16) / 9);
  const S = (H - 40) / SHEET_H;
  const sheetW = Math.round(SHEET_W * S);
  const sheetH = Math.round(SHEET_H * S);
  const ox = Math.floor((W - sheetW) / 2);
  const oy = Math.floor((H - sheetH) / 2);

  const gray = new Float64Array(W * H).fill(DESK);
  for (let y = 0; y < sheetH; y += 1) {
    for (let x = 0; x < sheetW; x += 1) {
      gray[(y + oy) * W + (x + ox)] = PAPER;
    }
  }

  // Print the QR exactly as AnswerSheet does: modules fill QR_ZONE with the
  // spec's quiet zone counted inside the printed area (qrcode's `margin`).
  const qr = QRCode.create(spec.text, { errorCorrectionLevel: spec.ecc });
  const size = qr.modules.size;
  const total = size + 2 * spec.quietModules;
  const mod = (QR_ZONE.w * S) / total;
  const qx = ox + QR_ZONE.x * S + spec.quietModules * mod;
  const qy = oy + QR_ZONE.y * S + spec.quietModules * mod;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!qr.modules.data[r * size + c]) continue;
      const x0 = Math.round(qx + c * mod);
      const x1 = Math.round(qx + (c + 1) * mod);
      const y0 = Math.round(qy + r * mod);
      const y1 = Math.round(qy + (r + 1) * mod);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          gray[y * W + x] = INK;
        }
      }
    }
  }

  // Mild optics: 3x3 box blur — what a decent handheld capture does to sharp
  // print edges. Applied identically to both formats.
  const blurred = new Float64Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
          sum += gray[yy * W + xx];
          n += 1;
        }
      }
      blurred[y * W + x] = sum / n;
    }
  }

  // Deterministic sensor noise (LCG), same seed for both formats.
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    const v = Math.max(0, Math.min(255, Math.round(blurred[i] + (rand() - 0.5) * 8)));
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width: W, height: H };
}

describe("QR print density (v2 JSON vs V3 compact) under phone-realistic capture", () => {
  const payload = buildQrPayload(ASSESSMENT_ID, LEARNER, "A", ITEM_COUNT);
  const v2: PrintSpec = { label: "v2 JSON  ECC-Q quiet-2", text: qrText(payload), ecc: "Q", quietModules: 2 };
  const v3: PrintSpec = { label: "V3 short ECC-M quiet-4", text: qrTextCompact(payload), ecc: "M", quietModules: 4 };

  it("V3 payload stays within a compact 37-module symbol", () => {
    expect(v3.text.length).toBeLessThanOrEqual(80);
    expect(QRCode.create(v3.text, { errorCorrectionLevel: "M" }).modules.size).toBeLessThanOrEqual(37);
    // and it round-trips through the shared parser
    const decoded = decodeQrPayload(v3.text);
    expect(decoded.ok && decoded.payload.assessmentId).toBe(ASSESSMENT_ID);
    expect(decoded.ok && decoded.payload.learnerId).toBe(LEARNER.id);
  });

  // Renders + decodes 10 full camera frames — needs more than the 5s default
  // when the whole suite shares the machine.
  it("V3 decodes at every capture size and never does worse than v2", { timeout: 60_000 }, () => {
    const rows: string[] = [];
    let v2Wins = 0;
    let v3Wins = 0;
    for (const minor of CAPTURE_MINOR_SIDES) {
      const v2Hit = readQrSmart(renderFrame(v2, minor), true) !== null;
      const v3Hit = readQrSmart(renderFrame(v3, minor), true) !== null;
      if (v2Hit) v2Wins += 1;
      if (v3Hit) v3Wins += 1;
      rows.push(
        `${String(minor).padStart(5)}px  v2:${v2Hit ? "  decode" : "  FAIL  "}  V3:${v3Hit ? "  decode" : "  FAIL  "}`,
      );
      // Regression gates
      expect(v3Hit, `V3 must decode at ${minor}px minor side`).toBe(true);
      if (v2Hit) expect(v3Hit, `V3 must not regress vs v2 at ${minor}px`).toBe(true);
    }
    const v2Modules = QRCode.create(v2.text, { errorCorrectionLevel: "Q" }).modules.size;
    const v3Modules = QRCode.create(v3.text, { errorCorrectionLevel: "M" }).modules.size;

    console.info(
      [
        "",
        "QR print-density measurement (simulated handheld capture, 3x3 blur + noise)",
        `  v2 payload: ${v2.text.length} bytes -> ${v2Modules} modules (+2 quiet)`,
        `  V3 payload: ${v3.text.length} bytes -> ${v3Modules} modules (+4 quiet)`,
        ...rows.map((r) => "  " + r),
        `  decode rate: v2 ${v2Wins}/${CAPTURE_MINOR_SIDES.length}, V3 ${v3Wins}/${CAPTURE_MINOR_SIDES.length}`,
        "",
      ].join("\n"),
    );
    expect(v3Wins).toBeGreaterThanOrEqual(v2Wins);
  });

  it("old printed v2 sheets still decode through the shared parser (backward compatibility)", () => {
    const decoded = decodeQrPayload(v2.text);
    expect(decoded.ok && decoded.payload.learnerId).toBe(LEARNER.id);
    // and still read from a generous capture
    expect(readQrSmart(renderFrame(v2, 2200), true)).not.toBeNull();
  });
});
