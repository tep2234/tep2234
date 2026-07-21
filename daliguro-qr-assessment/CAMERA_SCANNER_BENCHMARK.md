# Camera Scanner Benchmark — R1 + R2

Measured: 2026-07-20, on the development machine (Darwin 25.5.0, arm64).
Build command: `npm run build` (Vite 8.0.16, production mode).

**No phone, tablet, or browser benchmark is reported here.** No physical device
lab was available. Every number below is either a build-output measurement or a
test-runner measurement. Runtime decoder timings on real hardware are listed as
**Not measured** rather than estimated.

---

## 1. Bundle impact

### Before (baseline, commit `8b102a2` + pre-existing uncommitted work)

| Asset | Raw | Gzip |
|---|---|---|
| `omr-frame-worker-*.js` | 156.46 kB | not reported by Vite for workers |
| `SmartScanMobilePage-*.js` | 34.10 kB | 11.26 kB |
| `main-*.js` | 183.13 kB | 57.84 kB |
| `App-*.js` | 316.57 kB | 88.01 kB |
| `camera-lifecycle-*.js` | 400.83 kB | 121.83 kB |
| `index-*.js` | 1.01 kB | 0.57 kB |
| **WASM assets** | **none** | — |

### After (R0 + R1 + R2)

| Asset | Raw | Gzip | Δ raw |
|---|---|---|---|
| `omr-frame-worker-*.js` | 195.59 kB | — | **+39.13 kB** |
| `SmartScanMobilePage-*.js` | 36.70 kB | 12.16 kB | **+2.60 kB** |
| `reader-*.js` (**new, lazy**) | 37.79 kB | 13.46 kB | +37.79 kB (on demand) |
| `zxing_reader-*.wasm` (**new, lazy**) | 1,065.63 kB | 453.35 kB | +1,065.63 kB (on demand) |
| `main-*.js` | 183.13 kB | 57.84 kB | 0 |
| `App-*.js` | 316.57 kB | 88.01 kB | 0 |
| `camera-lifecycle-*.js` | 400.84 kB | 121.83 kB | +0.01 kB |
| `index-*.js` | 1.01 kB | 0.56 kB | 0 |

### Interpretation — stated plainly

- **Entry/route bundles are unchanged.** `main`, `App`, and `index` did not grow.
  The WASM decoder is not in the initial critical path.
- **The 1 MB binary is a separate, on-demand asset.** It is fetched only when
  `readQrWithZxing` runs for the first time — i.e. only on a device with no
  native `BarcodeDetector`. An Android Chrome phone never downloads it.
