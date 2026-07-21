# Camera Scanner — Field Validation Results

Status as of 2026-07-21: **NO PHYSICAL DEVICE TESTING HAS BEEN PERFORMED.**

This file is the record of real-device evidence. It is currently empty of
results by design, not by oversight. No physical device — no iPhone, no Android
phone, no tablet — was available to this engineering environment. Every row
below is therefore `NOT RUN`.

**Nothing in this file may be filled in from simulated, mocked, or emulated
browser behaviour.** Playwright/WebKit results, however strong, are recorded in
the certification report as *browser-engine* evidence and are deliberately kept
separate from *device* evidence here. WebKit on a desktop is not an iPhone: it
shares a rendering engine but not the camera stack, the ISP, the thermal
envelope, or the memory ceiling.

Procedure: `CAMERA_SCANNER_FIELD_VALIDATION_PLAN.md`
Record schema: `CAMERA_SCANNER_FIELD_RESULTS_TEMPLATE.json`
Build identity: `CAMERA_SCANNER_FIELD_BUILD_MANIFEST.md` / `.json`
Validator: `npm run camera:field:validate`

## Before recording anything

1. `npm run build && npm run camera:field:manifest`
2. Copy `source.headCommit` and `source.treeSha256` into each record's
   `buildIdentity`. **A record without them is rejected** — a result that cannot
   be tied to an exact artifact is an anecdote, not evidence.

   Use **`treeSha256`**, not `diffSha256`. `git diff` ignores untracked files,
   and most scanner source is currently untracked, so `diffSha256` alone can stay
   constant while the scanner changes (defect found and fixed 2026-07-21 — see
   `CAMERA_SCANNER_KNOWN_FAILURES.md` §2.8).
3. Save records as `field-results/*.json`, then run
   `npm run camera:field:validate`. It rejects missing build identity, missing
   device/OS/browser versions, impossible counts (successes > attempts),
   unsupported decoder/capture paths, and any student-identifying or
   credential-shaped field.

---

## Summary

| Phase | Target | Status | Evidence |
|---|---|---|---|
| 7 — iPhone Safari | 70 scans across 5 conditions | **NOT RUN** | no device |
| 8 — Android Chrome | 20 scans + network proof + native-failure test | **NOT RUN** | no device |
| 9 — ImageCapture hardware | ≥20 `takePhoto` captures + fallback device | **NOT RUN** | no device |
| 10 — Airplane mode | Scenario A (10 scans), Scenario B (reload) | **NOT RUN** | no device |
| 11 — Endurance | 50 then 100 scans on a low-cost Android | **NOT RUN** | no device |

## Integrity gates

| Gate | Required | Observed |
|---|---|---|
| Wrong learner identities | 0 | **not measured** |
| Wrong assessment identities | 0 | **not measured** |
| Invalid payloads accepted | 0 | **not measured** |
| Ambiguous auto-finalized | 0 | **not measured** |
| Duplicate final submissions | 0 | **not measured** |
| Silently lost accepted scans | 0 | **not measured** |

`not measured` is not `0`. These gates are unproven on hardware.

---

## What *is* proven, and where it stops

Recorded here so this file is not mistaken for "nothing works".

| Proven | How | Stops short of |
|---|---|---|
| The real zxing-wasm binary decodes DALIguro QR fixtures (standard, small, rotated, low-contrast, grayscale, blurred, shadowed) | 45/45 Playwright assertions in Chromium, Firefox **and WebKit** — real WASM, not mocked | a real camera sensor, real optics, real motion blur, real print |
| The WASM is fetched only from the application origin; never a CDN | network interception in a real browser | a real offline device |
| Decoding continues with the network disabled after load, with zero further requests | `context.setOffline(true)` + 10 decodes | a real airplane-mode phone with a service worker cold start |
| The module instantiates exactly once, shared across concurrent frames | real-browser diagnostics | a long real session on constrained RAM |
| A tampered/foreign/wrong-assessment payload is rejected even when genuinely decoded | real-browser trust-gate assertions | — (this one is strong) |

The gap between column 1 and column 3 is precisely what the field plan exists to
close.

---

## Result log

_(empty — append one JSON record per run, per the template)_

```
No runs recorded.
```

---

## How to record a run

1. Copy the `example` object from `CAMERA_SCANNER_FIELD_RESULTS_TEMPLATE.json`.
2. Read `QR path:` and `Still:` from the scanner confirm screen.
3. Leave anything you did not measure as `null`. **A null is honest; an invented
   number corrupts the whole record.**
4. Append it under "Result log" with the date and tester.
5. Update the Summary table.
6. If any integrity gate is non-zero, stop testing and open a blocking defect —
   do not continue accumulating scans.
