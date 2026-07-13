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
  ensureCompleteItems,
  findCornerMarkers,
  readSheet,
  type GrayImage,
  type ItemReading,
} from "../src/lib/scanner/omr-detect";
import { buildReview } from "../src/lib/scanner/omr-score";
import type { Item } from "../src/lib/types";

// ---- template (v2: fixed 4×20 grid, 5 choices, version bubbles) ---------
describe("omr-template", () => {
  it("chooses the smallest fitting usage bucket", () => {
    expect(chooseSheetSize(8)).toBe(20);
    expect(chooseSheetSize(20)).toBe(20);
    expect(chooseSheetSize(21)).toBe(40);
    expect(chooseSheetSize(45)).toBe(60);
    expect(chooseSheetSize(999)).toBe(80);
  });
  it("lays out 5 bubbles per item on a fixed 4-column grid", () => {
    expect(buildTemplate(10).columns).toBe(4);
    expect(buildTemplate(80).columns).toBe(4);
    expect(buildTemplate(10).bubbles).toHaveLength(50);
    expect(buildTemplate(80).bubbles).toHaveLength(400);
  });
  it("bubble positions are independent of the active item count", () => {
    const small = buildTemplate(10);
    const full = buildTemplate(80);
    const b10 = small.bubbles.find((b) => b.item === 10 && b.choiceIndex === 4)!;
    const b10full = full.bubbles.find((b) => b.item === 10 && b.choiceIndex === 4)!;
    expect(b10.cx).toBe(b10full.cx);
    expect(b10.cy).toBe(b10full.cy);
  });
  it("exposes 4 shade-one version bubbles", () => {
    const t = buildTemplate(10);
    expect(t.versionBubbles.map((v) => v.version)).toEqual(["A", "B", "C", "D"]);
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
  it("selected: dark marks read confidently", () => {
    const r = classifyItem(1, [0.05, 0.88, 0.04, 0.04], 4);
    expect(r.status).toBe("selected");
    expect(r.detected).toBe("B");
    expect(r.confidence).toBeGreaterThan(0.9);
  });
  it("selected: faint but very clearly-separated single mark is accepted", () => {
    // 0.22 = still below the strong-shade threshold but isolated enough from
    // the runner-up to trust.
    const r = classifyItem(1, [0.22, 0.08, 0.08, 0.08], 4);
    expect(r.status).toBe("selected");
    expect(r.detected).toBe("A");
  });
  it("unclear: faint mark with a close runner-up stays for review", () => {
    // top 0.18, runner-up 0.14 (gap < MARGIN) → genuinely ambiguous.
    expect(classifyItem(1, [0.18, 0.14, 0.1, 0.1], 4).status).toBe("unclear");
  });
  it("unclear: faint separated mark is retained as a suggestion instead of auto-scored", () => {
    const r = classifyItem(1, [0.18, 0.08, 0.08, 0.08], 4);
    expect(r.status).toBe("unclear");
    expect(r.detected).toBe("A");
  });
  it("unclear: erased or smudged marks do not become trusted answers", () => {
    const r = classifyItem(1, [0.15, 0.13, 0.11, 0.1], 4);
    expect(r.status).toBe("unclear");
    expect(r.detected).toBe("A");
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
function fillMappedRect(
  g: GrayImage,
  map: (x: number, y: number) => { x: number; y: number },
  x: number,
  y: number,
  w: number,
  h: number,
  v: number,
) {
  const p0 = map(x, y);
  const p1 = map(x + w, y + h);
  const left = Math.floor(Math.min(p0.x, p1.x));
  const right = Math.ceil(Math.max(p0.x, p1.x));
  const top = Math.floor(Math.min(p0.y, p1.y));
  const bottom = Math.ceil(Math.max(p0.y, p1.y));
  for (let yy = top; yy < bottom; yy += 1) {
    if (yy < 0 || yy >= g.height) continue;
    for (let xx = left; xx < right; xx += 1) {
      if (xx < 0 || xx >= g.width) continue;
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
  it("detects markers, reads shaded answers, and reads the version bubble", () => {
    const t = buildTemplate(10);
    const g = blankSheet();
    MARKER_RECTS.forEach((m) => fillRect(g, m.x, m.y, m.w, m.h, 0));
    shade(g, t, 1, 0); // 1 -> A
    shade(g, t, 2, 2); // 2 -> C
    // item 3 left blank
    shade(g, t, 4, 0); // 4 -> A + B  => multiple
    shade(g, t, 4, 1);
    // shade version B
    const vb = t.versionBubbles.find((v) => v.version === "B")!;
    fillDisc(g, vb.cx, vb.cy, vb.r * 0.8, 0);

    const res = readSheet(g, t);
    expect(res.aligned).toBe(true);
    expect(res.markersFound).toBe(4);
    expect(res.version.detected).toBe("B");
    expect(res.items[0]).toMatchObject({ detected: "A", status: "selected" });
    expect(res.items[1]).toMatchObject({ detected: "C", status: "selected" });
    expect(res.items[2].status).toBe("blank");
    expect(res.items[3].status).toBe("multiple");
  });

  it("reports no version when the version row is left blank", () => {
    const t = buildTemplate(10);
    const g = blankSheet();
    MARKER_RECTS.forEach((m) => fillRect(g, m.x, m.y, m.w, m.h, 0));
    const res = readSheet(g, t);
    expect(res.version.detected).toBeNull();
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

  it("ignores dark table texture and reads target-style corner markers", () => {
    const t = buildTemplate(10);
    const W = 1200;
    const H = 1700;
    const g: GrayImage = { data: new Uint8ClampedArray(W * H).fill(238), width: W, height: H };

    // Dark table / cloth dots outside the sheet. The marker finder must not
    // choose these as page corners.
    for (let y = 20; y < H; y += 58) {
      for (let x = 18; x < W; x += 67) fillDisc(g, x, y, 5, 25);
    }

    const s = 0.82;
    const ox = 190;
    const oy = 110;
    const map = (x: number, y: number) => ({ x: ox + x * s, y: oy + y * s });

    // White sheet body.
    fillMappedRect(g, map, 0, 0, SHEET_W, SHEET_H, 255);

    // Target/ring-style markers like the printed sheet.
    t.markerRects.forEach((m) => {
      fillMappedRect(g, map, m.x, m.y, m.w, m.h, 0);
      fillMappedRect(g, map, m.x + 14, m.y + 14, m.w - 28, m.h - 28, 255);
      fillMappedRect(g, map, m.x + 24, m.y + 24, m.w - 48, m.h - 48, 0);
    });

    const shadeAt = (item: number, ci: number) => {
      const b = t.bubbles.find((x) => x.item === item && x.choiceIndex === ci)!;
      const p = map(b.cx, b.cy);
      fillDisc(g, p.x, p.y, b.r * s * 0.85, 0);
    };
    shadeAt(1, 2);
    shadeAt(10, 2);

    const res = readSheet(g, t);
    expect(res.aligned).toBe(true);
    expect(res.items[0]).toMatchObject({ detected: "C", status: "selected" });
    expect(res.items[9]).toMatchObject({ detected: "C", status: "selected" });
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
    cognitiveLevel: "",
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

  it("keeps low-confidence selected answers in review until confirmed", () => {
    const r = buildReview(items, key, [
      { item: 1, detected: "A", status: "selected", confidence: 0.55, fill: [0.2, 0.06, 0.05, 0.05] },
      { item: 2, detected: "C", status: "selected", confidence: 0.9, fill: [0, 0, 0.7, 0] },
      { item: 3, detected: null, status: "blank", confidence: 0.9, fill: [0, 0, 0, 0] },
      { item: 4, detected: "D", status: "selected", confidence: 0.9, fill: [0, 0, 0, 0.7] },
    ]);
    expect(r.rows[0].detected).toBeNull();
    expect(r.rows[0].suggested).toBe("A");
    expect(r.rows[0].needsReview).toBe(true);
    expect(r.lowConfidenceCount).toBe(1);
    expect(r.needsReview).toBe(true);
  });

  it("a correction to blank keeps the item unscored", () => {
    const r = buildReview(items, key, readings, { 1: "" });
    expect(r.rawScore).toBe(1); // item 1 now blank, only item 2 correct
  });

  it("treats a missing detector row as unresolved evidence, never a trusted blank", () => {
    const r = buildReview(items, key, readings.slice(0, 3));
    expect(r.rows[3]).toMatchObject({ detected: null, status: "unclear", confidence: 0, needsReview: true });
    expect(r.unresolvedCount).toBe(1);
    expect(r.blankCount).toBe(1);
    expect(r.needsReview).toBe(true);
  });
});

// ---- strict completeness: never miss an item number --------------------
describe("ensureCompleteItems (no-missed-number guarantee)", () => {
  it("returns exactly items 1..total in order for every supported size", () => {
    for (const total of [40, 50, 60, 80]) {
      const partial: ItemReading[] = [
        { item: 3, detected: "B", status: "selected", confidence: 0.9, fill: [0, 0.7, 0, 0, 0] },
        { item: total, detected: "A", status: "selected", confidence: 0.9, fill: [0.7, 0, 0, 0, 0] },
      ];
      const out = ensureCompleteItems(partial, total);
      expect(out).toHaveLength(total);
      expect(out.map((r) => r.item)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    }
  });

  it("flags any inserted (missing) item as Needs Review, never silently blank", () => {
    const out = ensureCompleteItems([{ item: 2, detected: "A", status: "selected", confidence: 0.9, fill: [] }], 3);
    expect(out[0]).toMatchObject({ item: 1, status: "unclear", detected: null });
    expect(out[1]).toMatchObject({ item: 2, status: "selected" });
    expect(out[2]).toMatchObject({ item: 3, status: "unclear", detected: null });
  });

  it("is idempotent on an already-complete list", () => {
    const full: ItemReading[] = Array.from({ length: 40 }, (_, i) => ({
      item: i + 1, detected: null, status: "blank" as const, confidence: 0.9, fill: [],
    }));
    expect(ensureCompleteItems(full, 40).map((r) => r.item)).toEqual(full.map((r) => r.item));
  });
});

describe("readSheet returns complete item coverage for large sheets", () => {
  for (const total of [40, 50, 60, 80]) {
    it(`reads exactly ${total} items, numbered 1..${total} with no gaps`, () => {
      const t = buildTemplate(total);
      const g = blankSheet();
      MARKER_RECTS.forEach((m) => fillRect(g, m.x, m.y, m.w, m.h, 0));
      // Shade a spread of items to exercise the full grid.
      shade(g, t, 1, 0);
      shade(g, t, Math.floor(total / 2), 2);
      shade(g, t, total, 3);
      const res = readSheet(g, t);
      expect(res.aligned).toBe(true);
      const complete = ensureCompleteItems(res.items, total);
      expect(complete).toHaveLength(total);
      expect(complete.map((r) => r.item)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
      expect(complete[0]).toMatchObject({ detected: "A", status: "selected" });
      expect(complete[total - 1]).toMatchObject({ detected: "D", status: "selected" });
    });
  }
});

// ---- precomputed corners: live loop runs marker search only once --------
describe("readSheet with precomputed corners", () => {
  it("matches a normal read when the caller passes the corners in", () => {
    const t = buildTemplate(10);
    const g = blankSheet();
    MARKER_RECTS.forEach((m) => fillRect(g, m.x, m.y, m.w, m.h, 0));
    shade(g, t, 2, 1); // 2 -> B
    const corners = findCornerMarkers(g);
    expect(corners).not.toBeNull();
    const fresh = readSheet(g, t);
    const reused = readSheet(g, t, {}, corners);
    expect(reused.aligned).toBe(true);
    expect(reused.items.map((r) => r.detected)).toEqual(fresh.items.map((r) => r.detected));
    expect(reused.items[1]).toMatchObject({ detected: "B", status: "selected" });
  });

  it("treats an explicit null as markers-not-found (no silent re-search)", () => {
    const t = buildTemplate(10);
    const g = blankSheet();
    MARKER_RECTS.forEach((m) => fillRect(g, m.x, m.y, m.w, m.h, 0));
    const res = readSheet(g, t, {}, null);
    expect(res.aligned).toBe(false);
    expect(res.items).toHaveLength(0);
  });
});
