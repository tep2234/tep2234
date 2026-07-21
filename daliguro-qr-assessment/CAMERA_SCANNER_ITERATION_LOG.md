# Camera Scanner Iteration Log

Continuation date: 2026-07-20
Branch: `security/smartscan-realtime-certification`
Base commit: `8b102a2`

Failed experiments are preserved here deliberately. Each cycle ends in one of
KEEP / REVISE / ROLLBACK / BLOCKED.

---

## Working-tree state found at the start of this continuation

Recorded before any file was modified. The git root is the parent directory
`tep2234`; only `daliguro-qr-assessment/` was touched. The sibling untracked
directory `daliguro/` is a neighbouring project and was not read or modified.

**Pre-existing uncommitted work (user-owned, NOT authored by this continuation):**

| File | Pre-existing change |
|---|---|
| `package.json` | `barcode-detector: ^3.2.1` dependency added |
| `package-lock.json` | lockfile entries for `barcode-detector` + transitive `zxing-wasm@3.1.1` |
| `src/lib/scanner/mobile-analyze.ts` | the `accept()` decoded-payload trust gate in `analyzeFrameData` |

**Authored by the previous turn of this session:** `CAMERA_SCANNER_OPEN_SOURCE_AUDIT.md` (untracked).

No `git checkout`, `restore`, `reset`, `stash`, or `clean` was used at any point.
All pre-existing work is intact and was built upon, not replaced.

---

## Phase 0 — audit verification and baseline

### Audit statements verified against the working tree

| Claim | Verdict | Evidence |
|---|---|---|
| `barcode-detector` installed but never imported | **Confirmed** | `grep -rn "barcode-detector" src/ tests/ browser-tests/` → no matches |
| Installed version / license | **Confirmed** | `barcode-detector@3.2.1`, MIT |
| `zxing-wasm` is transitive, not direct | **Confirmed** | sole dependency of `barcode-detector`; `zxing-wasm@3.1.1`, MIT |
| Native `BarcodeDetector` path location | **Confirmed** | `SmartScanMobilePage.tsx:117-127` (`readNativeQr`), `AnswerSheetScanner.tsx:456` |
| jsQR fallback location | **Confirmed** | `qr-detect.ts`, `qr-zone-rescue.ts` |
| iOS-specific expensive cascade | **Confirmed** | `SmartScanMobilePage.tsx:~676` passes `thoroughQr = !nativeQr` |
| `accept()` trust gate location | **Confirmed** | `mobile-analyze.ts:301-306` (uncommitted user work) |
| Worker can host the decoder | **Confirmed** | `omr-frame-worker.ts` is a module worker; `readBarcodes` accepts `ImageData` |
| No `ImageCapture` path exists | **Confirmed** | no `takePhoto`/`grabFrame` anywhere in `src/` |
| Four alignment markers already exist | **Confirmed** | `findCornerMarkers` + `solveHomography` in `omr-detect.ts` |

### Audit statements CORRECTED

1. **The audit said adding `zxing-wasm` as a direct dependency would mean "two
   copies of the WASM binary."** That is wrong. Pinning the identical version
   dedupes to one physical copy. More importantly, the correct integration
   target turned out to be `zxing-wasm/reader` directly, not the
   `barcode-detector` ponyfill — see the R1 design note below.

2. **The audit did not identify that the decoder fetches its WASM from a CDN by
   default.** `zxing-wasm`'s default `locateFile` points at
   `https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.1/...`. Combined with
   `public/sw.js:43` (`if (url.origin !== self.location.origin) return;` — the
   service worker deliberately never caches cross-origin responses), an
   unconfigured integration would have been **permanently unavailable offline**.
   This was the single most important finding of Phase 0.

3. **The audit reported the baseline as green.** It is not — see below.

### Baseline (measured, not assumed)

| Gate | Result |
|---|---|
| `npm run typecheck` | **FAIL** — 2 errors |
| `npm run lint` | PASS |
| `npm test` | PASS — 40 files, 403 tests |
| `npm run build` | **FAIL** — blocked by the same 2 tsc errors |

Both errors:

```
src/lib/scanner/mobile-analyze.ts(326,59): error TS2339: Property 'data' does not exist on type 'never'.
src/lib/scanner/mobile-analyze.ts(326,74): error TS2339: Property 'source' does not exist on type 'never'.
```

**Attribution: pre-existing, introduced by the uncommitted user work.** Proven
without modifying the tree via
`git show HEAD:...mobile-analyze.ts | grep -c "fallback"` → `1`, and that single
match is a comment on line 4. The `fallback` variable does not exist at HEAD.

