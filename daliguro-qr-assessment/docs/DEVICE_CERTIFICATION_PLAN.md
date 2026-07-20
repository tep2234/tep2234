# SmartScan Phone→PC Real-Device Certification Plan

Scope: certify the three P0 fixes on real hardware before a controlled pilot.
This is a **plan and recording template** — the gates below are release targets,
not claims. Fill the matrix with actual measured results.

Related automated coverage (already green in CI, see the certification report):
frame-stability resolution normalization, outbox drain reliability, and the
verified-teacher SQL contract (the SQL contract still requires a real Postgres
run via `scripts/test-postgres-migrations.sh`).

## Devices & browsers (minimum set)

| Slot | Device class | OS | Browser | Rear cam | Front cam |
|------|--------------|----|---------|----------|-----------|
| A | Android phone (mid-range) | Android 12+ | Chrome | required | if supported |
| B | iPhone | iOS 16+ | Safari | required | if supported |
| C | PC dashboard | — | Chrome/Edge | — | — |

Front and rear camera behavior is recorded where the device exposes both.

## Environmental / capture conditions (each device)

Bright classroom · normal indoor · low light · glare · slight movement · sheet
tilt · partial sheet visibility · blurry capture · network interruption ·
offline queue recovery · expired pairing capability · duplicate scan · rapid
consecutive scans.

## Per-trial recording template

Record one row per trial (device × condition):

| # | Device | Browser | Cam resolution | Lighting | Distance | Capture time (s) | Stability result | QR result | Answer detection | Score result | Phone→PC delivery | Retry behavior | Duplicate behavior | Verdict |
|---|--------|---------|----------------|----------|----------|------------------|------------------|-----------|------------------|--------------|-------------------|----------------|--------------------|---------|
| 1 | A | Chrome |  | bright |  |  |  |  |  |  |  |  |  |  |
| 2 | A | Chrome |  | indoor |  |  |  |  |  |  |  |  |  |  |
| … | | | | | | | | | | | | | | |

Legend:
- **Stability result**: accepted / rejected (reason code, e.g. `FINAL_CAPTURE_UNSTABLE`).
- **QR result**: correct learner+version / misread / not found.
- **Phone→PC delivery**: appeared on PC / visibly queued / lost.
- **Retry behavior**: n/a / recovered after reconnect / permanent-rejected+surfaced.
- **Duplicate behavior**: single durable result / duplicate (FAIL).

## Fix-specific focus checks

**Fix 1 — resolution-aware stability**
- Hold a sharp sheet perfectly still through the stable-frame count on each
  device; the final high-res still must be **accepted**, not rejected as
  "focus/lighting changed". Record the live vs final capture resolutions.
- Intentionally defocus at the moment of final capture; must still **reject**.

**Fix 2 — outbox retry recovery**
- Airplane-mode mid-submit, then restore: the scan must deliver or stay visibly
  queued; never a silent permanent stall. After recovery, later scans in the
  same session must also deliver (no head-of-line deadlock).
- Force a permanent rejection (e.g. stale learner cache) and confirm the teacher
  sees a clear message and the queue keeps moving.
- Rapid consecutive scans: no duplicate durable result on the PC.

**Fix 3 — verified-teacher enforcement**
- Confirm the PC requires a verified (non-anonymous) teacher sign-in to create a
  pairing session (anonymous is blocked in UI). Server enforcement is validated
  by the SQL contract, not on-device.

## Release gates (targets — report actual measured values)

- Stable clear-sheet acceptance: **≥ 98%**
- Intentionally blurred / unstable capture rejection: **≥ 95%**
- Correct QR identification: **100%** on the controlled test set
- No duplicate durable result from repeated delivery
- No permanent queue deadlock
- No anonymous teacher-only write (server contract must pass)
- Phone result appears on PC or remains visibly queued
- Every failure produces a recoverable or clearly explained state

## Sign-off

| Gate | Target | Measured | Pass? |
|------|--------|----------|-------|
| Clear-sheet acceptance | ≥98% |  |  |
| Blur/unstable rejection | ≥95% |  |  |
| QR identification | 100% |  |  |
| No duplicate durable result | 0 |  |  |
| No queue deadlock | 0 |  |  |
| Verified-teacher server contract | pass |  |  |

Certifier: ____________  Date: ____________  Build id (`b<...>`): ____________
