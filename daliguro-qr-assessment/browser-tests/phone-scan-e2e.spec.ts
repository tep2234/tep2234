// End-to-end phone-scanner certification (Chromium): a rendered SmartScan v2
// answer sheet is fed to the REAL mobile page through Chromium's fake camera,
// against a REAL pairing session on the configured Supabase project.
//
// Covers, in one flow: pairing-QR claim → live camera → frame stability →
// consensus → verified final capture → teacher confirm → durable inbox row.
import { chromium, expect, test } from "@playwright/test";
import {
  anonymousTeacher,
  createPairingSession,
  fetchInbox,
  ITEM_COUNT,
  LEARNER,
  renderCameraFrame,
  writeY4m,
} from "./phone-scan-helpers";

// ---------- the certification flow ----------

test.describe("phone scanner end-to-end (live camera → durable inbox)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "fake camera capture is Chromium-only");

  test("scans a rendered sheet through the real mobile page and lands one inbox row", async () => {
    test.setTimeout(120_000);

    const teacher = await anonymousTeacher();
    const { sessionId, token } = await createPairingSession(teacher);
    const y4m = writeY4m(renderCameraFrame(), 2);

    const browser = await chromium.launch({
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${y4m}`,
      ],
    });
    try {
      const context = await browser.newContext({ permissions: ["camera"] });
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      page.on("pageerror", (err) => consoleErrors.push(String(err)));

      // 1) Pairing QR certification: the one-time claim must succeed exactly once.
      await page.goto(`http://127.0.0.1:4178/smartscan/mobile/${sessionId}?t=${token}`);
      await expect(page.getByText("PC paired")).toBeVisible({ timeout: 20_000 });
      // The one-time secret must be stripped from the address bar after claim.
      expect(page.url()).not.toContain(token);

      // 2) Answer-sheet scanner certification: live camera locks on the sheet
      //    and produces a verified capture for teacher review.
      await page.getByRole("button", { name: "Start live camera" }).click();
      await expect(page.getByText("Confirm detected answers")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText(`Learner: ${LEARNER.id}`, { exact: false })).toBeVisible();
      await expect(page.getByText(`All ${ITEM_COUNT} items read cleanly`, { exact: false })).toBeVisible();

      // 3) Synchronization certification: teacher confirm produces exactly one
      //    durable inbox row for this session, with the right identity.
      await page.getByRole("button", { name: "Teacher confirm & submit" }).click();
      await expect(page.getByText(/Waiting for durable receipt|Saved with receipt/)).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText("Scan held for retry")).toHaveCount(0);

      await expect(async () => {
        const rows = await fetchInbox(teacher, sessionId);
        expect(rows.length).toBe(1);
        expect(rows[0].status).toBe("received");
        expect(rows[0].sequence_number).toBe(1);
      }).toPass({ timeout: 15_000 });

      expect(consoleErrors, `page errors: ${consoleErrors.join(" | ")}`).toHaveLength(0);
    } finally {
      await browser.close();
    }
  });
});
