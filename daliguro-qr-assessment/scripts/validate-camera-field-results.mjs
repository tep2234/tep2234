#!/usr/bin/env node
// Field-result validator.
//
// WHY: a field record that omits the build identity, the browser version, or
// that reports more successes than attempts is not evidence — it is noise that
// will later be mistaken for proof. This rejects such records at collection
// time, when they can still be corrected, rather than at certification time.
//
// It also refuses records containing student-identifying or credential-like
// fields, so a well-meaning tester cannot accidentally commit personal data
// into the repository.
//
// Usage:
//   node scripts/validate-camera-field-results.mjs [file.json ...]
// With no arguments, validates every *.field.json in field-results/ if present.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const DECODER_PATHS = ["provided", "native", "zxing-wasm", "whole-frame", "region-cascade", "zone-rescue"];
const CAPTURE_SOURCES = ["takePhoto", "grabFrame", "canvas"];
const OFFLINE_MODES = ["online", "airplane", "offline-reload"];

// Field names that must never appear anywhere in a record. Matched on the KEY,
// case-insensitively, at any depth.
const FORBIDDEN_KEY_PATTERNS = [
  /(^|_|\b)(student|learner)?_?(full)?name$/i,
  /^lrn$/i,
  /(^|_)token$/i,
  /(^|_)secret$/i,
  /(^|_)password$/i,
  /(^|_)apikey$/i,
  /(^|_)api_key$/i,
  /authorization/i,
  /(^|_)capability$/i,
  /(^|_)qrpayload$/i,
  /(^|_)payloadtext$/i,
  /(^|_)rawimage$/i,
  /(^|_)imagedata$/i,
  /anonkey/i,
  /servicerole/i,
];

// Value shapes that look like credentials even under an innocuous key.
const CREDENTIAL_VALUE_PATTERNS = [
  { name: "JWT", re: /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: "64-hex capability/token", re: /^[0-9a-f]{64}$/i },
  { name: "bearer header", re: /^bearer\s+\S+/i },
];

