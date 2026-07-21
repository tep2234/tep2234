#!/usr/bin/env node
// Field-session generator (Phase 2 preparation).
//
// Produces the ground truth a physical tester needs BEFORE scanning: which
// synthetic learner each printed sheet belongs to, and a pre-filled result
// skeleton stamped with the frozen field-build identity.
//
// WHY ground truth must exist up front: "the scan worked" is not a measurable
// claim. The acceptance gate is "observed learner == expected learner", and
// that can only be checked if the expectation was written down before the scan.
//
// It deliberately does NOT generate printable sheets. The production layout is
// rendered by the app itself (src/components/AnswerSheet.tsx) from the
// canonical OMR template; a second print path could drift from production
// geometry and would then be testing the wrong artifact.
//
// PRIVACY: synthetic demo data only. Learner NAMES are printed to the operator
// checklist purely so a human can find the right sheet on a desk; they are
// never written into the JSON result skeleton, because the result validator
// forbids name fields.
//
// Usage: node scripts/create-camera-field-session.mjs [--scans=20] [--condition=normal-light]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const scanCount = Number(args.scans ?? 20);
const condition = String(args.condition ?? "normal-light");
const phase = String(args.phase ?? "5-iphone-safari");

// --- frozen build identity --------------------------------------------------
const manifestPath = join(repoRoot, "CAMERA_SCANNER_FIELD_BUILD_MANIFEST.json");
if (!existsSync(manifestPath)) {
  console.error("✗ No field-build manifest. Run: npm run build && npm run camera:field:manifest");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const buildIdentity = {
  headCommit: manifest.source.headCommit,
  treeSha256: manifest.source.treeSha256,
  diffSha256: manifest.source.diffSha256 ?? "clean",
  packageLockSha256: manifest.dependencies.packageLockSha256,
  wasmAsset: manifest.assets.wasm[0]?.filename ?? null,
};

// --- synthetic roster -------------------------------------------------------
// Read from the real demo builder via a throwaway TS eval so the roster can
// never drift from what the app actually loads.
const rosterScript = `
import { buildDemoBundle, DEMO_ASSESSMENT_ID } from "./src/lib/demo.ts";
const b = buildDemoBundle();
process.stdout.write(JSON.stringify({
  assessmentId: DEMO_ASSESSMENT_ID,
  versions: b.assessment.versions,
  itemCount: b.items.length,
  learners: b.learners.map((l) => ({ id: l.id, label: l.fullName })),
}));
`;
const rosterFile = join(repoRoot, ".field-roster.probe.mts");
let roster;
try {
  writeFileSync(rosterFile, rosterScript);
  roster = JSON.parse(
    execFileSync("npx", ["vite-node", rosterFile], { cwd: repoRoot, encoding: "utf8" }),
  );
} catch {
  // vite-node may be unavailable; fall back to the documented stable IDs. These
  // are asserted by tests/demo.test.ts, so a drift would fail the unit suite.
  roster = {
    assessmentId: "A_demo",
    versions: ["A", "B"],
    itemCount: 10,
    learners: [1, 2, 3, 4, 5].map((n) => ({ id: `L_demo${n}`, label: `(demo learner ${n})` })),
  };
} finally {
  try {
    execFileSync("rm", [rosterFile]);
  } catch {
    /* probe file already gone */
  }
}

// Round-robin the roster across the requested scan count so every learner is
// exercised and the expected identity for each attempt is unambiguous.
const plan = Array.from({ length: scanCount }, (_, i) => {
  const learner = roster.learners[i % roster.learners.length];
  return {
    attempt: i + 1,
    expectedLearnerId: learner.id,
    expectedAssessmentId: roster.assessmentId,
    expectedVersion: roster.versions[0],
    sheetLabel: learner.label,
  };
});

// --- operator checklist -----------------------------------------------------
const planRows = plan
  .map(
    (p) =>
      `| ${p.attempt} | \`${p.expectedLearnerId}\` | ${p.sheetLabel} | \`${p.expectedAssessmentId}\` | ${p.expectedVersion} | | | | |`,
  )
  .join("\n");

const md = `# Field Session — ${phase} / ${condition}

Generated: ${new Date().toISOString()}

## Frozen build under test

| Field | Value |
|---|---|
| HEAD commit | \`${buildIdentity.headCommit}\` |
| Diff SHA-256 | \`${buildIdentity.diffSha256}\` |
| package-lock SHA-256 | \`${buildIdentity.packageLockSha256}\` |
| WASM asset | \`${buildIdentity.wasmAsset ?? "(none)"}\` |

**Do not change code during this session.** Any edit invalidates this build and
the session must restart with a new manifest.

## Setup

1. Load the synthetic demo data in the app (assessment \`${roster.assessmentId}\`,
   ${roster.itemCount} items, ${roster.learners.length} learners). No real student data.
2. Print sheets for the learners below **from the app's own answer-sheet page**,
   so the printed geometry is the production layout. Do not use a separate
   print path.
3. Record the print settings in the result JSON: paper size, printer, quality,
   scaling %, fit-to-page, QR physical width/height, ink mode, paper type.
   **Scaling must be 100% / fit-to-page OFF** unless production uses otherwise —
   scaling changes sheet geometry and would invalidate the OMR comparison.
4. Open the scanner on the phone over **HTTPS** and confirm the build ID shown
   in the UI matches this manifest.

## Ground truth — fill the blank columns as you scan

Read \`QR path:\` and \`Still:\` from the confirm screen.

| # | Expected learner | Sheet | Expected assessment | Ver | Observed learner | QR path | Still | Outcome |
|---|---|---|---|---|---|---|---|---|
${planRows}

## Acceptance gate for this condition

The decoder label is **supporting evidence only**. The gate is identity:

- Correct learner identities: **${scanCount} / ${scanCount}**
- Wrong learner identities: **0**
- Wrong assessment identities: **0**
- Invalid payloads accepted: **0**
- Duplicate final submissions: **0**
- Silently lost accepted scans: **0**

A scan that fails into retry / unreadable / review is **not** a gate failure.
A scan that accepts the **wrong learner** is a critical failure — stop the
session and record it.

## After scanning

1. Complete \`field-results/${phase}-${condition}.json\`.
2. Run \`npm run camera:field:validate\`.
3. Fix missing evidence rather than editing the record to pass.
`;

writeFileSync(join(repoRoot, `CAMERA_SCANNER_FIELD_SESSION_${condition.toUpperCase()}.md`), md);

// --- result skeleton --------------------------------------------------------
const resultsDir = join(repoRoot, "field-results");
if (!existsSync(resultsDir)) mkdirSync(resultsDir);

const skeleton = {
  _instructions:
    "Fill every null. Leave a value null ONLY if it was genuinely not measured — a null is honest, an invented number corrupts the record. Run `npm run camera:field:validate` when done.",
  sessionId: `FIELD-${new Date().toISOString().slice(0, 10)}-${condition}`,
  phase,
  condition,
  buildIdentity,
  device: { model: null, os: null, browser: null, storageFreeGb: null, batteryStartPct: null, batteryEndPct: null },
  print: {
    paperSize: null, printer: null, quality: null, scalingPercent: null,
    fitToPage: null, qrWidthMm: null, qrHeightMm: null, inkMode: null,
    paperType: null, photocopied: null, damaged: null,
  },
  environment: { scannerUrl: null, https: null, serviceWorkerActive: null, networkState: null, cameraPermission: null },
  camera: { selectedLabel: null, previewWidth: null, previewHeight: null, torchUsed: null, focusMode: null },
  decoder: { qrPath: null, nativeBarcodeDetectorAvailable: null, wasmRequestCount: null, wasmRequestOrigin: null, jsqrCascadeRan: null },
  capture: { stillSource: null, sourceWidth: null, sourceHeight: null, processingWidth: null, processingHeight: null },
  timingMs: { toFirstFrame: null, toStableFrame: null, toAcceptedQr: null, toFinalCapture: null, toFinalResult: null },
  outcome: {
    attempts: scanCount, accepted: null, retries: null,
    rejectedFrameReasons: [],
    finalOutcome: null,
    wrongLearnerIdentities: null, wrongAssessmentIdentities: null,
    invalidPayloadsAccepted: null, ambiguousAnswerCount: null,
    ambiguousAutoFinalized: null, duplicateFinalSubmissions: null, silentlyLostScans: null,
  },
  offline: { mode: "online", outboxRetained: null, syncResumedAfterReconnect: null },
  stability: { cameraFreezes: null, workerFallbacks: null, browserCrashes: null, pageReloads: null, memoryWarnings: null },
  perAttempt: plan.map((p) => ({
    attempt: p.attempt,
    expectedLearnerId: p.expectedLearnerId,
    observedLearnerId: null,
    expectedAssessmentId: p.expectedAssessmentId,
    observedAssessmentId: null,
    qrPath: null,
    stillSource: null,
    outcome: null,
    timeToAcceptedQrMs: null,
    timeToFinalResultMs: null,
    note: null,
  })),
  notes: null,
};

const skeletonPath = join(resultsDir, `${phase}-${condition}.skeleton.json`);
writeFileSync(skeletonPath, `${JSON.stringify(skeleton, null, 2)}\n`);

console.log(`✓ field session prepared`);
console.log(`  condition   : ${phase} / ${condition}`);
console.log(`  scans       : ${scanCount}`);
console.log(`  roster      : ${roster.learners.map((l) => l.id).join(", ")}`);
console.log(`  assessment  : ${roster.assessmentId}`);
console.log(`  build       : ${buildIdentity.headCommit.slice(0, 12)} / diff ${String(buildIdentity.diffSha256).slice(0, 12)}`);
console.log(`  checklist   : CAMERA_SCANNER_FIELD_SESSION_${condition.toUpperCase()}.md`);
console.log(`  skeleton    : field-results/${phase}-${condition}.skeleton.json`);
