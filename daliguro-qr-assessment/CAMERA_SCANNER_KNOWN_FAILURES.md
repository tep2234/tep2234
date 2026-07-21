# Camera Scanner — Known Failures and Limitations

Updated: 2026-07-20, after R0 + R1 + R2.

Sections are deliberately separated so a reader can tell the difference between
"this is broken", "this could not be tested here", and "this was considered and
declined".

---

## 1. Confirmed defects

### 1.1 Fixed during this continuation

| Defect | Status |
|---|---|
| `mobile-analyze.ts` failed `tsc` (`Property 'data' does not exist on type 'never'`), blocking `npm run build` entirely | **Fixed** (cycle R0). Closure-write narrowing; moved to a ref object. Behaviour unchanged. |

That defect was **pre-existing**, introduced by uncommitted work present before
this continuation began. It was not introduced here, and the fix preserves the
original `accept()` logic verbatim.

### 1.2 Open confirmed defects

**None identified in the scanner pipeline at this commit.**

This is not the same as "the scanner is correct". It means no defect was
*demonstrated* by the 438 automated tests, and large parts of real camera
behaviour are untestable in this environment — see §3.

---

## 2. Environment limitations (could not be validated here)

### 2.1 Playwright browsers were not installed

`npx playwright test` initially **exited 0 while running zero tests** — the
browser binaries were missing, so all 31 specs errored into a skip state. Exit
code 0 made this look like a pass.

Resolved by installing Chromium, Firefox, and WebKit. Final result:
**31 passed, 2 skipped** across all three engines.

The 2 skips are pre-existing and intentional:
`browser-tests/phone-scan-e2e.spec.ts:21` —
`test.skip(({ browserName }) => browserName !== "chromium", "fake camera capture is Chromium-only")`.
The end-to-end phone scan therefore ran **only in Chromium**. There is no
automated end-to-end camera coverage in WebKit or Firefox.

### 2.2 The ZXing tier is tested against a mock — RESOLVED 2026-07-21

**Was:** `tests/zxing-fallback.test.ts` mocks `zxing-wasm/reader`, proving nothing
about the decoder itself.

**Now:** `browser-tests/decoder-origin.spec.ts` loads the **actual ~1 MB WASM
binary** in a real browser and decodes QR fixtures rendered from the real
DALIguro encoder — standard, small, rotated, low-contrast, grayscale, blurred and
shadowed — with exact payload matching. **45/45 assertions pass in Chromium,
Firefox and WebKit.**

**Residual gap, still real.** Canvas-rendered fixtures are not photographs. They
have no lens blur, no sensor noise, no rolling shutter, no non-uniform
illumination, no print dot gain, no paper texture. The claim now supported is
"the real decoder handles synthetic degradations in three real browser engines",
**not** "the real decoder beats jsQR on a real iPhone photo". The latter still
requires §3.

### 2.5 The false-green Playwright run — RESOLVED, and the earlier diagnosis was wrong

The previous report attributed a false-green to Playwright exiting 0 having run
nothing. **That attribution was incorrect.** Measured 2026-07-21 with browsers
removed:

```
npx playwright test >/dev/null 2>&1     → exit 1   (correct)
npx playwright test 2>&1 | tail -3      → exit 0   (the false green)
```

A shell pipeline returns its **last** command's status, so `| tail` discarded
Playwright's failure — and truncated the "N failed" line, leaving "2 skipped"
visible. **The tool was fine; the invocation and the reading of it were not.**

Guarded by `scripts/verify-browser-tests.mjs` (`npm run test:browser:verify`),
which runs Playwright directly and asserts the run was substantive. Three
negative controls confirm it fails on missing binaries, on zero executed tests,
and on unexpected skips.

### 2.6 Firefox flake — investigated 2026-07-21; earlier rate was overstated

`firefox › prevents stale rapid replacements and allows same-file reselection`.

**Correction.** This was previously recorded as "~1-in-4". That figure was
extrapolated from a **single** observation across ~4 runs and was wrong.

**118 further executions produced zero failures:**

| Condition | Runs | Failures |
|---|---|---|
| Isolated (`--repeat-each`) | **100** | 0 |
| Full Firefox project suite | 10 | 0 |
| Full 3-browser gate | 3 | 0 |
| Post-restore re-verify | 5 | 0 |

Observed rate is therefore at most **1 in 119**, not 1 in 4. The single failure
occurred immediately after a back-to-back negative-control run, consistent with
Playwright webServer teardown/startup timing rather than an application race.

**The underlying logic was verified independently**, not merely assumed:

- Defeating `ScannerGeneration.isCurrent()` alone — test still passed (the
  `AbortController` supersede in `begin()` is the primary defence, and the
  assertion accepts `CANCELLED|STALE` from either mechanism).
- Defeating **both** mechanisms — **5/5 failed**. The test is load-bearing.

No code change was made. No retry, timeout increase, skip, or flaky-marking was
added. **Residual risk:** a ≤1-in-119 environment-sensitive flake may still
surface in CI; the browser gate will report it as a failure rather than hide it.

### 2.8 The field-build manifest was defective — found and fixed 2026-07-21

The manifest introduced in the previous cycle **did not identify the build it
claimed to identify.** Two compounding causes:

1. `git diff` covers **tracked files only**, and most new scanner source
   (`zxing-qr.ts`, `analyze-frame.ts`, `final-still-capture.ts`, the browser
   harness) is **untracked** — its content was never hashed.
2. `git ls-files --others` returns **cwd-relative** paths from a subdirectory
   while `git diff --name-only` returns **repo-root-relative** paths. The path
   filter required the package prefix and so discarded **every** untracked file;
   `untrackedPaths` was `0` throughout.

**Proven, not inferred:** appending one line to `zxing-qr.ts` left `diffSha256`
byte-identical. A field result could have been attributed to the wrong code.

**Fixed** by normalising both path formats, hashing untracked file *content*, and
adding `treeSha256 = H(commit ‖ diffHash ‖ untrackedHash)` as the authoritative
identity. A follow-on self-reference bug (the manifest hashing itself, making
three runs on identical code produce three identities) was fixed by excluding
generated artifacts.

**Consequence:** any earlier manifest identity in this repository is superseded.
`diffSha256` alone is **not** a valid build identity while scanner source remains
untracked — use `treeSha256`.

**Residual risk:** committing the untracked files would change which mechanism
carries the identity. `treeSha256` handles both, but the distinction should be
re-verified after any commit.

### 2.7 Field-build identity now exists (was limitation #10)

The working tree is uncommitted, so a commit hash alone did not describe what was
tested. `npm run camera:field:manifest` now emits a content-addressed identity —
including a **SHA-256 of the working-tree diff** — and the field-result validator
**rejects any record lacking it**.

Verified deterministic (two unchanged runs → identical identity fields) and
sensitive (a one-line edit changes `diffSha256`). The diff is hashed, never
stored, so uncommitted secrets cannot leak through the manifest.

### 2.3 No decoder timing was measured

Native, ZXing, and jsQR attempt times are all **Not measured**. jsdom timings
would be meaningless. The app renders live `engineInfo` and `Still:` diagnostics
so a field tester can read real values without a new build.

### 2.4 Offline behaviour is verified structurally, not by an offline device

Verified here: the WASM is emitted as a local, content-hashed, same-origin asset
(`dist/assets/zxing_reader-DHMvH2D8.wasm`); `locateFile` is overridden to that
asset; a test asserts the override is neither absolute nor a CDN host; the
service worker's cache-first rule covers same-origin assets; `CACHE_VERSION` was
bumped to `daliguro-qr-v5`.

**Not verified here:** an actual airplane-mode scan after the asset was cached.

---

## 3. Physical-device testing still required

None of the following can be certified from this environment. **Do not report
any of these as passing on the basis of mocked browser APIs.**

1. iPhone Safari scanning (the primary R1 beneficiary — no native `BarcodeDetector`)
2. iPhone Safari with the WASM tier forced to fail, exercising the jsQR final fallback
3. Android Chrome with native `BarcodeDetector` (WASM must never download)
4. Android Chrome with `BarcodeDetector` deliberately disabled
5. Low-cost / low-RAM Android phone — WASM instantiation cost and thermal behaviour
6. Real torch behaviour
7. Real continuous-autofocus behaviour
8. `ImageCapture.takePhoto()` support and **actual output resolution** per device
9. Whether `takePhoto()` visibly interrupts or stalls the preview (300–800 ms is common)
10. App backgrounding and resume mid-capture
11. Orientation change mid-capture
12. Low-light printed-sheet scanning
13. Strong overhead glare and shadow
14. Angled sheet / perspective extremes
15. Small or damaged printed QR codes
16. 50–100 consecutive real scans (memory growth, thermal throttling)
17. Offline scan in airplane mode after asset caching, then reconnect and sync

### Recommended real-device order

Android Chrome (native) → Android Chrome (native disabled) → iPhone Safari
(WASM) → iPhone Safari (jsQR forced) → device with `takePhoto` → device without
`ImageCapture` → low-cost Android → low light → glare → angled → small QR →
50 consecutive scans → offline scan then reconnect.

---

## 4. Accepted limitations (known, deliberate)

