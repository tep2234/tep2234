# Camera Scanner Certification Report — R1 + R2

Date: 2026-07-20
Branch: `security/smartscan-realtime-certification`
Base commit: `8b102a2`
Scope: mobile camera scanner only. Desktop scanner path (W3) explicitly untouched.

---

## 1. Final status

## `BLOCKED_EXTERNAL`

*(Updated 2026-07-21 after the hardening cycle. The previous status was
`PASS_WITH_LIMITATIONS`.)*

Every locally possible engineering task is complete. All local gates pass:
typecheck, lint, **449/449** unit tests, build, `npm audit --omit=dev` clean, and
**76/76** browser tests executed truthfully across Chromium, Firefox and WebKit.

The status moved from `PASS_WITH_LIMITATIONS` to `BLOCKED_EXTERNAL` **not because
anything regressed**, but because it is now an accurate description of the
situation: the remaining work is not "limitations to note", it is a specific,
enumerated set of proofs that require physical hardware this environment does not
have. `CAMERA_SCANNER_FIELD_VALIDATION_PLAN.md` specifies exactly how to obtain
them.

`PASS` is not claimed. Of the 20 PASS conditions, **12 are met**; the 8
outstanding ones (iPhone Safari, Android Chrome, `takePhoto` hardware,
airplane-mode, 50-scan endurance, and the four hardware integrity gates) all
require a device.

### What changed since the previous report

| Previously unproven | Now |
|---|---|
| ZXing tier only ever tested against a **mock** | **Real ~1 MB WASM binary** decodes real fixtures in Chromium, Firefox **and WebKit** (45 assertions) |
| Same-origin WASM loading argued structurally | **Proven by network interception** in a real browser |
| Offline decoding argued structurally | **Proven** — 10 decodes with the network disabled, zero further requests |
| jsDelivr default was "unreachable dead code" | **Actively refused** at runtime by `resolveZxingAssetUrl()` |
| Browser suite could false-green | **Guarded**, with three passing negative controls |
| `barcode-detector` redundant but retained | **Removed**; build output byte-identical |

---

## 2. Baseline test result (measured, not assumed)

| Gate | Baseline | Attribution |
|---|---|---|
| `npm run typecheck` | **FAIL** — 2 errors | **Pre-existing**, from uncommitted user work |
| `npm run lint` | PASS | — |
| `npm test` | PASS — 40 files, 403 tests | matches prior audit |
| `npm run build` | **FAIL** — blocked by the same 2 tsc errors | **Pre-existing** |

The prior audit's claim of a green baseline was wrong; it had not run typecheck or
build. Proof the errors predate this work, obtained without modifying the tree:
`git show HEAD:...mobile-analyze.ts | grep -c "fallback"` → `1`, and that single
match is a comment on line 4. The `fallback` variable does not exist at HEAD.

---

## 3. R1 implementation result — **KEEP**

ZXing WASM inserted as a controlled tier between the native fast path and the jsQR
cascade. Neither existing decoder was removed or modified.

---

## 4. R2 implementation result — **KEEP**

`ImageCapture.takePhoto() → grabFrame() → canvas` ladder added. The canvas path is
unchanged and remains the universal fallback.

---

## 5. Existing uncommitted work found (preserved)

Recorded before anything was modified:

| File | Pre-existing change | Disposition |
|---|---|---|
| `package.json` / `package-lock.json` | `barcode-detector@^3.2.1` | **Preserved.** Now redundant (§8) but left in place — user-owned. |
| `src/lib/scanner/mobile-analyze.ts` | the `accept()` trust gate | **Preserved and built upon.** Logic and comments intact; only the closure-narrowing type error was fixed. |

No `git checkout`, `restore`, `reset`, `stash`, or `clean` was used at any point.
The sibling untracked directory `daliguro/` was never read or modified.

---

## 6. Files changed by this continuation

**Modified (7):**

