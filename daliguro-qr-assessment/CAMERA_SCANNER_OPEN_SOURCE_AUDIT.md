# Camera Scanner Open-Source Audit

Audit date: 2026-07-20
Branch: `security/smartscan-realtime-certification`
Scope: mobile camera scanner (phone path) and desktop scanner path, evaluated against named open-source components.
Baseline at audit time: `npm test` → **40 files, 403 tests, all passing**.

> **CORRECTIONS (2026-07-20, after implementation).** Three statements in this
> document were wrong and are corrected in place below. See
> `CAMERA_SCANNER_ITERATION_LOG.md` for the evidence.
>
> 1. **The baseline was not green.** This audit ran only `npm test`. `npm run
>    typecheck` and `npm run build` both **failed** with 2 pre-existing errors in
>    `mobile-analyze.ts`. Fixed in cycle R0.
> 2. **The claim that a direct `zxing-wasm` dependency would mean "two copies of
>    the WASM binary" is false.** Pinning the identical version dedupes to one
>    copy (`npm ls zxing-wasm` verified). `zxing-wasm@3.1.1` was added as an
>    explicit direct dependency.
> 3. **This audit missed the most important integration risk:** `zxing-wasm`
>    defaults `locateFile` to the jsDelivr CDN, and `public/sw.js` deliberately
>    never caches cross-origin responses — so an unconfigured integration would
>    have been permanently unavailable offline. The binary is now emitted locally.
>
> Also note the integration target changed: `zxing-wasm/reader` was used directly
> rather than the `barcode-detector` ponyfill, because `readBarcodes()` accepts
> `ImageData` — structurally what the worker already holds — whereas `detect()`
> would force a per-frame `ImageBitmap` conversion.

This audit supersedes nothing. It is narrower than `CAMERA_SCANNER_AUDIT.md` (2026-07-10) and is
scoped to one question: **which of the proposed open-source components actually close a real gap,
and which would replace a working system for no measured benefit.**

Evidence levels used below:

- **Confirmed** — read directly from source in this repository at this commit.
- **Inferred** — follows from source but not exercised by a test or a device.
- **Unverified** — needs real hardware; no phone lab was available for this audit.

---

## 1. Existing architecture

### 1.1 Camera initialization

Two independent camera paths exist. They do not share startup code.

| Concern | Phone path | Desktop path |
|---|---|---|
| Entry | [SmartScanMobilePage.tsx](src/pages/SmartScanMobilePage.tsx) (1409 lines) | [AnswerSheetScanner.tsx](src/components/scanner/AnswerSheetScanner.tsx) (733 lines) |
| Constraints | `preferredVideoConstraints()` — `facingMode: {ideal:"environment"}`, 2560×1440 ideal, 30fps ideal | inline `facingMode: "environment"` with any-camera fallback |
| Error mapping | `classifyMediaError()` | `classifyMediaError()` |
| Lifecycle | [camera-lifecycle.ts](src/lib/scanner/camera-lifecycle.ts) generation counter | ad-hoc refs |

