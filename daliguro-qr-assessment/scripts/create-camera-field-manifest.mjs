#!/usr/bin/env node
// Field-build identity manifest.
//
// WHY: the working tree is uncommitted, so "we tested commit X" is not a true
// statement. A device result that cannot be tied to an exact artifact is not
// evidence — it is an anecdote. This records a content-addressed identity for
// the tree, the lockfile, and the emitted scanner assets, so a field result can
// later be matched to, or reconstructed from, exactly what was tested.
//
// PRIVACY: records only code/build identity. No tokens, secrets, env values,
// student data, QR payloads, or images. `git diff` content is HASHED, never
// stored, so an uncommitted secret cannot leak through this file.
//
// Usage: node scripts/create-camera-field-manifest.mjs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distAssets = join(repoRoot, "dist", "assets");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function cmd(bin, args) {
  try {
    return execFileSync(bin, args, { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

// Only paths inside this package; the repository root is a parent directory
// shared with sibling projects that are explicitly out of scope.
//
// CAREFUL: the two git commands used below disagree about path format when run
// from a subdirectory. `git diff --name-only` yields repo-root-relative paths
// (`daliguro-qr-assessment/src/...`), while `git ls-files --others` yields
// cwd-relative paths (`src/...`). An earlier version filtered on the package
// prefix alone and therefore silently discarded EVERY untracked file, leaving
// the identity blind to most of the new scanner source. Normalise both forms.
const PKG_PREFIX = "daliguro-qr-assessment/";
function scopedPaths(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    // Drop anything belonging to a sibling project at the repo root.
    .filter((p) => p.startsWith(PKG_PREFIX) || !p.includes("/") || !p.split("/")[0].startsWith("daliguro"))
    .map((p) => (p.startsWith(PKG_PREFIX) ? p.slice(PKG_PREFIX.length) : p))
    .sort();
}

// Hash the diff rather than storing it: identity without disclosure.
const diffText = git(["diff", "--", "."]);
const modified = scopedPaths(git(["diff", "--name-only", "--", "."]));
const untracked = scopedPaths(git(["ls-files", "--others", "--exclude-standard", "--", "."]));

// CRITICAL: `git diff` covers TRACKED files only. Much of the scanner
// (zxing-qr.ts, analyze-frame.ts, final-still-capture.ts, the browser harness)
// is currently UNTRACKED, so hashing the diff alone would let the scanner
// source change while the recorded identity stayed constant — proven by
// experiment on 2026-07-21, and exactly the failure this manifest exists to
// prevent. Untracked file CONTENT is therefore hashed too.
// Outputs of this script and of field testing are EXCLUDED from the identity.
// The manifest is itself untracked, so hashing it would make each run change
// its own input — the identity would never stabilise and two consecutive runs
// on identical code would disagree. Identity must describe the CODE, not the
// record of the code. Field results are evidence about a build, not part of it.
const IDENTITY_EXCLUDED = [
  "CAMERA_SCANNER_FIELD_BUILD_MANIFEST.json",
  "CAMERA_SCANNER_FIELD_BUILD_MANIFEST.md",
];
const isExcluded = (p) =>
  IDENTITY_EXCLUDED.includes(p) ||
  p.startsWith("field-results/") ||
  p.startsWith("CAMERA_SCANNER_FIELD_SESSION_");

const untrackedFiles = untracked.filter((p) => !isExcluded(p)).map((relative) => {
  const absolute = join(repoRoot, relative);
  try {
    return { path: relative, sha256: sha256(readFileSync(absolute)) };
  } catch {
    // Unreadable (deleted mid-run, permissions): record it as such rather than
    // silently dropping it from the identity.
    return { path: relative, sha256: "UNREADABLE" };
  }
});
const untrackedSha256 = untrackedFiles.length
  ? sha256(untrackedFiles.map((f) => `${f.path}:${f.sha256}`).join("\n"))
  : null;

// The single authoritative identity. Covers tracked modifications AND
// untracked content. Two manifests describe the same code iff headCommit and
// treeSha256 both match.
const treeSha256 = sha256(
  [`commit:${git(["rev-parse", "HEAD"])}`, `diff:${diffText ? sha256(diffText) : "none"}`, `untracked:${untrackedSha256 ?? "none"}`].join("\n"),
);

// Emitted scanner assets, identified by content.
function hashAssets(predicate) {
  if (!existsSync(distAssets)) return [];
  return readdirSync(distAssets)
    .filter(predicate)
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(distAssets, name));
      return { filename: name, bytes: bytes.length, sha256: sha256(bytes) };
    });
}

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const lockBytes = readFileSync(join(repoRoot, "package-lock.json"));