| File | Change |
|---|---|
| `src/lib/scanner/mobile-analyze.ts` | R0 type fix; `identitySource`/`qrSource` unions extended; optional `providedSource` param (defaulted, so no caller changed) |
| `src/lib/scanner/omr-frame-worker.ts` | routes through `analyzeFrameAsync`; contains rejections and still answers the frame |
| `src/pages/SmartScanMobilePage.tsx` | main-thread fallback shares the same cascade; R2 ladder wiring; in-flight guard; `Still:` diagnostic |
| `src/lib/sync/pairing.ts` | `identitySource` union + `"zxing-wasm"` |
| `src/lib/sync/scan-outbox.ts` | `identitySource` union + `"zxing-wasm"` |
| `public/sw.js` | `CACHE_VERSION` v4 → v5 |
| `tests/frame-stability.test.ts` | +2 high-resolution tests (additive; no existing test altered) |

**Added (6):** `src/lib/scanner/zxing-qr.ts`, `src/lib/scanner/analyze-frame.ts`,
`src/lib/scanner/final-still-capture.ts`, `tests/zxing-fallback.test.ts`,
`tests/final-still-capture.test.ts`, plus the five `CAMERA_SCANNER_*.md` documents.

**Deleted:** none.

---

## 7. Dependencies added

**`zxing-wasm@3.1.1` (MIT)** — promoted from transitive to an explicit direct
dependency, pinned to the exact version `barcode-detector` already required.
`npm ls zxing-wasm` confirms **one deduped copy**. No new package was downloaded;
this only makes an existing transitive package explicit, so the direct import
does not break if `barcode-detector` is removed.

No other dependency was added. No CDN, no OpenCV, no OMR library, no camera framework.

## 8. Dependencies removed

**None.** `barcode-detector@3.2.1` is now unused — R1 integrates
`zxing-wasm/reader` directly because `readBarcodes()` accepts `ImageData`, which
is structurally what the worker already holds, whereas the ponyfill's `detect()`
would force a per-frame `ImageBitmap` conversion. It was left in place because it
is user-owned uncommitted work. **Removing it is your call.**

---

## 9. Local WASM asset behaviour

`zxing-wasm` defaults `locateFile` to `https://fastly.jsdelivr.net/...`. That is
overridden with a Vite `?url` import, so the binary is emitted locally:

```
dist/assets/zxing_reader-DHMvH2D8.wasm   1,065,634 bytes
```

Same-origin, content-hashed. A test asserts the override resolves to a path that
is neither absolute nor a known CDN host.

## 10. Offline behaviour

`public/sw.js:43` returns early for cross-origin requests — the service worker
**deliberately never caches cross-origin responses**. An unconfigured integration
would therefore have been permanently unavailable offline. This was the most
important finding of Phase 0.

With the local asset, the existing cache-first rule for same-origin assets stores
it on first use. `CACHE_VERSION` was bumped to `daliguro-qr-v5` so the activate
handler retires older caches; content hashing means a new build's asset supersedes
the old one.

**Verified structurally, not on an offline device.** Also note: the offline
*outbox* (already working) is a different capability from full offline
*application startup*. The decoder asset must have been fetched at least once
before it is available offline.

---

## 11. Bundle-size impact

| Asset | Before | After | Δ |
|---|---|---|---|
| `main-*.js` | 183.13 kB | 183.13 kB | **0** |
| `App-*.js` | 316.57 kB | 316.57 kB | **0** |
| `index-*.js` | 1.01 kB | 1.01 kB | **0** |
| `SmartScanMobilePage-*.js` | 34.10 kB | 36.70 kB | +2.60 kB |
| `omr-frame-worker-*.js` | 156.46 kB | 195.59 kB | **+39.13 kB** |
| `reader-*.js` (new, lazy) | — | 37.79 kB | on demand |
| `zxing_reader-*.wasm` (new, lazy) | — | 1,065.63 kB | on demand |

Entry bundles unchanged. The 1 MB binary is fetched only on first use, only on
devices without a native `BarcodeDetector`. The worker chunk growth is a real
regression, reported rather than hidden (§4.1 of known-failures).

---

## 12. Decoder cascade (after R1)

