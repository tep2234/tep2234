import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 1600;

const asymmetricSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect width="600" height="800" fill="#f00000"/>
    <rect x="600" width="600" height="800" fill="#00c000"/>
    <rect y="800" width="600" height="800" fill="#0000f0"/>
    <rect x="600" y="800" width="600" height="800" fill="#f0f000"/>
    <rect x="525" y="725" width="150" height="150" fill="#000000"/>
  </svg>
`);

const transparentSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect x="450" y="650" width="300" height="300" fill="#000000"/>
  </svg>
`);

let baselineJpeg: Buffer;
let progressiveJpeg: Buffer;
let opaquePng: Buffer;
let transparentPng: Buffer;

test.beforeAll(async () => {
  baselineJpeg = await sharp(asymmetricSvg).jpeg({ quality: 95, progressive: false }).toBuffer();
  progressiveJpeg = await sharp(asymmetricSvg).jpeg({ quality: 95, progressive: true }).toBuffer();
  opaquePng = await sharp(asymmetricSvg).png().toBuffer();
  transparentPng = await sharp(transparentSvg).png().toBuffer();
});

test.beforeEach(async ({ page }) => {
  await page.goto("/browser-tests/ingestion-harness.html");
  await page.waitForFunction(() => Boolean(window.scannerHarness));
});

function exifSegment(orientation: number): Buffer {
  const segment = Buffer.alloc(34);
  segment.set([0xff, 0xe1, 0x00, 0x20]);
  segment.write("Exif\0\0", 4, "binary");
  segment.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], 10);
  segment.set([0x01, 0x00], 18);
  segment.set([0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00], 20);
  return segment;
}

function withOrientation(jpeg: Buffer, orientation: number): Buffer {
  return Buffer.concat([jpeg.subarray(0, 2), exifSegment(orientation), jpeg.subarray(2)]);
}

async function processBytes(page: Page, bytes: Buffer, type: string, name: string) {
  return page.evaluate(async ({ data, type, name }) => {
    const file = new File([new Uint8Array(data)], name, { type });
    return window.scannerHarness.processFile(file);
  }, { data: Array.from(bytes), type, name });
}

function nearestColor(sample: number[]): "R" | "G" | "B" | "Y" | "W" | "K" {
  const colors = {
    R: [240, 0, 0], G: [0, 192, 0], B: [0, 0, 240], Y: [240, 240, 0], W: [255, 255, 255], K: [0, 0, 0],
  } as const;
  return (Object.entries(colors) as [keyof typeof colors, readonly number[]][])
    .map(([key, value]) => ({ key, distance: value.reduce((sum, channel, index) => sum + (sample[index] - channel) ** 2, 0) }))
    .sort((a, b) => a.distance - b.distance)[0].key;
}

function pngStructure(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(58);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.writeUInt32BE(1, 33);
  bytes.write("IDAT", 37, "ascii");
  bytes[41] = 0;
  bytes.writeUInt32BE(0, 46);
  bytes.write("IEND", 50, "ascii");
  return bytes;
}

async function inspect(page: Page, bytes: Buffer, mime: string) {
  return page.evaluate(({ data, mime }) => window.scannerHarness.inspectBytes(data, mime), {
    data: Array.from(bytes), mime,
  });
}

test("separates Take Photo from Choose Existing Image", async ({ page }) => {
  await expect(page.locator("#take-photo")).toHaveAttribute("capture", "environment");
  await expect(page.locator("#existing-image")).not.toHaveAttribute("capture", /.+/);
});

test("normalizes asymmetric JPEG pixels for EXIF orientations 1 through 8", async ({ page }) => {
  const expected = [
    ["R", "G", "B", "Y"],
    ["G", "R", "Y", "B"],
    ["Y", "B", "G", "R"],
    ["B", "Y", "R", "G"],
    ["R", "B", "G", "Y"],
    ["B", "R", "Y", "G"],
    ["Y", "G", "B", "R"],
    ["G", "Y", "R", "B"],
  ];
  for (let orientation = 1; orientation <= 8; orientation += 1) {
    const value = await processBytes(page, withOrientation(baselineJpeg, orientation), "image/jpeg", `orientation-${orientation}.jpg`);
    expect(value.result).toMatchObject({ ok: true, orientation });
    const samples = value.samples!;
    expect([
      nearestColor(samples.topLeft), nearestColor(samples.topRight),
      nearestColor(samples.bottomLeft), nearestColor(samples.bottomRight),
    ]).toEqual(expected[orientation - 1]);
  }
});

test("decodes baseline JPEG, progressive JPEG, and opaque PNG", async ({ page }) => {
  for (const [bytes, type, name] of [
    [baselineJpeg, "image/jpeg", "baseline.jpg"],
    [progressiveJpeg, "image/jpeg", "progressive.jpg"],
    [opaquePng, "image/png", "opaque.png"],
  ] as const) {
    const value = await processBytes(page, bytes, type, name);
    expect(value.result).toMatchObject({ ok: true, normalizedWidth: WIDTH, normalizedHeight: HEIGHT });
  }
});