The audit's "403 tests passing" was correct but incomplete: it did not run
typecheck or build.

---

## Cycle R0 — unblock the build (prerequisite)

**Observation.** `npm run build` cannot run, so no R1 bundle measurement, WASM
emission check, or offline verification is possible. R1's success conditions are
unreachable until this is fixed.

**Root cause (not a guess).** TypeScript control-flow analysis. `fallback` is
declared `let fallback: T | null = null` and assigned *only inside the `accept`
closure*. CFA does not track closure writes, so at `if (fallback)` the type is
still narrowed to `null` and the truthy branch is `never`.

**Success condition.** Typecheck and build pass; all 403 existing tests still
pass; the user's `accept()` logic and comments are preserved verbatim.

**Smallest safe change.** Move the closure-written value into a ref object so the
declared union survives. No `any`, no assertion, no `@ts-expect-error`, no lint
suppression, no behavioural change.

**Result: KEEP.** typecheck PASS, lint PASS, 403/403 tests PASS, build PASS.

---

## Cycle R1 — ZXing WASM decoder tier

**Observation.** Without a native `BarcodeDetector` (iOS Safari < 17, Firefox
Android), jsQR carries the entire decode load and the iOS workaround runs the
multi-transform cascade on every eligible frame.

**Execution path traced.**
`loop()` → `readNativeQr(canvas)` → `analyzeAsync(frame, nativeQr, !nativeQr)` →
worker `postMessage` (buffer transferred) → `analyzeFrameData` → jsQR cascade.
Main-thread fallback calls the same `analyzeFrameData` synchronously.

**Success condition.** With no native detector, a decodable QR is identified via
WASM; every decoded value still passes the full validation chain; jsQR still
runs when WASM yields nothing; no CDN dependency; one initialization per
session; entry bundles unchanged.

### Design decision: `zxing-wasm/reader` rather than the `barcode-detector` ponyfill

The brief permitted either. `zxing-wasm/reader` was chosen because
`readBarcodes()` accepts `ImageData` directly, which is structurally what the
worker already holds (`FrameImage`). The `barcode-detector` ponyfill's
`detect()` takes `ImageBitmapSourceWebCodecs`, which would force an
`ImageBitmap` conversion per frame inside the worker for no benefit.

**Consequence to flag:** the user's uncommitted `barcode-detector` dependency is
now redundant. It was deliberately **left in place** — it is user-owned
uncommitted work, and removing it is the user's call, not this continuation's.

### Architectural constraint discovered

`analyzeFrameData` is **synchronous**; `readBarcodes` is **async**. Making
`analyzeFrameData` async would ripple through the worker, the main-thread
fallback, and every existing test that calls it synchronously.

Avoided entirely by inserting the WASM tier *above* the sync pipeline, reusing
the existing `qrText` injection parameter that the native detector already uses.
`analyzeFrameData` keeps its synchronous signature and its jsQR cascade
untouched. Only an optional 5th parameter (`providedSource`, defaulted) was
added, so no existing caller or test changed.

**Files added:** `src/lib/scanner/zxing-qr.ts`, `src/lib/scanner/analyze-frame.ts`.

### Experiment R1-a — FAILED (test fixture, not implementation)

4 of 16 new tests failed. Symptom: `analysis.qrText` was `null` even though the
mocked decoder returned a payload.

**Cause: wrong assumption in my test fixture, not a defect in the code.**
Hand-written JSON (`{assessmentId, learnerId, version, n}`) is not a valid
payload — `decodeQrPayload` requires a `securityToken` and an integrity
`checksum`. The trust gate was correctly rejecting it.

This was a *useful* failure: it independently demonstrated that the gate rejects
unsigned payloads. **Not** worked around by weakening the assertion — the
fixtures were rebuilt through the real `buildQrPayload` / `qrText` encoder.

### Experiment R1-b — FAILED (non-deterministic fixture)

`expect(analysis.qrText).toBe(validPayload())` compared two *separate* calls, and
`buildSecurityToken` is non-deterministic. Fixed by binding the payload once.
Assertion strength unchanged.

### Experiment R1-c — REVISE (bundle placement)

First working build put the ~37 kB ZXing JS glue eagerly into the scanner page
chunk (`SmartScanMobilePage` 34.10 → **70.98 kB**). A phone with a native
`BarcodeDetector` would download glue it never executes — contrary to the brief's
lazy-loading requirement.

**Revision.** Converted the static `import { ... } from "zxing-wasm/reader"` into
a dynamic `import()` inside the cached loader.

