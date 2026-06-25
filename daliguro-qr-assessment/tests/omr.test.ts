import { describe, expect, it } from "vitest";
import {
  buildTemplate,
  chooseSheetSize,
  MARKER_RECTS,
  SHEET_H,
  SHEET_W,
} from "../src/lib/scanner/omr-template";
import {
  classifyItem,
  readSheet,
  type GrayImage,
  type ItemReading,
} from "../src/lib/scanner/omr-detect";
import { buildReview } from "../src/lib/scanner/omr-score";
import type { Item } from "../src/lib/types";

// ---- template ----------------------------------------------------------
describe("omr-template", () => {
  it("chooses the smallest fitting supported size", () => {
    expect(chooseSheetSize(8)).toBe(10);
    expect(chooseSheetSize(10)).toBe(10);
    expect(chooseSheetSize(11)).toBe(20);
    expect(chooseSheetSize(45)).toBe(50);
    expect(chooseSheetSize(999)).toBe(50);
  });
  it("lays out 4 bubbles per item and the right column count", () => {
    expect(buildTemplate(10).columns).toBe(1);
    expect(buildTemplate(50).columns).toBe(5);
    expect(buildTemplate(10).bubbles).toHaveLength(40);
    expect(buildTemplate(20).bubbles).toHaveLength(80);
  });
});

// ---- classification ----------------------------------------------------
describe("classifyItem", () => {
  it("selected: one clearly shaded with margin", () => {
    const r = classifyItem(1, [0.7, 0.1, 0.1, 0.1], 4);
    expect(r.status).toBe("selected");
    expect(r.detected).toBe("A");
    expect(r.confidence).toBeGreaterThan(0.5);
  });
  it("blank: nothing shaded", () => {
    expect(classifyItem(1, [0.08, 0.1, 0.05, 0.09], 4).status).toBe("blank");
  });
  it("multiple: two shaded", () => {
    const r = classifyItem(1, [0.7, 0.6, 0.05, 0.05], 4);
    expect(r.status).toBe("multiple");
    expect(r.detected).toBeNull();
  });
  it("unclear: faint single mark", () => {
    // 0.18 = between MARK_LO (0.12) and MARK_HI (0.25) → faint/ambiguous in adaptive world
    expect(classifyItem(1, [0.18, 0.1, 0.1, 0.1], 4).status).toBe("unclear");
  });
  it("unclear: two marks too close to separate", () => {
    expect(classifyItem(1, [0.5, 0.46, 0.1, 0.1], 4).status).toBe("multiple");
  });
  it("ignores choices beyond validChoices", () => {
    // D is dark but item only has 3 valid choices -> ignored.
    const r = classifyItem(1, [0.7, 0.1, 0.1, 0.9], 3);
    expect(r.detected).toBe("A");
    expect(r.status).toBe("selected");
  });
});

// ---- end-to-end read of a synthetic sheet ------------------------------
function blankSheet(): GrayImage {
  const data = new Uint8ClampedArray(SHEET_W * SHEET_H).fill(255);
  return { data, width: SHEET_W, height: SHEET_H };
}
function fillRect(g: GrayImage, x: number, y: number, w: number, h: number, v: number) {
  for (let yy = Math.floor(y); yy < y + h; yy += 1) {
    for (let xx = Math.floor(x); xx < x + w; xx += 1) {
      (g.data as Uint8ClampedArray)[yy * g.width + xx] = v;
    }
  }
}
function fillDisc(g: GrayImage, cx: number, cy: number, r: number, v: number) {
  for (let yy = Math.floor(cy - r); yy <= cy + r; yy += 1) {
    for (let xx = Math.floor(cx - r); xx <= cx + r; xx += 1) {
      if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) {
        (g.data as Uint8ClampedArray)[yy * g.width + xx] = v;
      }
    }
  }
}
function shade(g: GrayImage, t: ReturnType<typeof buildTemplate>, item: number, choiceIndex: number) {
  const b = t.bubbles.find((x) => x.item === item && x.choiceIndex === choiceIndex)!;
  fillDisc(g, b.cx, b.cy, b.r * 0.8, 0);
}