### 4.1 Worker chunk grew 39.13 kB

`omr-frame-worker` went 156.46 → 195.59 kB. Vite inlines the dynamic
`import("zxing-wasm/reader")` into the module-worker bundle rather than emitting
a separate chunk for it, so the ZXing **JS glue** is eager inside the worker.

Mitigating: the 1 MB **binary** is still deferred and never fetched on devices
with a native detector; the worker chunk itself only loads when the scanner page
starts a camera. Accepted rather than hidden. A future `vite.config.ts`
`manualChunks` rule could split it.

### 4.2 The library's jsDelivr URL remains in the bundle as dead code

`zxing-wasm`'s default `locateFile` string is present in the built output. It is
unreachable: `src/lib/scanner/zxing-qr.ts` is the only module importing
`zxing-wasm` (verified by grep), and it always supplies the local override. A
test asserts the override is non-absolute and non-CDN.

**Residual risk:** a future contributor importing `zxing-wasm` elsewhere without
an override would silently reintroduce a CDN dependency and break offline
scanning. There is no lint rule enforcing this today.

### 4.3 `barcode-detector` — REMOVED 2026-07-21

R1 integrates `zxing-wasm/reader` directly, because `readBarcodes()` accepts
`ImageData` — structurally what the worker already holds — whereas the
`barcode-detector` ponyfill's `detect()` would force a per-frame `ImageBitmap`
conversion. That left `barcode-detector` unused.

Verified unused (zero references across `src/`, `tests/`, `browser-tests/`,
`scripts/`, all configs; only the root package depended on it), then removed.
**Build output was byte-identical afterwards** — only content hashes changed —
confirming it contributed nothing.

`zxing-wasm@3.1.1` remains an explicit, pinned direct dependency, so the import
does not rely on a transitive package that could vanish.

**Note for the repository owner:** `barcode-detector` was part of *your*
uncommitted work. It was removed because it is provably unused and Phase 3 of the
governing instruction directed removal in that case. If it was being held for a
future purpose, restore it with `npm install barcode-detector@^3.2.1`.

### 4.6 The remote-asset guard is now enforced, not just documented

Previously the jsDelivr default was "unreachable dead code" with no mechanism
preventing a future contributor from reintroducing it.
`resolveZxingAssetUrl()` now **throws `RemoteWasmAssetError`** for any absolute
URL that is not same-origin. The rule is "same origin or nothing" rather than a
CDN blocklist, so a novel host cannot slip through.

**Residual risk:** the guard protects the decoder asset path specifically. A
contributor importing some *other* remote asset elsewhere is still unguarded;
there is no repository-wide lint rule for that.

### 4.4 Desktop scanner path is unchanged (W3)

`AnswerSheetScanner.tsx` still has no worker, no `requestVideoFrameCallback`, no
capability probing, no ZXing tier, and no `ImageCapture` ladder. It caps capture
at 1600 px. **Explicitly out of scope by instruction.** Recorded as a future
architecture review item.

### 4.5 No automated proof that iOS skips the expensive jsQR cascade

R1's structural claim is that an accepted ZXing read means `analyzeFrameData`
receives a non-null `qrText` and its jsQR cascade never runs. That follows from
the code path and is covered by the attribution tests, but the *frame-rate and
battery benefit* on a real iPhone is unmeasured.

---

## 5. Rejected approaches

| Rejected | Reason |
|---|---|
| **OpenCV.js** | ~8–10 MB WASM on top of the 1 MB already added, to replace working marker-based homography. Contradicts the low-cost-phone target. |
| **OMRChecker** | **GPL-3.0** (verified independently at https://github.com/udayraj123/OMRChecker — LICENSE is GPL-3.0). Incompatible with this project's distribution model. Its ideas (template bubble coordinates, local-background fill ratio, ambiguity band) are already independently implemented. |
| **qr-scanner (nimiq)** | Would add a second camera stack beside one that is already more specialized (generation counters, resolution-normalized stability, lifecycle machine). |
| **Replacing jsQR with ZXing** | jsQR is proven here, synchronous, and has zero load time. Keeping both is strictly more reliable than either alone, and jsQR is the rollback path. |
| **Making `analyzeFrameData` async** | Would ripple through the worker, the main-thread fallback, and every existing test. Avoided by inserting the tier above the sync pipeline via the existing `qrText` injection point. |
| **Changing the answer-sheet template** | Four alignment markers already exist. No test demonstrates a defect. |
| **Removing the iOS `thoroughQr` workaround now** | It remains the correct final rescue when ZXing is unavailable or yields nothing. Removing it should follow device evidence, not precede it. |