```
1. native window.BarcodeDetector   page-side; unchanged
2. ZXing WASM (zxing-wasm/reader)  NEW — lazy, once per session, worker-side
3. jsQR whole-frame                unchanged
4. jsQR geometry-guided zone rescue unchanged
5. jsQR region tournament (11 crops) unchanged
6. jsQR contrast / threshold passes unchanged
```

Skipped entirely when the native detector already produced an identity — the WASM
is never even fetched on such devices.

## 13. Final-capture cascade (after R2)

```
1. ImageCapture.takePhoto()   NEW — genuine still exposure
2. ImageCapture.grabFrame()   NEW — track-resolution frame
3. canvas drawImage           unchanged; universal, and iOS Safari's only path
```

---

## 14. Tests added

**35 new tests. No existing test was modified, weakened, skipped, or deleted.**

| Suite | Count |
|---|---|
| `tests/zxing-fallback.test.ts` | 16 |
| `tests/final-still-capture.test.ts` | 17 |
| `tests/frame-stability.test.ts` (appended) | 2 |

Coverage includes: native-present skip; WASM fallback success and attribution;
init failure; runtime failure; sticky disable; single init across sequential and
concurrent frames; jsQR final fallback; invalid payload rejected despite a
successful decode; wrong assessment; missing learner identity; checksum mismatch;
answer-data smuggling; decoder-flagged-invalid results; non-CDN `locateFile`;
QR-only single-symbol options; the full capture ladder in all four support
combinations; zero-sized bitmap; canvas draw failure; ended track; bitmap release
on success and on failure; 25 repeated captures with no unreleased bitmaps;
platforms lacking `close()`; `ImageCapture` feature detection including a throwing
constructor; and high-resolution stability both accepting a good 4000 px still and
**still rejecting a blurred one**.

---

## 15. Exact commands executed

```
npm run typecheck
npm run lint
npm test
npm run build
npx vitest run tests/zxing-fallback.test.ts
npx vitest run tests/final-still-capture.test.ts
npx vitest run tests/frame-stability.test.ts
npx playwright test
npx playwright install chromium
npx playwright install webkit firefox
npx playwright test --reporter=line
npx playwright test --project=chromium --reporter=line
npm install --include=dev
npm ls zxing-wasm
git status / git diff / git diff --stat / git show HEAD:<path>
```

## 16. Exact command results

| Command | Result |
|---|---|
| `npm run typecheck` | **PASS** (baseline: FAIL, 2 pre-existing errors) |
| `npm run lint` | **PASS** |
| `npm test` | **PASS — 42 files, 438 tests** (baseline 40 / 403) |
| `npm run build` | **PASS** (baseline: FAIL) |
| `npx playwright test` | **31 passed, 2 skipped** across Chromium/Firefox/WebKit |
| `npm ls zxing-wasm` | one deduped copy at 3.1.1 |

The 2 Playwright skips are pre-existing and intentional:
`phone-scan-e2e.spec.ts:21` — `"fake camera capture is Chromium-only"`. The
end-to-end phone scan therefore ran **in Chromium only**.

---

## 17. Performance measurements

See `CAMERA_SCANNER_BENCHMARK.md`. Summary:

- Decoder initializations: **1** across 5 sequential frames and **1** across 4
  concurrent frames; **1** attempt after failure (sticky disable); **0** when a
  native detector is present.
- Native / ZXing / jsQR attempt times: **Not measured** — requires a device.
- jsQR calls avoided when ZXing succeeds: **structurally, the entire cascade**
  (up to ~48 jsQR invocations per thorough frame), but **not measured on hardware**.

## 18. Resource-cleanup result

Every `ImageBitmap` is released in a `finally`, including on failure paths. A
25-iteration repeated-capture test asserts every bitmap was closed **exactly
once**. Platforms without `close()` are handled without throwing. Parallel final
captures are prevented by `finalCaptureInFlightRef`.

**Not measured:** real heap/RSS growth on a phone across 50–100 scans.

---

## 19. Security impact

**No weakening. The trust boundary is unchanged.**