**Result:** `SmartScanMobilePage` back to 34.95 kB (+0.85 kB over baseline) and a
separate on-demand `reader-*.js` chunk of 37.79 kB.

**Result: KEEP.** See `CAMERA_SCANNER_BENCHMARK.md` for full numbers.

### Residual issue accepted and documented, not hidden

The worker chunk grew 156.46 → 195.59 kB (**+39.13 kB**). Vite inlines the
dynamic import into the module-worker bundle rather than splitting it. The 1 MB
WASM binary is still correctly deferred, and the worker chunk itself only loads
when the camera starts. Accepted; recorded in the benchmark and known-failures.

The library's default jsDelivr `locateFile` string remains present in the bundle
as **dead code**. It is unreachable because `zxing-qr.ts` is the only module in
`src/` importing `zxing-wasm`, and it always passes the local override. A test
asserts the override is a non-absolute, non-CDN path.

### Post-R1 hardening: explicit dependency

`zxing-wasm` was only a *transitive* dependency (via `barcode-detector`), so
importing it directly would break if `barcode-detector` were ever removed. It
was added to `package.json` as a direct dependency pinned to `3.1.1` — the exact
version `barcode-detector` requires. `npm ls zxing-wasm` confirms one deduped
copy, and bundle sizes were byte-identical after the change.

---

## Cycle R2 — ImageCapture final-still ladder

**Observation.** `grabFrame()` is a canvas `drawImage` from the `<video>`
element, so the final still can never exceed the negotiated preview resolution.
`FINAL_CAPTURE_W = 2200` is a processing cap; drawing a 1280 px video frame onto
a 2200 px canvas only upscales and adds no detail.

**Success condition.** `takePhoto()` used where supported; `grabFrame()` second;
canvas always available as the final rung; true source dimensions reported
rather than the processing cap; every bitmap released on every path; no parallel
final captures; existing final-capture verification untouched.

**Design.** DOM primitives (`imageCapture`, `isTrackLive`, `decodeBlob`,
`drawBitmap`, `canvasCapture`) are injected into `captureFinalStill`, so the
ladder is unit-testable in jsdom and never assumes `ImageCapture` exists merely
because TypeScript has types for it. Feature detection is runtime
(`typeof Ctor !== "function"`), which is what iOS Safari requires.

**Files added:** `src/lib/scanner/final-still-capture.ts`,
`tests/final-still-capture.test.ts` (17 tests, passed first run).

**Integration.** `captureFinalFrame` in `SmartScanMobilePage` wires the ladder to
the real track. `drawBitmapToCanvas` caps the **longer** side at
`FINAL_CAPTURE_W`, preserving aspect ratio so the marker/homography mapping
stays valid, and leaves the chosen still painted on `canvasRef` — so the
pre-existing independent final QR decode reads the exact image that will be
scored. `verifyFinalMobileCapture` was **not modified**.

### Experiment R2-a — lint error, fixed properly

`no-useless-assignment`: `let finalStill = null` followed by an unconditional
assignment inside `try`. Replaced with `await captureFinalFrame().finally(...)`,
which is also more correct — the in-flight flag clears on rejection without
swallowing anything. Not suppressed.

### Experiment R2-b — exhaustive-deps warning, fixed properly

`captureFinalFrame` was missing from the `loop` dependency array. Added rather
than disabling the rule; a stale closure here would capture against a dead track.

### Follow-up: high-resolution stability regression tests

R2 widens the preview→final resolution ratio from ~1.7x (1300→2200) to ~3x
(1300→4000 full-sensor). An existing test covered the 2200 case; two were added
to `tests/frame-stability.test.ts`:

1. a 4000 px still is **accepted** (normalization holds at the new extreme);
2. a *genuinely blurred* 4000 px still is **still rejected**
   (`resetReason: "quality_changed"`).

The second is the important one: it proves the normalization did not become a
blanket excuse for any sharpness drop.

**Result: KEEP.** typecheck PASS, lint PASS, 438/438 tests PASS, build PASS.

---

## Post-implementation validation

`npx playwright test` initially **exited 0 having run nothing** — browser
binaries were absent, so all 31 specs errored into a skip. Exit code 0 made this
look like a pass; it was not. Chromium, Firefox, and WebKit were installed and
the suite re-run: **31 passed, 2 skipped**.

Correction recorded: an earlier statement in this session that the end-to-end
phone scan ran in WebKit was **wrong**. The 2 skips are that very test on
Firefox and WebKit — a pre-existing intentional skip
(`"fake camera capture is Chromium-only"`). The E2E phone scan ran in Chromium
only.

