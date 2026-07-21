#!/usr/bin/env node
// Browser-test truthfulness gate.
//
// WHY THIS EXISTS
// ---------------
// A browser suite can "succeed" without proving anything. Two distinct failure
// modes have actually been observed on this project:
//
//   1. Pipeline masking. `npx playwright test | tail -15` exits with *tail's*
//      status (0), hiding Playwright's 1, while the tail truncates the "N
//      failed" line and leaves only "2 skipped" on screen. Playwright itself
//      behaved correctly; the reader was misled. Verified 2026-07-21.
//   2. Mass skipping. A conditional `test.skip()` that silently widens (an env
//      probe, a capability check) can quietly reduce a suite to zero executed
//      tests while still exiting 0.
//
// This script runs Playwright itself (no pipeline), then asserts against the
// JSON report that the run was *substantive*: every configured project actually
// executed tests, and the only skips are ones explicitly declared below.
//
// Usage:  node scripts/verify-browser-tests.mjs [--project=chromium]

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = join(repoRoot, "test-results", "browser-report.json");

// Skips that are a deliberate, documented product decision — NOT environment
// failures. Anything skipped outside this list fails the gate.
//
// Keep the reason text in sync with the `test.skip()` call it describes.
const ALLOWED_SKIPS = [
  {
    titlePattern: /scans a rendered sheet through the real mobile page/,
    projects: ["firefox", "webkit"],
    reason: "fake camera capture is Chromium-only (browser-tests/phone-scan-e2e.spec.ts)",
  },
];

function isAllowedSkip(test) {
  return ALLOWED_SKIPS.some(
    (allowed) =>
      allowed.titlePattern.test(test.title) && allowed.projects.includes(test.projectName),
  );
}

// Walk the Playwright JSON suite tree into a flat list of {title, projectName,
// status} so the assertions below do not depend on nesting depth.
function flatten(suites, out = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        out.push({
          title: spec.title,
          projectName: test.projectId ?? test.projectName ?? "unknown",
          // `status` is the expected outcome; results[].status is what happened.
          status: results.length ? results[results.length - 1].status : "missing",
          outcome: test.status ?? "unknown",
        });
      }
    }
    flatten(suite.suites, out);
  }
  return out;
}

function fail(message, detail) {
  console.error(`\n✗ BROWSER TEST GATE FAILED: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

// --- run Playwright directly; no shell pipeline, so we see its real status ---
const passthroughArgs = process.argv.slice(2);
rmSync(reportPath, { force: true });

const run = spawnSync(
  "npx",
  ["playwright", "test", "--reporter=json", ...passthroughArgs],
  {
    cwd: repoRoot,
    encoding: "utf8",
    // The JSON reporter writes to stdout by default; redirect it to a file so
    // the human-readable progress still reaches the terminal via stderr.
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (run.error) fail(`could not launch Playwright: ${run.error.message}`);

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (err) {
  // No parseable report means we cannot prove anything about the run, which is
  // itself a failure — never treat an unreadable report as a pass.
  fail(
    `no readable JSON report at ${reportPath} (playwright exit ${run.status})`,
    err instanceof Error ? err.message : String(err),
  );
}

const tests = flatten(report.suites);
const executed = tests.filter((t) => !["skipped", "missing"].includes(t.status));
const skipped = tests.filter((t) => t.status === "skipped");
const failed = tests.filter((t) => ["failed", "timedOut", "interrupted"].includes(t.status));

// Which projects were configured for THIS invocation (respects --project=...).
const configuredProjects = (report.config?.projects ?? []).map((p) => p.name);
const projectsThatRan = new Set(executed.map((t) => t.projectName));

console.log("\n── browser test gate ─────────────────────────────");
console.log(`playwright exit status : ${run.status}`);
console.log(`projects configured    : ${configuredProjects.join(", ") || "(none)"}`);
console.log(`tests executed         : ${executed.length}`);
console.log(`tests passed           : ${executed.length - failed.length}`);
console.log(`tests failed           : ${failed.length}`);
console.log(`tests skipped          : ${skipped.length}`);

for (const test of skipped) {
  const tag = isAllowedSkip(test) ? "intentional" : "UNEXPECTED";
  console.log(`  skip [${tag}] ${test.projectName} › ${test.title}`);
}
console.log("──────────────────────────────────────────────────\n");

// --- assertions -------------------------------------------------------------

// 1. Zero executed tests is never a pass, whatever the exit code says.
if (executed.length === 0) {
  fail(
    "zero tests executed — the suite proved nothing",
    "A run that skips or errors out of every test must not be reported as success.",
  );
}

// 2. Every configured project must have executed at least one test. This is
//    what catches a missing browser binary or a silently widening skip.
const projectsWithNothing = configuredProjects.filter((name) => !projectsThatRan.has(name));
if (projectsWithNothing.length > 0) {
  fail(
    `these configured projects executed no tests: ${projectsWithNothing.join(", ")}`,
    "Likely a missing browser binary (`npx playwright install <browser>`) or an over-broad test.skip().",
  );
}

// 3. Skips must be on the documented allow-list. An environment failure that
//    manifests as a skip is exactly what this catches.
const unexpectedSkips = skipped.filter((t) => !isAllowedSkip(t));
if (unexpectedSkips.length > 0) {
  fail(
    `${unexpectedSkips.length} unexpected skip(s)`,
    unexpectedSkips.map((t) => `  ${t.projectName} › ${t.title}`).join("\n") +
      "\n\nIf a skip is deliberate, add it to ALLOWED_SKIPS in this script with a reason.",
  );
}

// 4. Real test failures still fail the gate.
if (failed.length > 0) {
  fail(
    `${failed.length} test(s) failed`,
    failed.map((t) => `  ${t.projectName} › ${t.title}`).join("\n"),
  );
}

// 5. Finally, respect Playwright's own status.
if (run.status !== 0) {
  fail(`playwright exited ${run.status} despite no failure being parsed from the report`);
}

console.log("✓ browser test gate passed — the run was substantive.\n");