describe("readSheet (synthetic, already aligned)", () => {
  it("detects markers and reads shaded answers", () => {
    const t = buildTemplate(10);
    const g = blankSheet();
    MARKER_RECTS.forEach((m) => fillRect(g, m.x, m.y, m.w, m.h, 0));
    shade(g, t, 1, 0); // 1 -> A
    shade(g, t, 2, 2); // 2 -> C
    // item 3 left blank
    shade(g, t, 4, 0); // 4 -> A + B  => multiple
    shade(g, t, 4, 1);

    const res = readSheet(g, t);
    expect(res.aligned).toBe(true);
    expect(res.markersFound).toBe(4);
    expect(res.items[0]).toMatchObject({ detected: "A", status: "selected" });
    expect(res.items[1]).toMatchObject({ detected: "C", status: "selected" });
    expect(res.items[2].status).toBe("blank");
    expect(res.items[3].status).toBe("multiple");
  });

  it("reports not aligned when markers are missing", () => {
    const t = buildTemplate(10);
    const g = blankSheet(); // no markers drawn
    const res = readSheet(g, t);
    expect(res.aligned).toBe(false);
    expect(res.items).toHaveLength(0);
  });

  it("reads a sheet that floats in the frame (scaled + offset, not filling corners)", () => {
    const t = buildTemplate(10);
    // Bigger frame than the sheet; draw the sheet at 0.6x, offset into the middle.
    const W = 1400;
    const H = 1800;
    const g: GrayImage = { data: new Uint8ClampedArray(W * H).fill(255), width: W, height: H };
    const s = 0.6;
    const ox = 250;
    const oy = 300;
    const map = (x: number, y: number) => ({ x: ox + x * s, y: oy + y * s });
    // markers
    t.markerRects.forEach((m) => {
      const p = map(m.x, m.y);
      for (let yy = Math.floor(p.y); yy < p.y + m.w * s; yy += 1) {
        for (let xx = Math.floor(p.x); xx < p.x + m.w * s; xx += 1) {
          (g.data as Uint8ClampedArray)[yy * W + xx] = 0;
        }
      }
    });
    // shade item 5 -> B (choiceIndex 1), item 7 -> D (choiceIndex 3)
    const shadeAt = (item: number, ci: number) => {
      const b = t.bubbles.find((x) => x.item === item && x.choiceIndex === ci)!;
      const p = map(b.cx, b.cy);
      const r = b.r * s * 0.8;
      for (let yy = Math.floor(p.y - r); yy <= p.y + r; yy += 1) {
        for (let xx = Math.floor(p.x - r); xx <= p.x + r; xx += 1) {
          if ((xx - p.x) ** 2 + (yy - p.y) ** 2 <= r * r) (g.data as Uint8ClampedArray)[yy * W + xx] = 0;
        }
      }
    };
    shadeAt(5, 1);
    shadeAt(7, 3);

    const res = readSheet(g, t);
    expect(res.aligned).toBe(true);
    expect(res.items[4]).toMatchObject({ detected: "B", status: "selected" });
    expect(res.items[6]).toMatchObject({ detected: "D", status: "selected" });
    expect(res.items[0].status).toBe("blank");
  });
});

// ---- review + scoring --------------------------------------------------
function mcItem(n: number, id: string): Item {
  return {
    id,
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

describe("buildReview", () => {
  const items = [mcItem(1, "i1"), mcItem(2, "i2"), mcItem(3, "i3"), mcItem(4, "i4")];
  const key = { i1: "A", i2: "C", i3: "B", i4: "D" };
  const readings: ItemReading[] = [
    { item: 1, detected: "A", status: "selected", confidence: 0.9, fill: [0.7, 0, 0, 0] },
    { item: 2, detected: "C", status: "selected", confidence: 0.9, fill: [0, 0, 0.7, 0] },
    { item: 3, detected: null, status: "blank", confidence: 0.9, fill: [0, 0, 0, 0] },
    { item: 4, detected: null, status: "multiple", confidence: 0.2, fill: [0.7, 0.6, 0, 0] },
  ];

  it("scores selected items and flags review for multiple/unclear", () => {
    const r = buildReview(items, key, readings);
    expect(r.rawScore).toBe(2); // items 1 & 2 correct
    expect(r.correctCount).toBe(2);
    expect(r.multipleCount).toBe(1);
    expect(r.needsReview).toBe(true);
  });

  it("applies a teacher correction and clears review", () => {
    const r = buildReview(items, key, readings, { 4: "D" });
    expect(r.rawScore).toBe(3); // item 4 corrected to D (correct)
    expect(r.needsReview).toBe(false);
  });

  it("a correction to blank keeps the item unscored", () => {
    const r = buildReview(items, key, readings, { 1: "" });
    expect(r.rawScore).toBe(1); // item 1 now blank, only item 2 correct
  });
});