`preferredVideoConstraints` ([camera.ts:235-242](src/lib/camera.ts#L235-L242)) uses `ideal` for every
dimension, so an unsupported resolution degrades rather than throwing `OverconstrainedError`.
`classifyMediaError` ([camera.ts:97-177](src/lib/camera.ts#L97-L177)) maps eight DOMException names
to distinct recoverable states with teacher-facing guidance. **This is already correct and well
tested** (`tests/camera.test.ts`, `tests/camera-lifecycle.test.ts`).

**Confirmed.** Requirement 4 ("never assume a capability exists", "do not crash on unsupported
constraint") is already satisfied on the phone path.

### 1.2 Capability probing, torch, autofocus

[SmartScanMobilePage.tsx:876-897](src/pages/SmartScanMobilePage.tsx#L876-L897) probes
`track.getCapabilities?.()` behind optional chaining, gates the torch button on `caps.torch`, and
applies `focusMode: "continuous"` only when `caps.focusMode?.includes("continuous")`.
`applyTorch` ([:332-341](src/pages/SmartScanMobilePage.tsx#L332-L341)) catches the
`applyConstraints` rejection and **disables the torch button** rather than throwing — the correct
behavior for iOS Safari, which exposes no torch.

**Confirmed correct.** No change needed.

Not currently probed or applied: continuous **exposure** (`exposureMode`), continuous **white
balance** (`whiteBalanceMode`), **zoom**. These are genuine but low-value gaps — see §5.

### 1.3 Frame-processing loop

[SmartScanMobilePage.tsx:651-816](src/pages/SmartScanMobilePage.tsx#L651-L816).

- Scheduling prefers `video.requestVideoFrameCallback` and falls back to `requestAnimationFrame`
  ([:287-302](src/pages/SmartScanMobilePage.tsx#L287-L302)). **Requirement 4 already met.**
- Work is throttled by `adaptiveAnalyzeInterval(lastDurationMs, 90)`
  ([camera.ts:286-291](src/lib/camera.ts#L286-L291)), which backs off to at most 500 ms on slow
  devices. **This is the low-cost-phone protection and it already exists.**
- A `cameraRunRef` generation counter (`runIsActive()`) invalidates in-flight async work after every
  `await`, preventing a stale frame from committing a scan.
- Preview frames are capped on the **smaller** side at `FRAME_W = 1300`
  ([:351-366](src/pages/SmartScanMobilePage.tsx#L351-L366)) — a deliberate fix so landscape buffers
  don't crush a portrait sheet's QR below jsQR's decode floor.

### 1.4 Web Worker usage

[omr-frame-worker.ts](src/lib/scanner/omr-frame-worker.ts) (30 lines) wraps the pure
[mobile-analyze.ts](src/lib/scanner/mobile-analyze.ts) pipeline. The page transfers the pixel buffer
zero-copy (`worker.postMessage(req, [req.buffer])`), applies a 2 s `WORKER_TIMEOUT_MS`, and on
timeout or `onerror` sets `workerFailedRef` to permanently fall back to the identical main-thread
pipeline ([:372-428](src/pages/SmartScanMobilePage.tsx#L372-L428)). The worker is terminated on
unmount.

**Confirmed.** Requirement 8 (workers, no preview blocking, fallback on worker failure) is met.
The desktop path has **no** worker — all analysis is main-thread.

### 1.5 QR decoding cascade (current)

```
native window.BarcodeDetector  →  jsQR whole-frame  →  jsQR geometry-guided zone rescue
                               →  jsQR region tournament (11 crops)
                               →  jsQR contrast-stretched  →  jsQR global-threshold
```

Implemented across [qr-detect.ts](src/lib/scanner/qr-detect.ts),
[qr-zone-rescue.ts](src/lib/scanner/qr-zone-rescue.ts), and
[mobile-analyze.ts:283-333](src/lib/scanner/mobile-analyze.ts#L283-L333).

A critical correctness property is already in place: `accept()`
([mobile-analyze.ts:301-306](src/lib/scanner/mobile-analyze.ts#L301-L306)) only *accepts* a stage's
read if it `decodeQrPayload(...).ok`. A false-positive decode from a cheap stage cannot short-circuit
the reliable rescue stage. This directly implements requirement 5's "a decoded QR value must not be
automatically trusted."

### 1.6 QR payload validation

[analyzeDecodedFrame](src/lib/scanner/mobile-analyze.ts#L141-L277) validates, in order:

1. `decodeQrPayload` — format/version/required fields ([qr-parse.ts](src/lib/qr-parse.ts)).
2. `assessmentMatches(assessmentId, payload.assessmentId)` → `WRONG_ASSESSMENT`.
3. Item count `1..MAX_ITEMS` → `INVALID_ITEM_COUNT`.
4. Marker alignment → `SHEET_NOT_ALIGNED`.
5. Capture quality gates → `retake`.
6. **Printed VERSION bubble row cross-check** against `payload.version` → `VERSION_MISMATCH`.

Item 6 is a second, independent identity layer read off the paper itself. That is stronger than the
requested checklist and must be preserved.

### 1.7 Blur, brightness, glare, stability

- Sharpness: `sharpnessOf()` Laplacian-style variance over the gray image
  ([omr-detect.ts:99](src/lib/scanner/omr-detect.ts#L99)).
- Gates: [quality-gates.ts](src/lib/scanner/quality-gates.ts) produces `CaptureQualityReasonCode`s
  including `GLARE_DETECTED`, with hard blockers separated from review reasons.
- Stability consensus: [frame-stability.ts](src/lib/scanner/frame-stability.ts) requires N
  consecutive frames with the same identity, stable normalized geometry, and — importantly —
  **resolution-normalized** sharpness comparison (`sharpnessWidth`), so a 1300 px preview baseline
  can be fairly compared against a 2200 px final still.
- Multi-frame consensus: [mobile-consensus.ts](src/lib/scanner/mobile-consensus.ts) accumulates
  per-bubble darkness across `CONSENSUS_FRAMES` aligned frames before classification.

### 1.8 Final capture

[SmartScanMobilePage.tsx:749-790](src/pages/SmartScanMobilePage.tsx#L749-L790) captures at
`FINAL_CAPTURE_W = 2200` (vs 1300 preview), **re-decodes the QR independently** on that still, and
runs `verifyFinalMobileCapture` ([final-capture.ts:127-213](src/lib/scanner/final-capture.ts#L127-L213)),
which rejects on six distinct codes and, when preview and final evidence disagree, forces the item to
`review` with confidence clamped to ≤ 0.49 rather than picking a winner
([final-capture.ts:94-121](src/lib/scanner/final-capture.ts#L94-L121)).

**This is a strong safety boundary. Do not weaken it.**

### 1.9 Perspective correction and bubble reading

Already implemented natively, without OpenCV:

- `findCornerMarkers()` — four printed corner markers, connected-component blob search, quad
  ordering, area/aspect validation ([omr-detect.ts:232-305](src/lib/scanner/omr-detect.ts#L232-L305)).
- `solveHomography()` / `applyHomography()` — 8×8 Gaussian-elimination solve, canonical→image
  ([omr-detect.ts:307-350](src/lib/scanner/omr-detect.ts#L307-L350)).
- `bubbleFeature()` — samples each bubble's inner disc against a **local background annulus**, i.e.
  the nearby blank-paper reference the requirement asks for
  ([omr-detect.ts:376-427](src/lib/scanner/omr-detect.ts#L376-L427)).
- `otsuThreshold()` for global binarization; per-bubble local normalization for classification.
- Statuses: `selected | blank | unclear | multiple | unreadable` plus `unreadableChoices[]`.

Mapping to the requested four-state model: `blank`→blank, `selected`→marked,
`unclear`/`multiple`/`unreadable`→ambiguous→review. `isDoubtful()`
([mobile-analyze.ts:109-117](src/lib/scanner/mobile-analyze.ts#L109-L117)) additionally routes
*low-confidence* `selected` and `blank` to review — catching the erased-mark and washed-out-mark
cases. **Requirement 7's "do not force uncertain bubbles" is already satisfied.**

**Requirement 7's four printed alignment markers already exist on the template.** No template change
is needed.

---

## 2. Observed weaknesses

Ranked by real-world impact.

### W1 — `barcode-detector` is a declared dependency that is never imported (Confirmed)

`package.json` declares `"barcode-detector": "^3.2.1"` (which pulls `zxing-wasm@3.1.1`), and
`grep -rn "barcode-detector" src/ tests/ browser-tests/` returns **nothing**. All three call sites
use the *native* `window.BarcodeDetector` only
([AnswerSheetScanner.tsx:456](src/components/scanner/AnswerSheetScanner.tsx#L456),
[SmartScanMobilePage.tsx:115](src/pages/SmartScanMobilePage.tsx#L115)).

Consequence: on **iOS Safari < 17** and any browser without native `BarcodeDetector`, the entire QR
burden falls on jsQR. jsQR is a pure-JS 2011-era decoder with no binarizer choice and weaker
tolerance to blur, low contrast, and perspective than ZXing. The most recent commit
(`8b102a2 fix(smartscan): read the small sheet QR on iOS`) is a workaround for exactly this: it
escalates iOS to the expensive thorough cascade on *every* frame because the cheap pass can't lock
the code. That costs battery and frame rate on precisely the low-end devices this project targets.

**This is the single highest-value gap, and the dependency to fix it is already installed.**

### W2 — No `ImageCapture` path for the final still (Confirmed)

`grabFrame()` is a canvas `drawImage` from the `<video>` element. There is **no**
`ImageCapture.takePhoto()` or `.grabFrame()` anywhere in `src/`. `FINAL_CAPTURE_W = 2200` is
therefore an *upper bound that the video track usually cannot reach* — the still is capped at the
negotiated preview resolution (commonly 1920×1080, often 1280×720 on budget Android), then upscaled
or left as-is. On Android Chrome, `takePhoto()` can return a full sensor-resolution JPEG, which is
materially better for shaded-bubble discrimination.

Requirement 6 is currently **not met**.

### W3 — Desktop path has diverged and is weaker (Confirmed)

`AnswerSheetScanner.tsx` has no worker, its own constraint code, no `requestVideoFrameCallback`, no
torch/capability probing, and caps capture at 1600 px. It duplicates rather than reuses
`SmartScanMobilePage`'s hardened pipeline. This is a maintenance and correctness liability, but it is
**out of scope** for a change described as "mobile camera scanner" and carries high regression risk.

### W4 — `exposureMode` / `whiteBalanceMode` never probed (Confirmed, low value)

Continuous exposure and white balance are the browser default on essentially every mobile camera
stack. Explicitly requesting them is defensible but is unlikely to change any outcome, and each
`applyConstraints` call is a chance to break a working stream.

### W5 — Region-crop tournament runs 11 crops before contrast/threshold stages (Inferred)

`likelyQrCrops` returns 11 overlapping regions; the thorough cascade can therefore invoke jsQR up to
~1 + 11 + 12 + 12 + 12 ≈ 48 times on one frame. On iOS, per W1, this now happens *every frame*. A
stronger decoder makes most of this tournament unnecessary.

---

## 3. Open-source candidate evaluation

| Component | License | Verdict | Rationale |
|---|---|---|---|
| **[barcode-detector](https://github.com/Sec-ant/barcode-detector) 3.2.1** | **MIT** | **ADOPT** (already installed) | Spec-compliant `BarcodeDetector` ponyfill. Closes W1 with no API redesign — the existing native call sites keep their shape. |
| **[zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.1** | **MIT** | **ADOPT transitively** | Already present as `barcode-detector`'s only dependency. Do **not** add it as a direct dependency — that would mean two copies of the WASM binary. |
| [qr-scanner](https://github.com/nimiq/qr-scanner) | MIT | **REJECT as dependency, ADOPT patterns** | Its worker/lifecycle patterns are already independently implemented here (§1.3, §1.4), and in some respects this repo is ahead (generation counters, resolution-normalized stability). Adding it means a second camera stack. |
| [opencvjs-document-scanner](https://github.com/tony-xlh/opencvjs-document-scanner) | MIT | **REJECT** | Reference for OpenCV.js document warping. §1.9 already solves this with printed markers and a direct homography solve, which is *more* reliable than contour-based page detection for a sheet with known fiducials. |
| [OpenCV / OpenCV.js](https://github.com/opencv/opencv) | Apache-2.0 | **REJECT** | ~8–10 MB WASM. Would dominate the bundle and memory on the low-cost phones this project targets, to replace working code. Directly contradicts requirement 8. |
| [OMRChecker](https://github.com/udayraj123/OMRChecker) | **GPL-3.0** | **REJECT — license blocker** | GPL-3.0 is incompatible with this project's distribution model; copying its algorithms risks derivative-work obligations. Its core ideas (template-driven bubble coordinates, local-background fill ratio, ambiguity band) are **already independently implemented** in `omr-template.ts` / `omr-detect.ts`, so there is nothing to gain by taking the risk. |

### License summary

Only MIT-licensed code is proposed for integration, from packages **already present in
`package-lock.json`**. No new dependency is added. No GPL code is read, copied, or referenced.

---

## 4. Recommended changes

Scoped deliberately small. Two changes, both additive, both behind capability detection.

### R1 — Wire `barcode-detector` as the ZXing-WASM fallback tier (closes W1)

Insert one tier into the cascade, between native `BarcodeDetector` and the jsQR tournament:

```
native window.BarcodeDetector   (unchanged, fast path, Android / iOS 17+)
  → barcode-detector ponyfill   (NEW — ZXing WASM, lazily loaded, worker-side)
  → jsQR whole-frame            (unchanged)
  → jsQR zone rescue            (unchanged)
  → jsQR region tournament      (unchanged)
  → jsQR contrast / threshold   (unchanged)
```

Constraints on the implementation:

- **Lazy `import()`** so the WASM is never fetched on devices with a native detector.
- Must run **inside the existing worker**, not on the main thread.
- Every read still passes through the existing `accept()` / `decodeQrPayload` validation gate. A
  ZXing hit is **not** more trusted than a jsQR hit.
- If the WASM fails to load (offline first-run, CSP, old Safari), the tier is skipped and the jsQR
  cascade runs exactly as it does today. **No new failure mode.**
- Once this tier lands, re-evaluate whether iOS still needs `thoroughQr` on every frame (W5).

Offline note: this app has an offline outbox and is used in low-connectivity schools. The WASM asset
must be bundled and precached, not fetched from a CDN, or the fallback will be unavailable exactly
when it is needed. **This is a hard requirement, not a nicety.**

### R2 — `ImageCapture` ladder for the final still (closes W2)

```
ImageCapture.takePhoto()   →   ImageCapture.grabFrame()   →   canvas drawImage (current)
```

Constraints:

- Feature-detect `window.ImageCapture` and wrap each tier in try/catch; Safari has no `ImageCapture`
  at all, so the canvas path stays the default there.
- `takePhoto()` may momentarily interrupt the preview and can be slow (300–800 ms) on some Android
  devices. It runs **once**, only after stability is already achieved — never in the loop.
- The still must continue to flow through `verifyFinalMobileCapture` unchanged. A higher-resolution
  image does **not** earn relaxed verification.
- Revoke/close: `Blob`, `ImageBitmap`, and any object URL must be released in a `finally`.

### R3 — Not recommended now

- Desktop path unification (W3) — high regression risk, out of stated scope.
- `exposureMode` / `whiteBalanceMode` (W4) — negligible expected benefit, non-zero breakage risk.
- OpenCV.js, OMRChecker, qr-scanner, template changes — see §3.

---

## 5. Rejected approaches (explicit)

| Rejected | Reason |
|---|---|
| Replacing jsQR with ZXing | jsQR is proven here and is a synchronous, zero-load-time fallback. Keeping both is strictly more reliable than either alone. |
| Replacing the homography/marker code with OpenCV.js | Bundle and memory cost on target devices; existing code is marker-based and already more robust for this input. |
| Adopting OMRChecker algorithms | GPL-3.0 license incompatibility; no functional gap to close. |
| Adding `qr-scanner` | Would duplicate an already-hardened camera/worker stack. |
| Adding four alignment markers to the template | They already exist. |
| Rewriting the frame loop | `requestVideoFrameCallback` + adaptive interval + generation counters are already correct. |
| Auto-submitting high-confidence scans | Existing policy deliberately keeps a teacher in the loop ([SmartScanMobilePage.tsx:643-646](src/pages/SmartScanMobilePage.tsx#L643-L646)). Out of scope and a safety regression. |

---

## 6. Implementation risks

| Risk | Severity | Mitigation |
|---|---|---|
| WASM unavailable offline on first run | **High** | Bundle + precache the asset; verify the jsQR cascade is untouched when load fails. |
| WASM init cost on low-RAM phones | Medium | Lazy-load only when no native detector; initialize once; keep the instance worker-side. |
| `takePhoto()` stalls or kills the preview on some Android devices | Medium | Timeout + fall through to `grabFrame()` then canvas; only invoked once, post-stability. |
| Higher-resolution still shifts sharpness/geometry thresholds | Medium | `frame-stability` already normalizes by `sharpnessWidth`; add explicit tests at 2200 px and above. |
| Bundle size growth from WASM | Medium | Measure before/after in the certification report; must be a lazy chunk, not in the entry bundle. |
| Memory leak across repeated scans | Medium | Explicit `close()`/`revokeObjectURL` in `finally`; add a repeated-scan test. |

## 7. Browser compatibility risks

| Browser | Native BarcodeDetector | ImageCapture | Expected path after R1+R2 |
|---|---|---|---|
| Android Chrome (modern) | Yes | Yes | native QR + `takePhoto()` — WASM never loads |
| Android Chrome (older / Go) | Varies | Varies | ZXing WASM if needed; canvas still |
| iOS Safari 17+ | Yes | **No** | native QR + canvas still |
| iOS Safari < 17 | **No** | **No** | **ZXing WASM** + canvas still — the main beneficiary |
| Firefox Android | No | No | ZXing WASM + canvas still |
| Desktop Chrome | Varies | Varies | unchanged (desktop path not modified) |

All four combinations of (detector present/absent) × (ImageCapture present/absent) must be covered by
tests, since no physical device lab is available. **Anything claimed about real hardware in the
certification report will be marked Unverified.**

---

## 8. Test plan

Existing suite (403 tests) must stay green and unmodified. New tests, added to `tests/`:

**Decoder tier (R1)** — ZXing tier used when native absent; skipped when native present; WASM load
failure falls through to jsQR unchanged; a ZXing read that fails `decodeQrPayload` is rejected, not
trusted; wrong-assessment and wrong-learner payloads still blocked at the same gate.

**Capture ladder (R2)** — `takePhoto` used when available; `takePhoto` rejection falls to
`grabFrame`; `grabFrame` rejection falls to canvas; no `ImageCapture` global → canvas directly;
resources released on every path including the failure paths.

**Regression guards** — blurry/dark/glare frames still rejected; ambiguous/multiple/erased bubbles
still routed to review; duplicate-scan prevention intact; worker failure still falls back;
final-capture verification still rejects identity/geometry/scope changes; repeated-scan loop shows no
unbounded growth.

Commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, plus `npm run test:browser`
(Playwright) if it runs in this environment.

## 9. Rollback plan

Both changes are additive tiers guarded by capability detection, so rollback is granular:

1. **R1 kill switch** — the ZXing tier is a single function call in the cascade; removing it (or
   forcing its feature flag false) restores today's exact `native → jsQR` behavior. The dependency
   can remain in `package.json` unused, as it is today.
2. **R2 kill switch** — the capture ladder falls back to `grabFrame()`/canvas by design; forcing the
   ladder to start at the canvas tier restores today's exact behavior.
3. **Full revert** — `git revert` of the phase commits. No migrations, no schema changes, no stored
   data format changes, so no data rollback is required.
4. Nothing in R1/R2 touches the outbox, receipts, retry, duplicate protection, review records,
   teacher verification, or Supabase sync.

---

## 10. Audit conclusion

The scanner is **substantially stronger than the proposed reference architecture in most respects**.
Multi-frame consensus, resolution-normalized stability, independent final-still re-decoding, a
two-layer identity check (QR + printed VERSION row), worker offloading with permanent fallback,
capability-gated torch/focus, `requestVideoFrameCallback`, adaptive throttling, and a
non-coercive five-state bubble model are all already implemented and tested.

Of the eleven stated improvement goals, nine are already met. Two are real:

1. **Low-light / blur / iPhone Safari QR reliability** — the installed `barcode-detector` +
   `zxing-wasm` (MIT) is unwired. **W1, closed by R1.**
2. **Final-capture resolution** — no `ImageCapture` path exists. **W2, closed by R2.**

Recommendation: implement **R1 and R2 only**, in two separate phases, each independently revertible.
Reject OpenCV.js and OMRChecker outright — the first on bundle-size grounds for low-cost phones, the
second on GPL-3.0 license incompatibility. Do not touch the desktop scanner, the consensus logic, the
quality gates, the sync layer, or the answer-sheet template in this work.