const swPath = join(repoRoot, "public", "sw.js");
const swBytes = existsSync(swPath) ? readFileSync(swPath) : null;
const swVersion = swBytes
  ? (swBytes.toString("utf8").match(/CACHE_VERSION\s*=\s*"([^"]+)"/) ?? [])[1] ?? null
  : null;

const manifest = {
  _description:
    "Identity of the exact scanner artifact used for physical field validation. Contains no secrets, credentials, or student data; the working-tree diff is hashed, not stored.",
  generatedAt: new Date().toISOString(),

  source: {
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    headCommit: git(["rev-parse", "HEAD"]),
    // The tree is expected to be dirty during this work; that is precisely why
    // the diff hash below exists.
    dirty: Boolean(diffText) || untracked.length > 0,
    modifiedPaths: modified,
    untrackedPaths: untracked,
    diffSha256: diffText ? sha256(diffText) : null,
    diffByteLength: Buffer.byteLength(diffText),
    // Content hashes of untracked files — without these the identity would
    // ignore most of the new scanner source.
    untrackedFiles,
    untrackedSha256,
    // THE authoritative identity. Use this, not diffSha256, to decide whether
    // two field results describe the same build.
    treeSha256,
  },

  dependencies: {
    packageLockSha256: sha256(lockBytes),
    appVersion: pkg.version ?? null,
    zxingWasmVersion: pkg.dependencies?.["zxing-wasm"] ?? null,
    jsqrVersion: pkg.dependencies?.jsqr ?? null,
    // Recorded to make its absence explicit and auditable: it was removed after
    // being proven unused.
    barcodeDetectorVersion: pkg.dependencies?.["barcode-detector"] ?? null,
  },

  toolchain: {
    node: process.version,
    npm: cmd("npm", ["--version"]) || null,
    platform: `${process.platform}-${process.arch}`,
  },

  assets: {
    wasm: hashAssets((n) => n.endsWith(".wasm")),
    worker: hashAssets((n) => n.includes("omr-frame-worker") && n.endsWith(".js")),
    decoderChunk: hashAssets((n) => n.startsWith("reader-") && n.endsWith(".js")),
    scannerPage: hashAssets((n) => n.includes("SmartScanMobilePage") && n.endsWith(".js")),
    serviceWorker: swBytes
      ? { filename: "public/sw.js", bytes: swBytes.length, sha256: sha256(swBytes), cacheVersion: swVersion }
      : null,
  },

  // Filled by the caller after running the gates; left null rather than guessed.
  validation: {
    unitTestFiles: null,
    unitTests: null,
    browserTestsExecuted: null,
    browserTestsPassed: null,
    browserIntentionalSkips: null,
    note: "Populate from `npm test` and `npm run test:browser:verify` for the run this manifest describes. Leave null if not measured.",
  },
};

const jsonPath = join(repoRoot, "CAMERA_SCANNER_FIELD_BUILD_MANIFEST.json");
writeFileSync(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`);

const assetRows = [
  ...manifest.assets.wasm.map((a) => ["WASM", a]),
  ...manifest.assets.worker.map((a) => ["Worker", a]),
  ...manifest.assets.decoderChunk.map((a) => ["Decoder chunk", a]),
  ...manifest.assets.scannerPage.map((a) => ["Scanner page", a]),
]
  .map(([kind, a]) => `| ${kind} | \`${a.filename}\` | ${a.bytes.toLocaleString()} | \`${a.sha256.slice(0, 16)}…\` |`)
  .join("\n");