---
---

# Continuation 2 — hardening cycle (2026-07-21)

Baseline re-verified before any change: typecheck PASS, lint PASS, 438/438 tests
(42 files), build PASS, `npm audit --omit=dev` → **0 production vulnerabilities**
(1 high dev-only finding: eslint → minimatch → brace-expansion, pre-existing and
unrelated).

## Cycle 4 — false-green browser testing (Phase 1)

**Problem.** The previous report claimed "Playwright exited 0 having run nothing",
attributing a false-green to Playwright.

**Evidence collected.** Ran Playwright with browsers removed via
`PLAYWRIGHT_BROWSERS_PATH` pointed at an empty directory (env var only — nothing
deleted):

```
npx playwright test --project=chromium  → exit 1   (11 failed)
npx playwright test                     → exit 1
npx playwright test 2>&1 | tail -3      → exit 0   ← the false green
npx playwright test >/dev/null 2>&1     → exit 1
```

**ROOT CAUSE — and it corrects the previous report.** Playwright was never
broken. A shell pipeline returns the exit status of its **last** command, so
`npx playwright test | tail -15` reports *tail's* 0 and discards Playwright's 1.
The `tail` simultaneously truncated the "11 failed" line, leaving only
"2 skipped" on screen. **The defect was in how the command was invoked and read,
not in the tool.** The prior certification report's attribution was wrong and is
corrected here and in that report.

**Hypothesis for the residual risk.** Even with correct invocation, a
conditional `test.skip()` that silently widens could reduce the suite to zero
executed tests while exiting 0. That risk is real and unguarded.

**Experiment.** Added `scripts/verify-browser-tests.mjs` — runs Playwright
directly (no pipeline), then asserts against the JSON report that the run was
*substantive*: ≥1 test executed, **every configured project executed something**,
skips are on a documented allow-list, and no failures. Wired up as
`npm run test:browser:verify`.

**Negative controls — all three fail correctly, proving the gate is load-bearing:**

| Control | Result |
|---|---|
| Browser binaries missing | **exit 1** — "31 test(s) failed" |
| Zero tests executed (`--grep` matches nothing) | **exit 1** — "zero tests executed — the suite proved nothing" |
| Unexpected skip injected into `image-ingestion.spec.ts` | **exit 1** — lists each `skip [UNEXPECTED]` |

Environment restored after each control; `git diff -- browser-tests/` → 0 lines.

**Incidental finding (recorded, not swept aside).** Immediately after the third
control, the restored full run failed **1** test:
`firefox › prevents stale rapid replacements and allows same-file reselection`.
It passed twice in isolation and twice more in full runs. This is a **pre-existing
flake** (the file is unmodified vs HEAD), most likely webServer teardown timing
from the back-to-back control run. Not introduced here, not fixed here, recorded
in known-failures. The gate surfacing it is the gate working.

**Decision: KEEP.**

## Cycle 5 — offline WASM regression resistance (Phase 2)

**Problem.** `locateFile` was an inline arrow inside `loadReader`. A test could
only assert on strings, and a refactor could silently restore the CDN default.

**Experiment.** Extracted an application-owned `resolveZxingAssetUrl()` that does
not merely pass a URL through — it **enforces** the contract, throwing
`RemoteWasmAssetError` for any absolute URL that is not same-origin. The rule is
"same origin or nothing", not a CDN blocklist, so a novel host cannot slip past.

**Static contract test** (`tests/zxing-asset-origin.test.ts`, 10 tests) exercises
the real locator, including the exact jsDelivr URL zxing-wasm defaults to.

**Negative control.** Repointed the mocked bundled asset at the real jsDelivr
URL → `uses the bundled asset URL by default` **failed** with
`RemoteWasmAssetError`. Restored immediately; 10/10 green again.

**Decision: KEEP.**

## Cycle 6 — the real decoder in a real browser (Phases 2 + 4)

**Problem — the single biggest limitation of the previous cycle.** The ZXing tier
was only ever tested against a **mocked** `zxing-wasm/reader`. The central claim
of R1 was unproven.

**Experiment.** Built `browser-tests/decoder-harness.{html,ts}` — loads the
**actual ~1 MB WASM binary**, renders QR fixtures from the **real** DALIguro
encoder, and exposes decode/analyze entry points. Then
`browser-tests/decoder-origin.spec.ts` (15 tests) asserts network origin, single
instantiation, real decoding across seven degradations, trust-gate rejection, and
offline-after-load behaviour.

