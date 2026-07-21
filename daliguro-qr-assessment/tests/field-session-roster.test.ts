// Guards the synthetic roster that physical field sessions are planned against.
//
// `scripts/create-camera-field-session.mjs` writes the expected learner for
// every scan attempt BEFORE any scanning happens — that expectation is the
// entire acceptance gate ("observed learner == expected learner"). The script
// reads the roster from the real demo builder when possible, but falls back to
// a documented literal when its module loader is unavailable (offline prep, no
// vite-node).
//
// If that literal ever drifts from `buildDemoBundle()`, a field session would be
// planned against learners that do not exist on the printed sheets, and every
// scan would look like a wrong-identity failure. This test makes the fallback
// load-bearing so the drift fails here instead of in a classroom.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoBundle, DEMO_ASSESSMENT_ID } from "../src/lib/demo";

// Read the fallback out of the SCRIPT ITSELF rather than restating it here.
// A second copy of the literal in this file could drift from the script's copy,
// and the test would then pass while the real fallback was wrong — guarding
// nothing. Parsing the script keeps this assertion anchored to the code that
// actually runs during field preparation.
// cwd-relative: the jsdom test environment does not expose a file: URL via
// import.meta.url, and vitest runs from the repository root.
const scriptSource = readFileSync(
  join(process.cwd(), "scripts", "create-camera-field-session.mjs"),
  "utf8",
);

function extractFallback() {
  const assessmentId = scriptSource.match(/assessmentId:\s*"([^"]+)"/)?.[1];
  const versions = scriptSource
    .match(/versions:\s*\[([^\]]+)\]/)?.[1]
    ?.split(",")
    .map((v) => v.trim().replace(/"/g, ""));
  const itemCount = Number(scriptSource.match(/itemCount:\s*(\d+)/)?.[1]);
  // The fallback builds ids from a numeric range, e.g. [1,2,3,4,5].map(...`L_demo${n}`).
  const range = scriptSource
    .match(/learners:\s*\[([\d,\s]+)\]\.map/)?.[1]
    ?.split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n));
  const prefix = scriptSource.match(/id:\s*`([A-Za-z_]+)\$\{n\}`/)?.[1];
  return {
    assessmentId,
    versions,
    itemCount,
    learnerIds: range && prefix ? range.map((n) => `${prefix}${n}`) : undefined,
  };
}

const DOCUMENTED_FALLBACK = extractFallback();

describe("field session fallback is parseable", () => {
  it("extracts every field from the session script", () => {
    // If this fails, the script's fallback shape changed and the assertions
    // below would silently compare against `undefined`.
    expect(DOCUMENTED_FALLBACK.assessmentId).toBeTruthy();
    expect(DOCUMENTED_FALLBACK.versions?.length).toBeGreaterThan(0);
    expect(DOCUMENTED_FALLBACK.itemCount).toBeGreaterThan(0);
    expect(DOCUMENTED_FALLBACK.learnerIds?.length).toBeGreaterThan(0);
  });
});

describe("field session synthetic roster", () => {
  it("matches the assessment id the field session plans against", () => {
    expect(DEMO_ASSESSMENT_ID).toBe(DOCUMENTED_FALLBACK.assessmentId);
  });

  it("matches the learner ids the field session plans against", () => {
    const bundle = buildDemoBundle();
    expect(bundle.learners.map((l) => l.id)).toEqual(DOCUMENTED_FALLBACK.learnerIds);
  });

  it("matches the version list and item count", () => {
    const bundle = buildDemoBundle();
    expect(bundle.assessment.versions).toEqual(DOCUMENTED_FALLBACK.versions);
    expect(bundle.items).toHaveLength(DOCUMENTED_FALLBACK.itemCount);
  });

  it("uses synthetic learner ids only — never a real-looking identifier", () => {
    const bundle = buildDemoBundle();
    for (const learner of bundle.learners) {
      expect(learner.id).toMatch(/^L_demo\d+$/);
    }
  });

  it("keeps learner ids stable across builds so a printed sheet stays addressable", () => {
    // A field session may be planned on one day and scanned on another. If the
    // roster were regenerated with random ids, the printed sheets would no
    // longer map to the plan.
    expect(buildDemoBundle().learners.map((l) => l.id)).toEqual(
      buildDemoBundle().learners.map((l) => l.id),
    );
  });
});