- Every ZXing read passes through `decodeQrPayload` before it is accepted as
  identity — the same gate a jsQR read passes. A successful WASM decode earns no
  additional trust.
- All downstream validation is untouched: assessment match, learner identity,
  item-count bounds, integrity checksum, security token, forbidden answer-field
  rejection, and the printed VERSION-row cross-check.
- Tests explicitly assert that a *correctly signed* payload for the **wrong
  assessment** is still rejected, and that checksum-mismatched and
  answer-smuggling payloads are rejected.
- No raw QR payload is written to logs or analytics. `zxingDiagnostics()` exposes
  only counters (`initCount`, `decodeCount`, `failureCount`).
- **New supply-chain surface:** ~1 MB of third-party WASM now executes on the
  scan path. Mitigated by MIT licensing, version pinning, same-origin hosting, and
  a single controlled entry point — but it is a real addition.

## 20. Data-integrity impact

**None.** No change to receipts, the offline outbox, retry handling, duplicate
prevention, append-only review records, teacher verification, consensus logic,
review routing, or Supabase synchronization. `verifyFinalMobileCapture` was not
modified; the preview-vs-final disagreement path still forces review at
confidence ≤ 0.49.

The `identitySource` union gained `"zxing-wasm"`. It is an optional diagnostic
field; existing stored values remain valid.

---

## 21. Remaining physical-device validation

Full list in `CAMERA_SCANNER_KNOWN_FAILURES.md` §3. The blocking items for a
`PASS`:

1. iPhone Safari — does the WASM tier actually read real sheet QRs where jsQR
   struggles? **This is R1's entire premise and it is unproven.**
2. Android Chrome — confirm the WASM is never downloaded when native exists.
3. A device with `takePhoto()` — confirm it returns a genuinely higher resolution
   than the preview, and measure preview interruption.
4. Low-cost Android — WASM instantiation cost and thermal behaviour.
5. Offline airplane-mode scan after caching, then reconnect and sync.
6. 50–100 consecutive scans for memory growth.

---

## 22. Rollback instructions — R1

R1 is one function call in one file.

**Kill switch (fastest):** in `src/lib/scanner/analyze-frame.ts`, replace the body
of `analyzeFrameAsync` with
`return analyzeFrameData(img, assessmentId, qrText, thoroughQr);`.
This restores the exact `native → jsQR` behaviour. Nothing else needs to change;
Vite then tree-shakes the WASM out of the build.

**Full revert:** delete `src/lib/scanner/zxing-qr.ts` and
`src/lib/scanner/analyze-frame.ts`; revert `omr-frame-worker.ts` and the two
`analyzeFrameAsync` call sites in `SmartScanMobilePage.tsx` to `analyzeFrameData`;
optionally remove `zxing-wasm` from `package.json` and delete
`tests/zxing-fallback.test.ts`. The `identitySource` union additions are harmless
and may stay.

No migrations, no schema changes, no stored-format changes. No data rollback.

## 23. Rollback instructions — R2

**Kill switch:** in `SmartScanMobilePage.tsx`, change `captureFinalFrame` to pass
`imageCapture: null`. The ladder then goes straight to the canvas rung — today's
exact behaviour — with no other edits.

**Full revert:** restore `const finalFrame = grabFrame(FINAL_CAPTURE_W);` at the
call site, remove the in-flight guard and `finalCaptureInfo` state, and delete
`src/lib/scanner/final-still-capture.ts` and `tests/final-still-capture.test.ts`.
The two added `frame-stability` tests should be kept — they are valid regardless.

R1 and R2 are independent; either can be reverted without touching the other.

---

## 24. Unverified assumptions

Stated explicitly so they are not mistaken for findings:

1. **ZXing decodes real sheet QRs better than jsQR under blur/low light/angle.**
   The premise of R1. Tested against a mock only. **Unverified.**
2. **`takePhoto()` returns higher resolution than the preview stream** on target
   devices. Device- and OS-dependent. **Unverified.**
3. **`takePhoto()` does not disruptively stall the preview** on low-cost Android.
   **Unverified.**
