# Camera Scanner — Physical Device Validation Plan

Version: 2026-07-21
Applies to: `security/smartscan-realtime-certification` at base `8b102a2` + R0/R1/R2 + hardening.

This plan exists because **no amount of local testing can certify a camera.**
Everything in `CAMERA_SCANNER_CERTIFICATION_REPORT.md` marked *Unverified* is
converted here into a concrete, executable procedure.

---

## 0. Before you start

### Privacy rules — non-negotiable

- Use **synthetic** assessments and learners only. Never scan a real student's sheet.
- Record results only in `CAMERA_SCANNER_FIELD_RESULTS.md` / the JSON template.
- Never record: student names, real LRNs, pairing tokens, raw QR payload text,
  raw sheet images, Supabase keys.
- If a device screenshot is attached to a bug, crop or redact the QR.

### Materials

1. A synthetic assessment (10 items) with a synthetic learner, e.g. `SYNTH-L1`.
2. Printed sheets at two QR sizes:
   - **Standard** — the default template size.
   - **Small** — the smallest size the template supports, to stress the decoder.
3. A phone tripod or stand (removes hand tremor as an uncontrolled variable).
4. A room where lighting can be varied, plus a lamp for deliberate glare.

### Reading the evidence — no new tooling required

The scanner UI already shows what this plan needs, on the confirm screen:

| UI field | Meaning |
|---|---|
| `QR path:` | which decoder produced the identity — `provided` (native), `zxing-wasm`, `whole-frame`/`region-cascade`/`zone-rescue` (jsQR) |
| `Still:` | which capture rung ran, and the **true** source dimensions |
| engine/ms/interval | worker vs main-thread, and per-frame analysis cost |

`QR path: provided` on Android and `QR path: zxing-wasm` on iPhone is the single
most important observation in this entire plan.

---

## 1. Test matrix

| Phase | Device | What it proves |
|---|---|---|
| 7 | iPhone Safari | ZXing WASM works where no native detector exists |
| 8 | Android Chrome | native path stays fast; WASM is not downloaded |
| 9 | Any `takePhoto` device | genuine high-resolution still capture |
| 10 | Either | offline scanning + outbox + reconnect |
| 11 | Low-cost Android | endurance, memory, thermal |

---

## 2. Universal integrity gates

These apply to **every** run in every phase. Any non-zero value is a **blocking
defect**, and no amount of good throughput compensates:

- Wrong learner identities: **0**
- Wrong assessment identities: **0**
- Invalid payloads accepted: **0**
- Ambiguous results auto-finalized: **0**
- Duplicate final submissions: **0**
- Silently lost accepted scans: **0**

A failed scan that asks for a retake is a **success** for these gates. A scan
that silently binds the wrong learner is a **catastrophic failure** even if 99
others were right.

---

## 3. Phase 7 — iPhone Safari

**Hypothesis under test:** the ZXing WASM tier meaningfully improves QR
acquisition on Safari, where `BarcodeDetector` is absent.

| Condition | Scans | Required result |
|---|---|---|
| Normal light, standard QR | 20 | 20/20 correct identity; `QR path: zxing-wasm`; jsQR cascade does not run after acceptance |
| Small QR | 20 | ≥19/20 accepted; **0** wrong identities; failures show retry/unreadable |
| Angled sheet (~20–30°) | 10 | 0 wrong identities |
| Low light | 10 | 0 wrong identities |
| Partial glare | 10 | 0 wrong identities |

Record per condition: success count, failure count, median decode time, p95 when
practical, decoder path, retry reasons, browser version, device model.

**If ZXing does not help:** do **not** add another QR library. Preserve the
evidence, then determine whether the cause is QR print size, camera resolution,
WASM startup, worker timing, Safari memory, or payload density. Build the
smallest reproduction (the `browser-tests/decoder-harness.ts` fixtures are the
natural home), add a regression test, revise the narrowest component, re-test.

---

## 4. Phase 8 — Android Chrome

**Hypothesis:** native `BarcodeDetector` remains the fast path and the WASM is
never fetched.