const md = `# Camera Scanner — Field Build Manifest

Generated: ${manifest.generatedAt}

This identifies the **exact artifact** used for physical device validation. The
working tree is uncommitted, so a commit hash alone would not describe what was
tested. The diff is **hashed, not stored** — this file carries identity without
disclosing code or leaking any uncommitted secret.

## Source identity

| Field | Value |
|---|---|
| Branch | \`${manifest.source.branch}\` |
| HEAD commit | \`${manifest.source.headCommit}\` |
| Working tree | ${manifest.source.dirty ? "**dirty** (uncommitted changes present)" : "clean"} |
| **Tree SHA-256 (authoritative)** | \`${manifest.source.treeSha256}\` |
| Diff SHA-256 (tracked only) | \`${manifest.source.diffSha256 ?? "(none)"}\` |
| Untracked content SHA-256 | \`${manifest.source.untrackedSha256 ?? "(none)"}\` |
| Diff size | ${manifest.source.diffByteLength.toLocaleString()} bytes |
| Modified files | ${manifest.source.modifiedPaths.length} |
| Untracked files | ${manifest.source.untrackedPaths.length} |

**Two manifests describe the same code if and only if \`headCommit\` and
\`treeSha256\` both match.** \`treeSha256\` covers tracked modifications AND
untracked file content — \`diffSha256\` alone does not, because \`git diff\` ignores
untracked files and much of the scanner source is currently untracked.

## Dependencies

| Field | Value |
|---|---|
| package-lock SHA-256 | \`${manifest.dependencies.packageLockSha256}\` |
| zxing-wasm | \`${manifest.dependencies.zxingWasmVersion ?? "(absent)"}\` |
| jsQR | \`${manifest.dependencies.jsqrVersion ?? "(absent)"}\` |
| barcode-detector | ${manifest.dependencies.barcodeDetectorVersion ?? "**removed** (proven unused)"} |

## Toolchain

Node \`${manifest.toolchain.node}\`, npm \`${manifest.toolchain.npm ?? "unknown"}\`, platform \`${manifest.toolchain.platform}\`.

## Emitted scanner assets

| Kind | Filename | Bytes | SHA-256 |
|---|---|---|---|
${assetRows || "| _(none — run `npm run build` first)_ | | | |"}

Service worker: ${
  manifest.assets.serviceWorker
    ? `\`${manifest.assets.serviceWorker.filename}\`, cache version \`${manifest.assets.serviceWorker.cacheVersion}\`, SHA-256 \`${manifest.assets.serviceWorker.sha256.slice(0, 16)}…\``
    : "_not found_"
}

## How to use this

1. Run \`npm run build\`, then \`npm run camera:field:manifest\`.
2. Copy \`source.headCommit\` and \`source.diffSha256\` into every field-result
   record's \`buildIdentity\`.
3. If either value changes, **previous field results no longer describe the
   current build** and the affected device tests must be repeated.
`;

writeFileSync(join(repoRoot, "CAMERA_SCANNER_FIELD_BUILD_MANIFEST.md"), md);

console.log(`✓ manifest written`);
console.log(`  commit    : ${manifest.source.headCommit}`);
console.log(`  dirty     : ${manifest.source.dirty}`);
console.log(`  treeSha256: ${manifest.source.treeSha256}`);
console.log(`  diffSha256: ${manifest.source.diffSha256}`);
console.log(`  lockSha256: ${manifest.dependencies.packageLockSha256}`);
console.log(`  wasm      : ${manifest.assets.wasm.map((a) => a.filename).join(", ") || "(none)"}`);