- **The scanner page chunk grew 2.60 kB** (R2's ladder + diagnostics), not the
  ~37 kB of the first R1 attempt. See the REVISE cycle in the iteration log.
- **The worker chunk grew 39.13 kB, and this is a real regression to note.**
  Vite inlines the dynamic `import()` into the module-worker bundle instead of
  splitting it, so the ZXing *JS glue* is eager inside the worker. Mitigating
  facts: the worker chunk is itself only fetched when the scanner page starts a
  camera, and the dominant 1 MB binary is still deferred. Not hidden, not
  worked around.

### Gzip transfer cost of the new decoder path

| Item | Gzip |
|---|---|
| `reader-*.js` | 13.46 kB |
| `zxing_reader-*.wasm` | 453.35 kB |
| **Total additional transfer, first use only, only on non-native devices** | **~467 kB** |

---

## 2. Decoder initialization

| Metric | Result | Source |
|---|---|---|
| Module instantiations across 5 sequential frames | **1** | `tests/zxing-fallback.test.ts` |
| Module instantiations across 4 concurrent frames | **1** | same (shared promise) |
| Instantiation attempts after a failure | **1** (sticky disable) | same |
| Instantiation attempts when native detector present | **0** | same |

---

## 3. Decoder timing

| Path | Result |
|---|---|
| Native `BarcodeDetector` attempt time | **Not measured** — requires a device |
| ZXing WASM attempt time | **Not measured** — requires a device |
| jsQR cascade attempt time | **Not measured** — requires a device |
| jsQR cascade calls avoided when ZXing succeeds | **Not measured on hardware.** Structurally, an accepted ZXing read means `analyzeFrameData` receives a non-null `qrText` and its jsQR cascade does not execute at all. On the thorough path that cascade can invoke jsQR up to ~48 times per frame (1 whole-frame + 11 crops + 3 transformed passes × 12). |

The app already carries live instrumentation for this: `engineInfo`
(engine/ms/interval) and the new `Still:` readout are rendered in the phone UI,
so a field tester can read real values off a real device without a new build.

---

## 4. Test suite

| Metric | Baseline | After R1+R2 | After hardening (2026-07-21) |
|---|---|---|---|
| Unit test files | 40 | 42 | **43** |
| Unit tests | 403 | 436 | **449** |
| Browser tests executed | 31 | 31 | **76** |
| Existing tests modified or weakened | — | 0 | **0** |

### Hardening-cycle additions (2026-07-21)

| Suite | Tests | What it proves |
|---|---|---|
| `tests/zxing-asset-origin.test.ts` | 10 | the app's own locator can never resolve to a remote origin |
| `browser-tests/decoder-origin.spec.ts` | 15 × 3 browsers = **45** | the REAL WASM binary decodes real fixtures, fetches same-origin only, and works offline |
| `tests/final-still-capture.test.ts` (appended) | 1 | 100 captures with zero leaked bitmaps |

Browser coverage grew from 31 → 76 executed tests, and now includes **WebKit** —
iOS Safari's engine, the environment R1 exists to serve.

### Continuation-3 hardening (2026-07-21)

| Metric | Before | After |
|---|---|---|
| Browser tests executed | 76 | **82** |
| Unit tests | 449 | 449 |
| Firefox flake executions with zero failures | ~4 | **118** |

New tests: native fast path performs **zero** WASM fetches (`initCount` 0,
`decodeCount` 0); the scanner worker is same-origin.

### Firefox stale-replacement stability

| Condition | Runs | Failures |
|---|---|---|
| Isolated `--repeat-each` | 100 | 0 |
| Full Firefox suite | 10 | 0 |
| Full 3-browser gate | 3 | 0 |
| Post-restore | 5 | 0 |

Previously documented as "~1-in-4" from a single data point; corrected to **at
most 1 in 119**.

### Dependency removal (`barcode-detector`)

| Asset | Before removal | After removal |
|---|---|---|
| every emitted asset | — | **byte-identical** (content hashes only) |

Confirms `barcode-detector` contributed nothing to build output.
`npm audit --omit=dev` → **0 production vulnerabilities** (1 high dev-only:
eslint → minimatch → brace-expansion, pre-existing, unrelated).

---

## 5. Final-capture resolution

| Path | Source dimensions | Availability |
|---|---|---|
| `ImageCapture.takePhoto()` | full still-camera exposure; **Not measured on hardware** (test fixture models 4000×3000) | Android Chrome typically; never iOS Safari |
| `ImageCapture.grabFrame()` | track resolution (test fixture 1920×1080) | Android Chrome typically |
| Canvas `drawImage` | preview stream resolution (test fixture 1300×1733) | universal, incl. iOS Safari |

Processing cap: `FINAL_CAPTURE_W = 2200` is applied to the **longer** side of a
bitmap still, preserving aspect ratio. It is a downscale cap, never an upscale.
`sourceWidth`/`sourceHeight` report the true pre-downscale dimensions so the UI
cannot imply detail the camera did not supply.

**Not measured on hardware:** actual `takePhoto()` latency (commonly 300–800 ms
on Android), preview interruption behaviour, and whether any given device
returns a higher resolution than its preview stream at all.

---

## 6. Resource behaviour

| Check | Result | Source |
|---|---|---|
| Bitmap closed after successful `takePhoto` | Yes | `tests/final-still-capture.test.ts` |
| Bitmap closed when canvas draw fails | Yes | same |
| Bitmap closed after `takePhoto` fell through to `grabFrame` | Yes | same |
| 25 repeated captures, every bitmap closed exactly once | Yes | same |
| Platform without `ImageBitmap.close()` | Handled, no throw | same |
| Parallel final capture for one stable hold | Prevented by `finalCaptureInFlightRef` | code |

**Not measured:** real heap/RSS growth on a phone across 50–100 consecutive
scans. The bitmap-release assertions are a proxy for it, not a substitute.
