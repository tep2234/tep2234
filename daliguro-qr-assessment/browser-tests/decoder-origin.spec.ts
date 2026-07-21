// Phase 2 + Phase 4 — the REAL zxing-wasm decoder in a REAL browser.
//
// Unit tests mock `zxing-wasm/reader`; this file does not. It loads the actual
// ~1 MB WASM binary and asserts two independent things:
//
//   1. NETWORK ORIGIN — the binary is fetched from the application origin, and
//      no request reaches jsDelivr/unpkg/any third party. This is the offline
//      contract: public/sw.js deliberately never caches cross-origin responses,
//      so a remote binary would be unavailable exactly when a school is offline.
//   2. DECODE BEHAVIOUR — the real decoder reads representative DALIguro QR
//      fixtures, and an invalid payload is still rejected by the trust gate.
//
// All fixtures are synthetic (fixed fake learner/assessment). No student data.

import { expect, test, type Page, type Request } from "@playwright/test";

const HARNESS = "/browser-tests/decoder-harness.html";

const FORBIDDEN_HOST = /jsdelivr|unpkg|cdnjs|googleapis|cloudflare/i;

interface NetworkLog {
  all: string[];
  wasm: string[];
  forbidden: string[];
}

// Record every request the page makes so we can assert on origins afterwards.
async function withNetworkLog(page: Page): Promise<NetworkLog> {
  const log: NetworkLog = { all: [], wasm: [], forbidden: [] };
  page.on("request", (request: Request) => {
    const url = request.url();
    log.all.push(url);
    // Count only fetches of the BINARY itself. Under the Vite dev server a
    // `?url` import produces a second request for the same path with an
    // `?import` query, which resolves to a JS module exporting the URL string —
    // not a download of the 1 MB binary. Counting it would overstate the fetch
    // count and make the "instantiated once" assertion misleading.
    if (url.includes(".wasm") && !url.includes("import")) log.wasm.push(url);
    if (FORBIDDEN_HOST.test(url)) log.forbidden.push(url);
  });
  return log;
}

async function openHarness(page: Page) {
  await page.goto(HARNESS);
  await expect(page.locator("#ready")).toHaveText("ready");
  await page.evaluate(() => window.decoderHarness.reset());
}

test.describe("zxing-wasm asset origin", () => {
  test("fetches the WASM from the application origin and never from a CDN", async ({
    page,
    baseURL,
  }) => {
    const log = await withNetworkLog(page);
    await openHarness(page);

    const report = await page.evaluate(() => window.decoderHarness.decodeRendered("none"));

    // The decode must actually have happened, otherwise the origin assertion
    // below would pass vacuously.
    expect(report.text).not.toBeNull();
    expect(report.matchedExpected).toBe(true);

    expect(log.wasm.length).toBeGreaterThan(0);
    for (const url of log.wasm) {
      expect(url.startsWith(baseURL!)).toBe(true);
    }
    expect(log.forbidden).toEqual([]);
  });

  test("instantiates the WASM module exactly once across many decodes", async ({ page }) => {
    const log = await withNetworkLog(page);
    await openHarness(page);

    await page.evaluate(async () => {
      for (let i = 0; i < 6; i += 1) await window.decoderHarness.decodeRendered("none");
    });
    const diagnostics = await page.evaluate(() => window.decoderHarness.diagnostics());

    expect(diagnostics.initCount).toBe(1);
    expect(diagnostics.decodeCount).toBe(6);
    // One binary fetch, not one per frame.
    expect(log.wasm.length).toBe(1);
  });

  test("shares a single initialization across concurrent frames", async ({ page }) => {
    const log = await withNetworkLog(page);
    await openHarness(page);

    const report = await page.evaluate(() => window.decoderHarness.decodeConcurrently(5));

    expect(report.matchedExpected).toBe(true);
    expect(report.initCount).toBe(1);
    expect(log.wasm.length).toBe(1);
  });
});

test.describe("native fast path does not touch the WASM tier", () => {
  test("an accepted native BarcodeDetector result never fetches the binary", async ({ page }) => {
    const log = await withNetworkLog(page);
    await openHarness(page);

    const outcome = await page.evaluate(() => {
      const raw = window.decoderHarness.buildValidPayloadText();
      return window.decoderHarness.analyzeWithNativeResult(raw, "A1");
    });

    // The identity came from the caller, so ZXing must be untouched...
    expect(outcome.qrSource).toBe("provided");
    expect(outcome.initCount).toBe(0);
    expect(outcome.decodeCount).toBe(0);
    // ...and the 1 MB binary must never be requested. This is what keeps
    // Android Chrome from paying for a decoder it does not need.
    expect(log.wasm).toEqual([]);
    expect(log.forbidden).toEqual([]);
  });
});