4. **WASM instantiation is affordable** on a low-RAM phone. **Unverified.**
5. **The service worker caches the WASM asset in practice.** Structurally correct
   by the existing cache-first rule; **not observed on a device.**
6. **jsdom `ImageData`-shaped fixtures behave like real browser `ImageData`** at
   the ZXing boundary. Reasonable, but the real binary was never invoked in tests.
7. **The 4000×3000 dimensions in R2 fixtures** are representative, not measured.
8. **No device regresses** from routing the main-thread fallback through the async
   cascade. Logic is identical; **timing on real hardware is unverified.**

---

## 25. Final status

## `BLOCKED_EXTERNAL`

*(2026-07-21, superseding the earlier `PASS_WITH_LIMITATIONS`.)*

### Local gates — all pass

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS — **43 files, 449 tests** |
| `npm run build` | PASS |
| `npm audit --omit=dev` | **0 production vulnerabilities** |
| `npm run test:browser:verify` | PASS — **76 executed, 76 passed, 2 intentional skips**, Chromium + Firefox + WebKit |

### PASS conditions: 12 of 20 met

Met: typecheck, lint, tests, build, truthful browser execution, **real
zxing-wasm decoding representative fixtures**, **same-origin WASM loading
proven**, jsQR final fallback intact, no decoder bypasses validation, no capture
path bypasses verification, no resource leak detected, ambiguous results still
route to review.

Outstanding — **every one requires physical hardware**: iPhone Safari camera
validation; Android Chrome native-path + no-WASM-download proof; a real
`takePhoto` device; airplane-mode scanning and reconnect sync; ≥50 consecutive
scans on a low-cost device; and the four hardware integrity gates (0 wrong
learner, 0 wrong assessment, 0 duplicate submissions, 0 lost scans).

### Continuation-3 additions (2026-07-21)

Status remains `BLOCKED_EXTERNAL`. Local hardening completed:

| Item | Result |
|---|---|
| Firefox flake | **118 executions, 0 failures.** Prior "~1-in-4" was extrapolated from one data point and is corrected to ≤1-in-119. Logic verified load-bearing by a two-stage negative control. No code change. |
| Runtime asset origin | Worker, WASM, decoder chunk and service worker all same-origin in **built** output. Native fast path performs **zero** WASM fetches. |
| Field-build identity | `npm run camera:field:manifest` — content-addressed, deterministic, sensitive to a one-line edit; diff **hashed, not stored**. |
| Field-result validation | `npm run camera:field:validate` — 7/7 negative controls reject; a validator false positive was caught by its own baseline and fixed. |
| Browser tests | 76 → **82 executed**, all passing. |

**Correction to the previous "exact next action".** That report implied
`QR path: zxing-wasm` on iPhone plus `provided` on Android would move the status
to `PASS_WITH_LIMITATIONS`. That was wrong: those observations prove **decoder
routing only**. They say nothing about learner/assessment identity correctness,
low-light or small-QR reliability, final-capture quality, offline persistence,
reconnect sync, duplicate prevention, or endurance. The gates in
`CAMERA_SCANNER_FIELD_VALIDATION_PLAN.md` — not a decoder label — determine the
status.

### Why `BLOCKED_EXTERNAL` rather than `PASS_WITH_LIMITATIONS`

Not a regression. `PASS_WITH_LIMITATIONS` implied residual local work; there is
none. Every locally provable claim has been proven, including the one that was
the previous report's largest gap — the decoder is no longer tested only against
a mock. What remains is a bounded, enumerated set of proofs obtainable only from
devices this environment does not have, with an executable procedure written for
them.

**This scanner is not production-ready, and no result in this report should be
read as saying otherwise.** No physical device validated any camera behaviour.
WebKit passing is strong evidence about iOS Safari's *engine*; it is not evidence
about an iPhone's camera stack, optics, thermals, or memory ceiling.

Both R1 and R2 remain additive and independently revertible with documented kill
switches (§22, §23). That is what makes a controlled, teacher-supervised field
pilot reasonable — not a claim of readiness.

Nothing was committed, pushed, merged, deployed, or opened as a pull request.