function collectIssues(record, label) {
  const issues = [];
  const err = (msg) => issues.push(`${label}: ${msg}`);

  const req = (path, value, what = "missing") => {
    if (value === undefined || value === null || value === "") err(`${what} required field '${path}'`);
  };

  // --- identity of the tested artifact -------------------------------------
  const build = record.buildIdentity;
  if (!build || typeof build !== "object") {
    err("missing 'buildIdentity' — a result that cannot be tied to an exact build is not evidence");
  } else {
    req("buildIdentity.headCommit", build.headCommit);
    req("buildIdentity.diffSha256", build.diffSha256);
    if (build.diffSha256 && !/^[0-9a-f]{64}$/i.test(build.diffSha256) && build.diffSha256 !== "clean") {
      err("'buildIdentity.diffSha256' must be a 64-char hex digest (or 'clean')");
    }
  }

  // --- device / browser ----------------------------------------------------
  const device = record.device ?? {};
  req("device.model", device.model);
  req("device.os", device.os);
  req("device.browser", device.browser);
  if (device.browser && !/\d/.test(String(device.browser))) {
    err("'device.browser' must include a version number");
  }
  if (device.os && !/\d/.test(String(device.os))) {
    err("'device.os' must include a version number");
  }

  req("condition", record.condition);
  req("phase", record.phase);

  // --- decoder / capture paths --------------------------------------------
  const decoderPath = record.decoder?.qrPath;
  req("decoder.qrPath", decoderPath);
  if (decoderPath && !DECODER_PATHS.includes(decoderPath)) {
    err(`unsupported decoder.qrPath '${decoderPath}' (expected one of: ${DECODER_PATHS.join(", ")})`);
  }
  const captureSource = record.capture?.stillSource;
  req("capture.stillSource", captureSource);
  if (captureSource && !CAPTURE_SOURCES.includes(captureSource)) {
    err(`unsupported capture.stillSource '${captureSource}' (expected one of: ${CAPTURE_SOURCES.join(", ")})`);
  }

  const offlineMode = record.offline?.mode;
  if (offlineMode && !OFFLINE_MODES.includes(offlineMode)) {
    err(`unsupported offline.mode '${offlineMode}' (expected one of: ${OFFLINE_MODES.join(", ")})`);
  }

  // --- counts --------------------------------------------------------------
  const outcome = record.outcome ?? {};
  const attempts = outcome.attempts;
  req("outcome.attempts", attempts);
  req("outcome.accepted", outcome.accepted);

  const counters = [
    "attempts", "accepted", "retries", "wrongLearnerIdentities",
    "wrongAssessmentIdentities", "invalidPayloadsAccepted", "ambiguousAnswerCount",
    "ambiguousAutoFinalized", "duplicateFinalSubmissions", "silentlyLostScans",
  ];
  for (const key of counters) {
    const value = outcome[key];
    if (value === undefined || value === null) continue;
    if (!Number.isInteger(value)) err(`'outcome.${key}' must be an integer`);
    else if (value < 0) err(`'outcome.${key}' must not be negative (got ${value})`);
  }

  if (Number.isInteger(attempts)) {
    for (const key of ["accepted", "retries", "wrongLearnerIdentities", "wrongAssessmentIdentities", "duplicateFinalSubmissions", "silentlyLostScans"]) {
      const value = outcome[key];
      if (Number.isInteger(value) && value > attempts) {
        err(`'outcome.${key}' (${value}) exceeds 'outcome.attempts' (${attempts})`);
      }
    }
  }

  // --- privacy -------------------------------------------------------------
  const walk = (node, path) => {
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      for (const pattern of FORBIDDEN_KEY_PATTERNS) {
        if (pattern.test(key)) {
          err(`forbidden field '${here}' — field records must never contain student-identifying or credential data`);
          break;
        }
      }
      // Content hashes are legitimately 64-hex and are REQUIRED by
      // buildIdentity, so they must be exempt from the credential-shape check —
      // otherwise the validator rejects the very field it mandates.
      const isDigestField = /sha256$|digest$/i.test(key);
      if (typeof value === "string" && !isDigestField) {
        for (const { name, re } of CREDENTIAL_VALUE_PATTERNS) {
          if (re.test(value.trim())) {
            err(`field '${here}' looks like a credential (${name}) — remove it`);
            break;
          }
        }
      }
      walk(value, here);
    }
  };
  walk(record, "");

  return issues;
}

// --- collect inputs ---------------------------------------------------------
let files = process.argv.slice(2);
if (files.length === 0) {
  const dir = join(repoRoot, "field-results");
  files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        // `*.skeleton.json` files are unfilled templates emitted by the session
        // generator. They are null-filled by design, so validating them would
        // fail the gate for every prepared-but-not-yet-run session. A skeleton
        // that has been filled in should be renamed (drop `.skeleton`) — that
        // rename is what marks it as real evidence.
        .filter((f) => !f.endsWith(".skeleton.json"))
        .map((f) => join(dir, f))
    : [];
  if (files.length === 0) {
    console.log("No field-result files found (field-results/*.json). Nothing to validate.");
    console.log("This is expected until physical device testing has been performed.");
    process.exit(0);
  }
}

let total = 0;
const allIssues = [];
for (const file of files) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    allIssues.push(`${basename(file)}: not valid JSON — ${error.message}`);
    continue;
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  records.forEach((record, index) => {
    total += 1;
    allIssues.push(...collectIssues(record, `${basename(file)}[${index}]`));
  });
}

console.log(`\nvalidated ${total} record(s) across ${files.length} file(s)`);
if (allIssues.length > 0) {
  console.error(`\n✗ FIELD RESULT VALIDATION FAILED — ${allIssues.length} issue(s):\n`);
  for (const issue of allIssues) console.error(`  • ${issue}`);
  console.error("");
  process.exit(1);
}
console.log("✓ all field records valid\n");
