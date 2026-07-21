// iOS safe-area regression guard.
//
// FIELD EVIDENCE (2026-07-21, physical iPhone): the phone scanner's header
// rendered UNDERNEATH the iOS status bar — the assessment id collided with the
// clock and the subtitle was clipped by the signal icons. Cause: index.html
// sets `viewport-fit=cover`, which extends the page under system UI, but no
// element applied `env(safe-area-inset-*)` padding.
//
// Why this test overrides custom properties instead of asserting on `env()`:
// a desktop test browser has no notch, so every `env(safe-area-inset-*)`
// resolves to 0px and any direct assertion would pass whether or not the fix
// existed. The shell reads its insets from `--app-safe-*`, which default to
// `env()` on device and can be set to a non-zero value here — so this test can
// actually fail when the fix is removed.

import { expect, test, type Page } from "@playwright/test";

// A pairing session is not required: the scanner shell renders regardless, and
// this test is only about layout.
const SCANNER_ROUTE = "/smartscan/mobile/safe-area-layout-probe";

// Representative of an iPhone with a notch/Dynamic Island.
const INSET_TOP = 47;
const INSET_BOTTOM = 34;

async function openScanner(page: Page) {
  await page.goto(SCANNER_ROUTE);
  await expect(page.getByTestId("scanner-shell")).toBeVisible();
}

async function applySimulatedInsets(page: Page) {
  await page.addStyleTag({
    content: `:root {
      --app-safe-top: ${INSET_TOP}px;
      --app-safe-bottom: ${INSET_BOTTOM}px;
    }`,
  });
}

test.describe("iOS safe area", () => {
  test("the scanner shell adds the device inset to its own padding", async ({ page }) => {
    await openScanner(page);
    await applySimulatedInsets(page);

    const padding = await page.getByTestId("scanner-shell").evaluate((el) => {
      const style = getComputedStyle(el);
      return { top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom) };
    });

    // 0.75rem (12px) of layout padding PLUS the simulated device inset. If the
    // shell ignored the inset it would read 12px and this fails.
    expect(padding.top).toBeCloseTo(INSET_TOP + 12, 0);
    expect(padding.bottom).toBeCloseTo(INSET_BOTTOM + 12, 0);
  });

  test("the header is pushed clear of the status bar area", async ({ page }) => {
    await openScanner(page);
    await applySimulatedInsets(page);

    const header = page.locator('[data-testid="scanner-shell"] header').first();
    const box = await header.boundingBox();

    expect(box).not.toBeNull();
    // The whole point: nothing in the header may intrude into the region the
    // system reserves for the clock and signal icons.
    expect(box!.y).toBeGreaterThanOrEqual(INSET_TOP);
  });

  test("keeps its normal padding on a device with no insets", async ({ page }) => {
    await openScanner(page);
    // No override: env() resolves to 0px here, as on a non-notched device.

    const padding = await page.getByTestId("scanner-shell").evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingTop),
    );

    // The fix must not add stray space where there is no system UI to clear.
    expect(padding).toBeCloseTo(12, 0);
  });

  test("the shell never scrolls horizontally at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openScanner(page);
    await applySimulatedInsets(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // Left/right insets are added to padding, not width, so adding them must
    // not push the layout wider than the viewport.
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
