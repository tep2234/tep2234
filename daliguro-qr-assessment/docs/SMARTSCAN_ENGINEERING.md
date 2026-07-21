# SmartScan engineering and certification

## Processing architecture

The phone requests a rear-facing 2560×1440, 30 fps stream with ideal constraints. A remembered manual device selection uses an exact device ID. After permission, the app enumerates video inputs and records the track's actual width, height, frame rate, facing mode, device ID, aspect ratio, focus mode, zoom, and torch capability. Unsupported controls are never applied.

Frames are scheduled with `requestVideoFrameCallback` when available and `requestAnimationFrame` otherwise. Only one async analysis job runs at a time. The nominal 90 ms interval expands to 125% of measured decode duration, capped at 500 ms, so slow devices skip frames instead of building a backlog. Live frames are capped at a 1300 px minor side; the independently verified final still uses 2200 px.

The decoder cascade is:

1. Native `BarcodeDetector` when available.
2. Fast normal-polarity whole-frame jsQR decode, downsampled to at most 1000 px on its longest side.
3. On thorough/final captures, detect four sheet markers and rectify the canonical QR zone from the original pixels.
4. Decode the rectified zone, then one 2× zone variant.
5. Fall back to bounded regional, inversion, contrast, and threshold variants.
6. Validate the decoded DALIguro payload before using any identity.

Multiple decoder attempts on one frame are one observation. Automatic capture requires four consecutive frames with the same freshly decoded payload, stable anchored geometry, stable luminance, and stable sharpness. A high-resolution final still is decoded and checked independently.

## QR payload

Current prints use `DG3|assessmentId|learnerId|version|itemCount|sheetToken|checksum`, error correction M, and a four-module quiet zone. The current regression payload is 64 bytes and 33 modules. It contains opaque local IDs and a random 64-bit sheet token, but no learner name, LRN, grade, section, answers, or scores. The checksum detects damage; it is not a cryptographic signature. Legacy v2 JSON sheets remain readable.

## Identity and answer outcomes

- A decoded string is not an accepted identity until the production parser validates its prefix/shape, version, item count, sheet token, checksum, assessment, and learner.
- QR-zone rescue is recorded as `identitySource: "zone-rescue"` in the durable phone payload and safe diagnostic.
- If every QR stage fails but sheet geometry and OMR remain readable, the reading and per-item confidence are preserved as an unresolved-identity scan. No learner is guessed and no result is saved automatically.
- Manual identity completion rechecks assessment existence, enabled version, item count, and learner existence. It remains attributable as a manual source and enters normal review.
- Blanks, selected marks, multiple marks, unclear marks, unreadable regions, confidence, and fill evidence remain separate.

## Duplicate, offline, and receipt behavior

Every accepted capture receives one `scanId`. The phone persists it in a session-scoped local outbox before transport. Retries reuse the same ID, sequence number, payload digest, and database ingress identity. The phone only removes the outbox item after the capability-checked inbox RPC returns a durable receipt. Final “saved” status requires the PC's result receipt; Realtime is an optimization and database polling recovers missed notifications.

## Security boundary

The UI no longer treats an anonymous authenticated Supabase user as a teacher principal. A verified email session is required before the PC can create pairing sessions. Phone claims and submissions remain capability-scoped.

Server-side anonymous-teacher rejection is not yet certified. The current committed SQL RPCs check `auth.uid()` but do not consistently reject the JWT `is_anonymous` claim. A new migration and live/local PostgreSQL contract run are required before security certification. Do not represent the frontend check as a database security boundary.

## Automated release matrix

- TypeScript, ESLint, Vitest scanner/QR/OMR/outbox/auth tests, and production build are mandatory local gates.
- Playwright covers image ingestion and a rendered-sheet live-camera-to-inbox workflow. The configuration can use an installed system Chrome when `PLAYWRIGHT_USE_SYSTEM_CHROME=true`; Firefox and WebKit still require their Playwright browser binaries.
- PostgreSQL contracts cover RLS, tenant isolation, replay, expiry, rollback, durable receipts, and review events, but require a running Docker daemon.
- Synthetic fixtures do not certify phone optics, printers, paper, lighting, thermal behavior, or browser camera-driver behavior.

Latest local verification (2026-07-19): TypeScript and ESLint passed; all 377 Vitest tests passed; the production build passed with route-level chunks below 500 kB; and all 11 Chromium browser tests passed in system Chrome, including the rendered-sheet live-camera-to-durable-inbox flow. Firefox, WebKit, PostgreSQL contracts, and physical-device certification were not run in this environment.

## Physical-device certification matrix

Test iPhone Safari, a low-end Android Chrome device, a midrange Android Chrome device, a multi-rear-camera device, torch and non-torch devices, portrait and landscape, weak and bright lighting, glare, an original print, a photocopy, and wrinkled paper. Record OS/browser, selected device, actual track settings, attempts, successes, false identities, median scan time, duplicate behavior, offline behavior, and recovery behavior.

The release remains blocked from full certification until that evidence exists. Upscaling can improve sampling of recoverable source pixels; it cannot recreate missing QR modules.

## Recovery instructions

If a QR is unreadable, move closer without cropping the four targets, hold still, improve focus/light, reduce glare, or choose the correct rear camera. If answers are preserved, identify the learner only from the printed paper or enter the exact visible sheet code. If sync is pending, keep the phone page open; the local outbox retries until the durable inbox receipt arrives.