1. Normal light, standard QR, **20 scans** → 20/20 correct; `QR path: provided`.
2. **Network proof** (Chrome DevTools → remote debugging → Network, filter `wasm`):
   - `zxing_reader-*.wasm` is **never requested**.
   - jsQR does not run after native acceptance.
3. **Native-failure test** — using a development-only override (do **not** weaken
   production behaviour): disable the native detector, then confirm
   - WASM loads **from the application origin**,
   - decoding succeeds,
   - a forced WASM failure still falls through to jsQR.

---

## 5. Phase 9 — ImageCapture hardware

On a device where `takePhoto` is supported:

1. UI reports `Still: takePhoto`.
2. Record preview dimensions **and** takePhoto source dimensions.
   The source width must **exceed** the preview width — otherwise `takePhoto`
   gives no benefit on this device and that finding must be recorded.
3. Processing dimensions are reported separately and are **not** presented as
   source resolution.
4. Camera stream remains usable after capture; preview does not stay frozen.
5. No second permission prompt.
6. Final QR verification still runs on the still.
7. Preview/final disagreement still routes to review.
8. Repeat **≥20** captures.

On a device without `ImageCapture` (any iPhone): confirm `Still: canvas` and a
normal successful scan.

---

## 6. Phase 10 — Airplane mode

### Scenario A — application already loaded (**supported**)

1. Load the scanner online; complete one scan so the decoder asset is fetched.
2. Enable airplane mode.
3. Complete **10** synthetic scans.
4. Required: 10/10 decode; no external request; outbox holds all 10.
5. Restore connectivity.
6. Required: sync resumes; **0** duplicate final submissions; **0** lost scans.

### Scenario B — full offline reload (**verify before claiming**)

The app registers a service worker with a cached app shell, so a cold offline
reload is *plausible* — but it is **not proven**. Test it explicitly:
airplane mode → full page reload → does the scanner load and decode?

If it fails, record it as a service-worker/offline-startup limitation. **Do not
classify it as a QR-decoder defect**, and do not claim full offline startup in
any report until this passes.

---

## 7. Phase 11 — Endurance, low-cost Android

1. **50 consecutive scans**, normal light. Then, if stable, **100**.
2. Record: successes, retries, wrong identities, duplicate receipts, lost scans,
   camera freezes, worker fallbacks, WASM init count, capture source, memory
   warnings, crashes, reloads, median and p95 total scan time.

**Degradation analysis — do not skip this.** Compare the **first 10** scans
against the **last 10**. Investigate if scan time, memory, or failure rate
worsens progressively. Where Chromium memory tooling is available, take heap
snapshots before and after.

The bar is **not** a fixed memory number: it is that scanner-owned objects show
**no clear unbounded linear growth**. WASM init count must stay at 1 for the
session — a climbing count means the module is being re-instantiated per scan.

---

## 8. Failure handling

For every physical failure, follow the loop in the prompt: preserve exact device
evidence → reproduce locally against the closest fixture → classify → add a
focused regression test → smallest safe change → focused, related, and full
suites → rebuild → re-test the device → record before/after.

**Never resolve a hardware failure by:** accepting lower-confidence identities,
bypassing the `accept()` gate, reducing checksum/assessment/learner validation,
disabling review routing, suppressing decoder errors, adding unlimited retries,
processing every full-resolution frame, adding another camera framework without
proof, adding a cloud QR/OCR dependency, or uploading raw answer sheets.

---

## 9. Exit criteria

`PASS` requires all local gates **plus** all of:

- Phase 7 iPhone Safari targets met with 0 identity errors.
- Phase 8 native path confirmed, WASM not downloaded.
- Phase 9 at least one real `takePhoto` device validated, plus the fallback path.
- Phase 10 Scenario A fully passed.
- Phase 11 ≥50 consecutive scans on a low-cost device with 0 identity errors and
  no unbounded growth.

Anything short of that stays `PASS_WITH_LIMITATIONS` (or `BLOCKED_EXTERNAL` if
devices are simply unavailable). Partial device evidence must **never** be
generalized into a full `PASS`.