test("composites transparent PNG margins onto opaque white", async ({ page }) => {
  const value = await processBytes(page, transparentPng, "image/png", "transparent.png");
  expect(value.result).toMatchObject({ ok: true });
  expect(nearestColor(value.samples!.topLeft)).toBe("W");
  expect(nearestColor(value.samples!.bottomRight)).toBe("W");
  expect(nearestColor(value.samples!.center)).toBe("K");
  expect(value.samples!.topLeft[3]).toBe(255);
});

test("rejects truncation, corrupt segment lengths, and MIME spoofing", async ({ page }) => {
  expect((await processBytes(page, baselineJpeg.subarray(0, 80), "image/jpeg", "truncated.jpg")).result)
    .toMatchObject({ ok: false, code: "IMAGE_STRUCTURE_INVALID" });
  expect((await processBytes(page, opaquePng.subarray(0, 40), "image/png", "truncated.png")).result)
    .toMatchObject({ ok: false, code: "IMAGE_STRUCTURE_INVALID" });
  const corrupt = Buffer.from(baselineJpeg);
  corrupt[4] = 0xff;
  corrupt[5] = 0xff;
  expect((await processBytes(page, corrupt, "image/jpeg", "corrupt.jpg")).result)
    .toMatchObject({ ok: false, code: "IMAGE_STRUCTURE_INVALID" });
  expect((await processBytes(page, opaquePng, "image/jpeg", "spoofed.jpg")).result)
    .toMatchObject({ ok: false, code: "IMAGE_TYPE_MISMATCH" });
});

test("enforces exact encoded dimension boundaries before decoding", async ({ page }) => {
  expect(await inspect(page, pngStructure(720, 960), "image/png")).toMatchObject({ format: "png" });
  expect(await inspect(page, pngStructure(719, 960), "image/png")).toMatchObject({ code: "IMAGE_DIMENSIONS_TOO_SMALL" });
  expect(await inspect(page, pngStructure(8192, 3906), "image/png")).toMatchObject({ format: "png" });
  expect(await inspect(page, pngStructure(8193, 3906), "image/png")).toMatchObject({ code: "IMAGE_DIMENSIONS_TOO_LARGE" });
  expect(await inspect(page, pngStructure(8000, 4000), "image/png")).toMatchObject({ format: "png" });
  expect(await inspect(page, pngStructure(8000, 4001), "image/png")).toMatchObject({ code: "IMAGE_DIMENSIONS_TOO_LARGE" });
});

test("rejects oversized encoded dimensions before a compressed payload is decoded", async ({ page }) => {
  const oversized = pngStructure(9000, 1000);
  const value = await processBytes(page, oversized, "image/png", "compressed-oversized.png");
  expect(value.result).toMatchObject({ ok: false, code: "IMAGE_DIMENSIONS_TOO_LARGE" });
  expect(value.diagnostic?.decoderPath).toBeUndefined();
});

test("prevents stale rapid replacements and allows same-file reselection", async ({ page }) => {
  const replacements = await page.evaluate(async ({ first, second }) => {
    const firstFile = new File([new Uint8Array(first)], "first.jpg", { type: "image/jpeg" });
    const secondFile = new File([new Uint8Array(second)], "second.png", { type: "image/png" });
    return Promise.all([
      window.scannerHarness.processFile(firstFile),
      window.scannerHarness.processFile(secondFile),
    ]);
  }, { first: Array.from(baselineJpeg), second: Array.from(opaquePng) });
  expect(replacements[0].result).toMatchObject({ ok: false, code: expect.stringMatching(/CANCELLED|STALE/) });
  expect(replacements[1].result).toMatchObject({ ok: true });

  const input = page.locator("#existing-image");
  await input.setInputFiles({ name: "same.png", mimeType: "image/png", buffer: opaquePng });
  await expect(page.locator("#result")).toHaveAttribute("data-count", "1");
  await input.setInputFiles({ name: "same.png", mimeType: "image/png", buffer: opaquePng });
  await expect(page.locator("#result")).toHaveAttribute("data-count", "2");
});

test("closes a real ImageBitmap once when cancelled after acquisition", async ({ page }) => {
  const value = await page.evaluate(async (data) => {
    const file = new File([new Uint8Array(data)], "cancel.png", { type: "image/png" });
    return window.scannerHarness.cancelAfterBitmapAcquisition(file);
  }, Array.from(opaquePng));
  expect(value.result).toMatchObject({ ok: false, code: "IMAGE_ANALYSIS_CANCELLED" });
  expect(value.closeCount).toBe(1);
});

test("revokes the fallback object URL exactly once", async ({ page }) => {
  const value = await page.evaluate(async (data) => {
    const file = new File([new Uint8Array(data)], "fallback.png", { type: "image/png" });
    return window.scannerHarness.fallbackDecode(file);
  }, Array.from(opaquePng));
  expect(value.result).toMatchObject({ ok: true });
  expect(value.revokeCount).toBe(1);
});