### Failed experiment 6-a — 4 failures, all my fixtures

First run: 11 passed, **4 failed**. Every one was a defect in my test fixtures,
not in the implementation:

1. **"instantiates exactly once"** — I asserted `log.wasm.length === 1` but got 2.
   Probed the actual URLs: the Vite **dev server** legitimately serves
   `zxing_reader.wasm?import&url` (module resolution returning a URL *string*)
   *and* the binary. Only one is a real fetch. `initCount` was correctly 1 all
   along. **Fixed the assertion** to exclude `?import`, and documented why.
2. **"shares a single initialization"** — same wrong assertion.
3. **rotated QR** — I rotated 15° inside a canvas the same size as the symbol,
   which **clips the corners and destroys the finder patterns**. Fixed by sizing
   the canvas to `S*(|cosθ|+|sinθ|)`. Also fixed a related bug: the background
   fill ran *after* the rotation transform, painting a rotated square and leaving
   white wedges.
4. **shadowed QR** — a full-frame 0.45-alpha wash was testing the fixture's
   severity, not the decoder. Softened to a realistic partial corner gradient.

**Result after fixes: 15/15 in Chromium; 45/45 across Chromium + Firefox +
WebKit.**

**This is the most significant result of the continuation.** WebKit is iOS
Safari's engine — the environment with no `BarcodeDetector` and the entire reason
R1 exists. The real binary now demonstrably decodes standard, small, rotated,
low-contrast, grayscale, blurred and shadowed QR fixtures there, fetches only
from the app origin, and keeps decoding with the network disabled.

**Decision: KEEP.**

## Cycle 7 — dependency ownership (Phase 3)

**Evidence.** `grep -rn "barcode-detector"` across `src/`, `tests/`,
`browser-tests/`, `scripts/`, and all configs → **no references**. Lockfile
analysis: only the root package depends on it.

**Action.** Removed `barcode-detector`. `zxing-wasm@3.1.1` remains an explicit
direct dependency (pinned; `npm ls` shows one copy).

**Measurement.** Bundle output **byte-identical** before and after — only content
hashes changed — confirming it contributed nothing. `npm audit --omit=dev` → 0.