test.describe("worker asset origin", () => {
  test("the scanner worker is loaded from the application origin", async ({ page, baseURL }) => {
    await openHarness(page);
    const worker = await page.evaluate(() => window.decoderHarness.workerAssetOrigin());

    expect(worker.sameOrigin).toBe(true);
    expect(worker.url.startsWith(baseURL!)).toBe(true);
    expect(worker.url).not.toMatch(/jsdelivr|unpkg|cdnjs|esm\.sh|skypack/i);
  });
});

test.describe("real decoder — representative fixtures", () => {
  // Conditions the decoder is expected to handle. Each renders a real QR from
  // the real encoder, degrades it, and requires an exact payload match.
  for (const degradation of [
    "none",
    "small",
    "rotated",
    "low-contrast",
    "grayscale",
    "blurred",
    "shadowed",
  ] as const) {
    test(`decodes a ${degradation} QR with the real WASM binary`, async ({ page }) => {
      await openHarness(page);
      const report = await page.evaluate(
        (d) => window.decoderHarness.decodeRendered(d),
        degradation,
      );

      expect(report.text, `expected the ${degradation} fixture to decode`).not.toBeNull();
      expect(report.matchedExpected).toBe(true);
      expect(report.payloadValid).toBe(true);
      expect(report.failureCount).toBe(0);
    });
  }
});

test.describe("real decoder — trust gate still applies", () => {
  test("rejects a correctly signed payload for a DIFFERENT assessment", async ({ page }) => {
    await openHarness(page);
    const outcome = await page.evaluate(async () => {
      const raw = window.decoderHarness.buildValidPayloadText({ assessmentId: "OTHER" });
      return window.decoderHarness.analyzeRendered(raw, "A1");
    });

    expect(outcome.scanIsNull).toBe(true);
    expect(outcome.reasonCodes).toContain("WRONG_ASSESSMENT");
  });

  test("rejects a payload whose checksum no longer matches", async ({ page }) => {
    await openHarness(page);
    const outcome = await page.evaluate(async () => {
      const raw = window.decoderHarness.buildTamperedPayloadText({ learnerId: "SOMEONE-ELSE" });
      return window.decoderHarness.analyzeRendered(raw, "A1");
    });

    expect(outcome.scanIsNull).toBe(true);
    // A real decode of a tampered payload must not be promoted to an identity.
    expect(outcome.qrSource).not.toBe("zxing-wasm");
  });

  test("rejects a QR that is not a DALIguro identity code at all", async ({ page }) => {
    await openHarness(page);
    const outcome = await page.evaluate(() =>
      window.decoderHarness.analyzeRendered("https://example.com/not-a-sheet", "A1"),
    );

    expect(outcome.scanIsNull).toBe(true);
    expect(outcome.qrSource).not.toBe("zxing-wasm");
  });

  test("decodes a malformed payload but refuses to trust it", async ({ page }) => {
    await openHarness(page);
    const report = await page.evaluate(() =>
      window.decoderHarness.decodeRawText('{"assessmentId":"A1"}'),
    );

    // The decoder genuinely read the symbol...
    expect(report.text).toBe('{"assessmentId":"A1"}');
    // ...but it is not a valid identity payload.
    expect(report.payloadValid).toBe(false);
  });
});

test.describe("offline scanning after the app has loaded", () => {
  test("keeps decoding with no network and makes no external request", async ({
    page,
    context,
  }) => {
    const log = await withNetworkLog(page);
    await openHarness(page);

    // 1. Warm the decoder while online so the binary is fetched and cached.
    const online = await page.evaluate(() => window.decoderHarness.decodeRendered("none"));
    expect(online.matchedExpected).toBe(true);
    const requestsWhileOnline = log.all.length;

    // 2. Go offline.
    await context.setOffline(true);

    // 3. The instantiated module lives in the page, so decoding must continue.
    const offline = await page.evaluate(async () => {
      const results = [];
      for (let i = 0; i < 10; i += 1) {
        results.push(await window.decoderHarness.decodeRendered("none"));
      }
      return results;
    });

    expect(offline).toHaveLength(10);
    expect(offline.every((r) => r.matchedExpected)).toBe(true);
    expect(offline.every((r) => r.payloadValid)).toBe(true);

    // 4. No new network activity at all, and certainly nothing cross-origin.
    expect(log.all.length).toBe(requestsWhileOnline);
    expect(log.forbidden).toEqual([]);

    await context.setOffline(false);
  });
});