Note: this removes a package the *user* had added uncommitted. Done because Phase
3 of the instruction explicitly directs removal when unused ("Do not retain it
merely because it was installed earlier"), and because R1 supersedes it.

**Decision: KEEP.**

## Cycle 8 — endurance proxy (Phase 5)

Added a 100-iteration capture test rotating through all three ladder rungs,
asserting every capture resolves, all three rungs are genuinely exercised, and
**every bitmap is closed exactly once**. 18/18 in that file.

**Decision: KEEP.**

## Cycle 9 — field validation package (Phase 6)

Created `CAMERA_SCANNER_FIELD_VALIDATION_PLAN.md`,
`CAMERA_SCANNER_FIELD_RESULTS.md`, `CAMERA_SCANNER_FIELD_RESULTS_TEMPLATE.json`.
The JSON schema forbids student names, real LRNs, tokens, raw payloads and raw
images by construction, and instructs testers to leave unmeasured values `null`
("a null is honest; an invented number corrupts the record"). No new production
diagnostics were added — the existing `QR path:` / `Still:` UI readouts already
carry what the plan needs.

**Decision: KEEP.**

## Cycle 10 — the Firefox flake (Continuation 3, 2026-07-21)

**Problem.** `firefox › prevents stale rapid replacements and allows same-file
reselection` failed once. I had previously characterised it as "~1-in-4", from a
single observation across ~4 runs.

**Evidence collected — 118 further executions, ZERO failures:**

| Condition | Runs | Failures |
|---|---|---|
| Isolated, `--repeat-each` | **100** | 0 |
| Full Firefox project suite | 10 | 0 |
| Full 3-browser gate | 3 | 0 |
| After restore from negative control | 5 | 0 |

**Correction:** the "~1-in-4" figure was an overstatement extrapolated from one
data point. The observed rate is at most **1 in 119**, and the single failure
occurred immediately after a back-to-back negative-control run — consistent with
webServer teardown/startup timing, not an application race.

### Negative control 10-a — FAILED to fail (valuable)

Defeated `ScannerGeneration.isCurrent()` (`return true`). **The test still
passed, 5/5.** So the test is *not* load-bearing on `isCurrent` alone: the
primary defence is the `AbortController.abort()` in `begin()`, and the assertion
`/CANCELLED|STALE/` accepts either mechanism's outcome.

This is worth recording: had I stopped here I would have wrongly concluded the
test was vacuous.

### Negative control 10-b — load-bearing confirmed

Defeated **both** mechanisms (no supersede-abort in `begin()`, plus
`isCurrent → true`). **5/5 failed** with
`expect(replacements[0].result).toMatchObject({ok:false, code:/CANCELLED|STALE/})`
receiving `ok: true`.

Both controls restored immediately; `git diff -- src/lib/scanner/image-ingestion.ts`
→ 0 lines.

**Decision: KEEP — no code change.** The stale-replacement logic is correct and
defended by two independent mechanisms. Deliberately did **not** add a retry,
raise a timeout, skip Firefox, or mark the test flaky.

**Remaining risk.** A ≤1-in-119 environment-sensitive flake may still surface in
CI. The browser gate will report it as a failure (correctly), not hide it.

## Cycle 11 — runtime asset-origin audit (Phase 2)

**Source audit.** No remote URLs in any scanner runtime path; the only CDN string
in `src/` is the `FORBIDDEN_ASSET_HOSTS` guard itself.

**Built-output audit** (the one that actually matters):

| Asset | Resolved as | Verdict |
|---|---|---|
| Worker | `new URL('/assets/omr-frame-worker-*.js', import.meta.url)` | same-origin by construction |
| WASM | `'/assets/zxing_reader-*.wasm'` | root-relative |
| Decoder chunk | `import('./reader-*.js')` | relative |
| Service worker | no absolute URLs at all | clean |

Remaining `https://` strings are Supabase (a legitimate API), the app's own
Vercel URL inside a user-facing message, documentation links in error text, and
zxing-wasm's dead jsDelivr default (guarded).

**Tests added** (`decoder-origin.spec.ts`): an accepted native result performs
**zero** WASM fetches and leaves `initCount`/`decodeCount` at 0; the worker
script is same-origin. **17/17 chromium; 82 executed across all three browsers.**

**Decision: KEEP.**

## Cycle 12 — reproducible field-build identity (Phase 3)

`scripts/create-camera-field-manifest.mjs` → `CAMERA_SCANNER_FIELD_BUILD_MANIFEST.{json,md}`.

Records branch, HEAD, dirty state, sorted modified/untracked paths, **SHA-256 of
the diff**, lockfile hash, toolchain, and content hashes of the emitted WASM,
worker, decoder chunk, scanner page and service worker.

**Privacy design:** the diff is *hashed, never stored*, so an uncommitted secret
cannot leak through the manifest.

**Determinism test.** Two runs with no tree change → identity fields byte-identical
(only `generatedAt` differs). **Sensitivity test.** A one-line append to a tracked
test file changed `diffSha256`; after restore it returned to the original value.
Both required properties hold — reproducibility is not claimed on a timestamp.

**Decision: KEEP.**

## Cycle 13 — enforceable field-result collection (Phase 4)

`scripts/validate-camera-field-results.mjs` (`npm run camera:field:validate`).

### Failed experiment 13-a — validator false positive, caught by its own baseline

The first version rejected the **valid** reference record: my credential-shape
rule `^[0-9a-f]{64}$` matched `buildIdentity.diffSha256` — the very field the
validator *mandates*. Fixed by exempting `*sha256`/`*digest` keys rather than
weakening the credential check.

Had I only run the negative controls, this would have shipped as a validator that
rejects every correct record.

**Seven negative controls, all reject correctly:**

| # | Injected defect | Rejected as |
|---|---|---|
| 1 | missing build identity | "a result that cannot be tied to an exact build is not evidence" |
| 2 | missing browser version | missing required field |
| 3 | accepted (25) > attempts (20) | impossible count |
| 4 | `studentName` | forbidden student-identifying field |
| 5 | 64-hex `capability` | forbidden credential field |
| 6 | `qrPath: "magic-cloud-ocr"` | unsupported decoder path |
| 7 | `stillSource: "screenshot"` | unsupported capture source |

**Decision: KEEP.**

---
---

# Continuation 4 — field-session preparation (2026-07-21)

Local gates re-verified first: typecheck 0, lint 0, 449/449, build 0, audit 0
production vulnerabilities, browser gate 82/82.

**Script-name correction.** The instruction referenced `npm run camera:field`.
No such script exists. The actual scripts are `camera:field:manifest` and
`camera:field:validate`; both were run and are recorded here.

## Cycle 14 — field-session ground truth (Phase 2)

**Problem.** "The scan worked" is not measurable. The acceptance gate is
"observed learner == expected learner", which requires the expectation to be
written down *before* scanning.

**Decision: reuse, do not invent.** `buildDemoBundle()` already provides the
synthetic roster (`A_demo`, `L_demo1..L_demo5`, 10 items, versions A/B) and is
covered by `tests/demo.test.ts`. A second synthetic dataset would have been
redundant and could drift.

**Decision: do NOT generate printable sheets.** The production layout is rendered
by `src/components/AnswerSheet.tsx` from the canonical OMR template. A second
print path could drift from production geometry, and Phase 3 explicitly requires
the production layout — so the session document instructs printing from the app.

`scripts/create-camera-field-session.mjs` emits an operator checklist with a
per-attempt ground-truth table, plus a null-filled result skeleton stamped with
the frozen build identity.

**Confirmed:** QR text is *non-deterministic* (`buildSecurityToken` includes a
random component), so ground truth is recorded as learner/assessment/version
identity, not exact payload text. That is what the gate actually needs.

### Defect 14-a — the validator failed on its own skeleton

`npm run camera:field:validate` exited 1 because the newly written
`*.skeleton.json` is null-filled by design. A prepared-but-unrun session would
have failed the gate for everyone.

**Fix:** the validator skips `*.skeleton.json`. Renaming a filled skeleton (drop
`.skeleton`) is what marks it as real evidence.

### Defect 14-b — the roster fallback could drift silently

The session script falls back to a literal roster when its module loader is
unavailable. A drift would plan a session against learners that are not on the
printed sheets, making every scan look like a wrong-identity failure.

First attempt restated the literal *inside the test* — which guards nothing,
since the script holds its own copy. Corrected to **parse the script itself**.
Negative control: drifting the script's `assessmentId` to `A_WRONG_DRIFTED`
failed the test (`expected 'A_demo' to be 'A_WRONG_DRIFTED'`); restored, 6/6 green.

## Cycle 15 — CRITICAL: the field-build manifest did not identify the build

**Discovered while verifying Cycle 14.** Adding two new files left `diffSha256`
unchanged.

**Root cause, in two parts:**

1. `git diff` covers **tracked files only**. Most new scanner source
   (`zxing-qr.ts`, `analyze-frame.ts`, `final-still-capture.ts`, the browser
   harness) is **untracked**, so its content was never hashed.
2. Worse: `git ls-files --others` run from a subdirectory returns **cwd-relative**
   paths, while `git diff --name-only` returns **repo-root-relative** paths. The
   `scopedPaths()` filter required the package prefix and therefore silently
   discarded **every** untracked file — `untrackedPaths` was `0` the whole time.

**Proven by experiment**, not inferred: appending one line to `zxing-qr.ts` left
`diffSha256` byte-identical. **The manifest was failing at its only job** — a
field result could have been attributed to the wrong scanner code.

**Fix.** Normalise both git path formats; hash untracked file **content**; add
`treeSha256 = H(commit ‖ diffHash ‖ untrackedHash)` as the authoritative identity.

### Defect 15-a — self-reference made the identity non-deterministic

First fix made the manifest hash *itself* (it is untracked), so every run changed
its own input: three consecutive runs on identical code produced three different
identities.

**Fix:** exclude the manifest's own outputs, `field-results/`, and session
documents. Identity must describe the **code**, not the record of the code.

**Verification — both properties now hold simultaneously:**

| Property | Result |
|---|---|
| Deterministic across 3 runs, no code change | ✓ identical |
| Untracked scanner edit (`analyze-frame.ts`) | ✓ identity changes |
| Tracked edit (`frame-stability.test.ts`) | ✓ identity changes |
| Restore after each probe | ✓ returns to original |
| Sibling project `daliguro/` leakage | ✓ none |

26 untracked files are now hashed, including `zxing-qr.ts`.

**Decision: KEEP.** Every earlier manifest identity in this repository is
superseded; any field result quoting only `diffSha256` should be re-stamped with
`treeSha256`.

## Frozen field build

| Field | Value |
|---|---|
| Branch | `security/smartscan-realtime-certification` |
| HEAD | `8b102a26b1d9e5ff45968e1bd1f03d9994a6adf7` |
| Tree SHA-256 (authoritative) | `f6fb5baacbffc2e64fa378f95455c1398b0ba02fd373c74edb63d29c3646f260` |
| Diff SHA-256 (tracked) | `7011849d227fa6d465c2bb9018e687d8d1d59b649fe37edbdc298e61fe6697b7` |
| Untracked content SHA-256 | `ecc78f60af327b9bf52b7bd5f29c52546fcd73de42d60c04c2bd7360ba482ad9` |
| package-lock SHA-256 | `4e7d290ebf4ac33992a3907e0b6aa527c60f35068ea43c29ace1edc59af4c119` |
| WASM asset | `zxing_reader-DHMvH2D8.wasm` (`6a858c01e076bab3…`) |
| Worker asset | `omr-frame-worker-CqJumh3Z.js` (`0879a4f60247c327…`) |
| Service worker | `daliguro-qr-v5` |
| Unit tests | 455 / 455 (44 files) |
| Browser tests | 82 executed, 82 passed, 2 intentional skips |

## Cycle 16 — FIRST PHYSICAL EVIDENCE: iOS safe-area overlap

**Source.** A screenshot from a physical iPhone (iOS, Safari, LTE) — the first
real-device evidence in this entire effort.

### Build attribution — the evidence is NOT the frozen field build

The screenshot shows `daliguro-qr-assessment.vercel.app` and an engine label
reading `1525ms/frame`. That string exists **neither in the current working tree
nor at HEAD** (`grep` → 0 in both). The deployed production build therefore
predates this work entirely: it contains **no R1 (zxing-wasm) and no R2**.

Consequences, stated precisely:

- The **1525 ms/frame** figure **cannot be attributed to current code**. It is
  the old iOS jsQR-thorough-cascade cost — the exact problem R1 exists to fix,
  measured on a build without R1. It is *consistent with* R1's premise but is
  **not** evidence that R1 works.
- The **`main-thread fallback`** label likewise describes the old build. Why the
  worker failed there cannot be diagnosed from a screenshot; not investigated,
  not guessed at.
- **No field-result record was created.** The build identity is unknown and
  would fail `camera:field:validate` — correctly.

### The defect that IS reproducible in current code

Header text (`Camera companion · … · A_demo`) renders **underneath the iOS
status bar**, colliding with the clock and clipped by the signal icons.

**Root cause.** `index.html` sets `viewport-fit=cover`, which deliberately
extends the page under the notch and home indicator, but **no element applied
`env(safe-area-inset-*)` padding** — `grep -rn "safe-area" src/` returned
nothing. The shell used a flat `p-3` (12 px) where ~47 px of system UI sits.

Independent of the deployed build: present in the current tree, and in HEAD.

### Fix

`--app-safe-{top,right,bottom,left}` custom properties default to `env(...)`;
an `.app-safe-area` class adds them to the shell's own `--app-shell-pad`.

**Why the indirection matters:** `env(safe-area-inset-*)` always resolves to
`0px` in a desktop test browser, so a test asserting on `env()` directly would
pass whether or not the fix existed — a vacuous guard. Routing through custom
properties lets a browser test inject a realistic 47 px inset.

### Negative control

Reverted the shell to the pre-fix `p-3` className:

```
Expected: 59   Received: 12      (padding-top)
Expected: >= 47                  (header y position)
```

**4/4 failed** — a 47 px intrusion, exactly the overlap in the screenshot.
Restored; 12/12 green across Chromium, Firefox and WebKit.

### Result

| Gate | Result |
|---|---|
| typecheck / lint / build | PASS |
| Unit tests | 455 / 455 |
| Browser tests | **97 executed, 97 passed** (was 82) |
| Safe-area suite | 12/12 across all three engines |

**Decision: KEEP.** Scanner decode/identity logic untouched — this is a layout
fix only. Deliberately did **not** speculatively "fix" the 1525 ms figure or the
worker fallback: both belong to a build that is not this one.

**Remaining risk.** The fix is verified against a *simulated* inset in desktop
engines. Confirmation on a real notched iPhone is still required.

**Next action.** Deploy a build containing R1 + R2 + this fix to the preview
environment, then re-screenshot the same header and re-measure the engine label.

## Phases 5–12 — BLOCKED_EXTERNAL (no physical device)

Session materials are prepared and the build is frozen. No iPhone, Android
device, or printer is available to this environment, so **no physical scan was
performed and no field result exists.** All device rows in
`CAMERA_SCANNER_FIELD_RESULTS.md` remain `NOT RUN`.

## Phases 5–11 — BLOCKED_EXTERNAL

No iPhone, Android phone, or low-cost device is available to this environment.
Every device gate is recorded as `NOT RUN` in `CAMERA_SCANNER_FIELD_RESULTS.md`.
Deliberately **not** filled in from WebKit results: WebKit shares iOS Safari's
rendering engine but not its camera stack, ISP, thermal envelope, or memory
ceiling.
