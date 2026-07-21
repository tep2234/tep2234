# DALIguro QR Assessment — System Engineering Audit

Audit date: 2026-07-10
Scope: frontend, local persistence, Supabase integration, security, data integrity, reliability, accessibility, performance, testing, and product workflow.
Method: source review, dependency/configuration review, and local lint/test/build checks. No production data was accessed and no production behavior was changed.

## Executive verdict

The project has a strong pure-logic foundation and unusually good intent around uncertain OMR reads, but it is **not production-ready for authoritative learner records or unattended auto-scoring**. The highest risks are wrong cloud scores, incorrect phone-to-item mapping, ephemeral scan delivery, forgeable identity QR payloads, incomplete tenant/local-data isolation, false claims of persistence/sync health, and insufficient release gates.

“100% error free” is not a defensible target for a camera system. The correct engineering target is:

- zero silent scoring errors;
- no lost or duplicated submissions;
- every uncertain observation routed to review;
- every correction and override attributable and auditable;
- every failure recoverable and explained;
- accuracy demonstrated on a versioned ground-truth dataset.

Recommended release state: **internal pilot only**. Disable authoritative cloud sync and unattended auto-accept until all P0 items below are fixed and certified.

## Evidence and check results

| Check | Result | Evidence |
|---|---:|---|
| Unit tests | Pass | 24 files, 217 tests |
| TypeScript production build | Pass | `tsc -b` and Vite production build |
| ESLint | **Fail** | `src/App.tsx:143`; four additional warnings |
| Production dependency audit | Pass at audit time | No known production advisories reported |
| Browser E2E | Missing | No Playwright/Cypress setup |
| Component/a11y tests | Missing | No Testing Library/axe suite |
| Supabase/RLS integration tests | Missing | Tests deliberately cover unconfigured mode only |
| Ground-truth camera dataset | Missing | Synthetic image tests only |
| CI/release workflow | Missing | No tracked CI configuration |

The initial production JavaScript chunk is about 895 kB minified (about 268 kB gzip), which is high for a camera-first mobile route.

## Current architecture

- React 19 + React Router + Vite + TypeScript + Tailwind.
- Local-first state stored as a whole-state IndexedDB record with a plaintext localStorage mirror; scan evidence uses a second IndexedDB store.
- QR/OMR is implemented in browser code. The phone route normally uses a Web Worker; the desktop scanner performs its live/still pipeline on the main thread.
- Optional Supabase Auth, Realtime broadcast, and two Postgres tables are accessed directly from the browser. There is no authoritative application server or validated scan-ingress endpoint.
- A hand-written service worker provides partial runtime caching.

## P0 — must fix before production

### SYS-001 — Cloud rows store a false zero score

- Severity: Critical
- Evidence: `src/lib/sync/pairing.ts:169-188`; `src/components/smartscan/UsePhoneScannerPanel.tsx:169-175`.
- Failure: the PC calculates a local score, then persists the original phone row with `score: 0`, `percentage: 0`, and `corrected_by_teacher: true`.
- Impact: the local dashboard and Supabase can disagree; downstream records can receive a zero.
- Fix: separate immutable `scan_submissions` from authoritative `assessment_results`; score against an immutable assessment revision, then persist the scored result transactionally before acknowledging it.

### SYS-002 — Phone answers can map to the wrong assessment items

- Severity: Critical
- Evidence: `src/components/CheckPanel.tsx:138-150,341-350`; the printed/scanned order is defined by `src/lib/scanner/omr-template.ts:20-25`.
- Failure: phone row number `n` is mapped against every sorted item, while OMR rows contain only `omrItemsOf(...)`. A manual/essay item before an MC item shifts all answers.
- Impact: a visually correct scan can create an incorrect learner score.
- Fix: map only through the exact published OMR revision; reject count/version/revision mismatches and add mixed-item regression tests.

### SYS-003 — Realtime acceptance is treated as durable delivery

- Severity: Critical
- Evidence: `src/lib/sync/realtimeSmartScan.ts:57-63`; `src/pages/SmartScanMobilePage.tsx:349-426`.
- Failure: the phone removes a scan from recovery when the ephemeral broadcast API returns `ok`, before a PC/database commit acknowledgement.
- Impact: if the PC is absent or disconnects at the wrong moment, a scan can disappear after appearing “sent.”
- Fix: assign `scanId`; persist locally before send; keep until a matching committed acknowledgement; retry with backoff; enforce a unique server-side idempotency key.

### SYS-004 — Pairing is a bearer-token public broadcast channel

- Severity: Critical
- Evidence: `src/lib/sync/realtimeSmartScan.ts:14-68`; `src/components/smartscan/UsePhoneScannerPanel.tsx:155-190`.
- Failure: anyone with the pairing link/token can join, observe token-bearing messages, inject scans, or spoof acknowledgements/scores. Runtime payloads are only TypeScript-cast.
- Fix: use a private authorized channel or, preferably, a server/Edge Function ingress. Exchange a one-time code for a short-lived credential, validate the schema/session/server time, commit first, then acknowledge.

### SYS-005 — Learner QR identity is forgeable

- Severity: Critical
- Evidence: `src/lib/qr-parse.ts:50-64,95-118`; `src/lib/ids.ts:9-21`.
- Failure: missing checksums are accepted; the checksum is unkeyed; `securityToken` is parsed but never verified; unknown versions can fall back silently.
- Impact: an attacker or accidental malformed QR can impersonate a learner or bind a sheet to an unintended version.
- Fix: require a versioned Ed25519 signature over school, assessment revision, learner, version, item count, issue time, and a unique sheet nonce. Verify roster membership and reject unknown schema/version values.

### SYS-006 — Assessment identity is not bound across phone and PC

- Severity: Critical
- Evidence: `src/pages/SmartScanMobilePage.tsx:123-130`; `src/lib/sync/pairing.ts:131-139`; `src/components/smartscan/UsePhoneScannerPanel.tsx:165-170`.
- Failure: the phone trusts the editable `a=` URL parameter, the broadcast carries no assessment/revision ID, and the PC assigns its active assessment.
- Fix: carry signed sheet assessment/revision IDs and session ID in every submission; validate all of them server-side.

### SYS-007 — “Clear all data” leaves learner sheet images behind

- Severity: Critical privacy defect
- Evidence: `src/components/BackupTools.tsx:60-82`; `src/lib/offline-store.ts:184-217`.
- Failure: the UI resets React state but does not call the storage clear operation, so evidence remains in IndexedDB.
- Fix: one awaited repository purge covering state, evidence, outboxes, pairing/calibration metadata, caches, and user-scoped keys; confirm only after verification.

### SYS-008 — Item-bank changes do not invalidate old results

- Severity: Critical data-integrity defect
- Evidence: `src/components/ItemsPanel.tsx:74-78,107-127`.
- Failure: questions/keys can change while existing scores remain attached and reports combine old scores with new metadata.
- Fix: immutable assessment revisions and a lifecycle of Draft → Published → Printed → Scoring → Finalized. Any material edit creates a new revision and requires reprinting.

### SYS-009 — “Fix item mapping” can move every other assessment’s items

- Severity: Critical
- Evidence: `src/components/SheetsPanel.tsx:60-90`.
- Failure: all non-active items are treated as unmapped and reassigned to the active assessment.
- Fix: select an explicit source and item IDs, show a preview, protect results/keys, and support undo.

### SYS-010 — More than 80 OMR items creates an unusable sheet

- Severity: High
- Evidence: `src/components/AnswerSheet.tsx:92-100,283-318`; `src/lib/scanner/mobile-analyze.ts:122-123`.
- Failure: the QR can encode more than 80 while only 80 rows print; the phone then rejects it.
- Fix: block add/import/publish/print above 80 scannable items or split into separately revisioned forms.

## P1 — security and reliability hardening

| ID | Finding | Evidence | Best correction |
|---|---|---|---|
| SYS-011 | Local PII, answer keys, and results are globally keyed and accessible without an app workspace lock | `src/main.tsx:8-16`; `src/lib/offline-store.ts:12-17,92-97` | Authenticated/locked, user-and-school namespaced repository; explicit guest mode; inactivity lock; safe account switching |
| SYS-012 | Session expiry is visual/client-side and the real claim path is unused | `UsePhoneScannerPanel.tsx:155-194,254-255`; `smartscanSync.ts:79-100` | Atomic server transaction using database `now()`, one-time claim, revoke/close on expiry |
| SYS-013 | Database lacks score/confidence/range/JSON integrity constraints | `supabase/migrations/0001_smartscan_sync.sql:42-68` | SQL checks, constrained RPC, composite FKs, payload limits, schema validation |
| SYS-014 | Local and cloud result identity disagree about version/attempts | `scan-save.ts:25-36`; migration `:67-68` | One canonical attempt model and identical unique key everywhere |
| SYS-015 | Review/finalization/audit lifecycle is not synced | `src/lib/types.ts:171-197`; migration `:42-68` | Versioned result table plus append-only result events |
| SYS-016 | Persistence failures are swallowed while UI says saved/synced | `useQrStore.ts:43-58`; `offline-store.ts:82-98,157-182`; `App.tsx:264-266`; `ReportsPanel.tsx:308-311` | Serialized writes, revision checks, durable save status, retry and quota UI |
| SYS-017 | Whole-state persistence has no multi-tab concurrency control | `offline-store.ts`; `useQrStore.ts` | Normalized repositories, transactions, revisions, BroadcastChannel coordination |
| SYS-018 | Backup restore is shallowly validated and omits evidence | `offline-store.ts:100-153,268-274` | Versioned schema, size limits, checksum, preview/diff, atomic restore, encrypted evidence archive |
| SYS-019 | XLSX/DOCX decompression is synchronous and unbounded | `src/lib/import-file.ts:35-47,91-136` | File and expanded-size limits; worker processing; row/text caps |
| SYS-020 | CSV export permits spreadsheet formula injection | `src/lib/export.ts:3-17` | Neutralize formula-leading cells and test Excel/Sheets output |
| SYS-021 | Pairing tokens are placed in URLs and insecure LAN HTTP is suggested | `pairing.ts:63-93`; `UsePhoneScannerPanel.tsx:305-319` | HTTPS-only, POST code exchange, URL scrubbing, masked links, no-referrer policy |
| SYS-022 | Deployment has no browser security headers | `vercel.json:1-5` | Strict CSP/frame-ancestors, HSTS, nosniff, Permissions-Policy, Referrer-Policy |
| SYS-023 | Sign-in exists in code but has no reachable UI; roles/school memberships are absent | `supabaseAuth.ts:34-44`; `UsePhoneScannerPanel.tsx:271-278` | Complete auth callback/error UI and invite-based membership/role RLS |
| SYS-024 | No global error boundary | `src/main.tsx:8-18` | Route/panel boundaries with recovery and privacy-safe diagnostics |
| SYS-025 | Hand-written service worker does not precache built assets and deletes unrelated origin caches | `public/sw.js:9-16,27-35` | Generated scoped Workbox/Vite PWA manifest and update/rollback UI |

## Frontend, UX, and accessibility findings

- The 14-destination navigation contains aliases that render the same component (`src/App.tsx:428-442`). Merge them or implement genuinely distinct workflows.
- “Export” can print a blank Analysis page because print CSS expects `.print-area` but Analysis does not provide it (`src/App.tsx:445-468`; `src/index.css:45-60`). Use per-route typed export actions.
- Phone review says “confirm detected answers” but the grid is read-only (`SmartScanMobilePage.tsx:753-779,878-896`). Either make it editable or make the phone explicitly a read-only preview and require PC review.
- “PC paired” is derived from URL/config validity, not a completed handshake (`SmartScanMobilePage.tsx:186,706-708`). Show Connecting/Paired/Offline/Expired/Retrying from actual channel state.
- Learner and review tables clip on narrow screens; the PWA is globally portrait-locked. Use responsive cards/scroll, `100dvh`, safe-area padding, and allow tablet landscape.
- A source-wide review found almost no ARIA state. Camera status/errors are not live regions; mode controls lack `aria-pressed`; focus-visible and disabled styles are inconsistent; some icon-only actions have no accessible name.
- The accepted-answer editor destroys trailing delimiters during typing (`ItemsPanel.tsx:205,306-320`). Keep raw draft text and parse on commit.
- CSV learner import maps every unrecognized sex value to `M` and does not deduplicate LRNs (`LearnersPanel.tsx:79-86`). Add a validation/merge preview.
- `TERMS` omits Fourth Quarter while reports append “Quarter” (`src/lib/types.ts:18-19`; `ReportsPanel.tsx:461-463`).
- There is no Class/Enrollment entity; global learners are treated as the active assessment roster. Add school year, class, enrollment, assessment assignment, attendance/missing-submission state, and attempt policy.

## Reporting and standards consistency

- Mastery uses 80/60/40 in `src/lib/scoring.ts:34-39` but 90/75/50 in `src/lib/report-intel.ts:9-17`.
- Difficulty uses four 80/60/40 buckets in `src/lib/analysis.ts:32-40` and three 70/30 buckets in `src/lib/report-intel.ts:63-85`.
- `report-intel.ts:106-138` labels mean confidence as “scan accuracy,” treats non-review as “auto-finalized,” counts all results as scanned, and hardcodes lost results to zero.

Create one versioned/configurable grading and reporting policy. “Confidence” is not accuracy; accuracy requires ground truth. “Saved locally,” “transport sent,” “server committed,” “reviewed,” and “finalized” must remain distinct states.

## Test and delivery gaps

1. Fix lint and make `lint`, strict typecheck, unit tests, coverage, and build mandatory in CI.
2. Add Supabase local integration tests for migrations, RLS, cross-user denial, expiry, duplicate retries, and transaction rollback.
3. Add React component/axe tests and Playwright workflows for setup → publish → print → scan → review → finalize → export.
4. Add PWA offline/update tests, multi-tab concurrency tests, storage-quota tests, and corrupted-backup tests.
5. Add camera ground-truth fixtures and physical device certification; see `CAMERA_SCANNER_AUDIT.md`.
6. Pin a Node engine, add `.env.example`, SECURITY.md, dependency update automation, and deployment rollback instructions.

## Product features with the best reliability/productivity return

1. **Reliability Center** — local-save, cloud-sync, storage quota, pending scan jobs, last verified backup, app/schema/algorithm versions, and exportable privacy-safe diagnostics.
2. **Immutable assessment publishing** — revisioned forms, signed sheets, print readiness, and explicit invalidation/reprint workflow.
3. **Durable scan ledger** — scan UUID, sheet nonce, device/session, lifecycle, retries, duplicate comparison, evidence link, and committed acknowledgement.
4. **Class and attempt management** — enrollment, absent/missing list, one official attempt, controlled retakes, version assignment, and learner history.
5. **Undo/recycle bin** — reversible learner/item/result changes and item-bank replacement rollback.
6. **Teacher review cockpit** — keyboard shortcuts, next doubtful item, evidence zoom/crop, batch confirm with exception list, and reasoned overrides.
7. **Intervention outcome tracking** — assign remediation, capture completion and follow-up assessment, compare pre/post mastery, and flag non-response to support.
8. **Release self-check** — storage write, offline/reconnect, printer/QR readiness, camera calibration, device profile, and version/update status.
9. **Privacy controls** — evidence retention policy, encrypted export, verified deletion, shared-device lock, access log, and school-configured retention.
10. **Observability** — privacy-safe correlation IDs and metrics for save failure, rescan, review, duplicate, queue, sync latency, crash, and long-session degradation.

## Recommended implementation order

1. Correct phone item mapping and cloud zero-score writes.
2. Introduce immutable assessment revisions, signed sheet IDs, scan IDs, durable outbox/commit acknowledgements, and idempotency.
3. Enforce server-side session/tenant/payload validation through a transactional ingress API.
4. Fix real deletion, persistence status, backup validation, and user-scoped local storage.
5. Align cloud schema with attempts, review/finalization, evidence metadata, and append-only audit events.
6. Add CI, integration/E2E/a11y tests, error boundaries, security headers, and scoped PWA caching.
7. Standardize grading/report policies and correct reliability metric labels.
8. Complete the camera safety and certification roadmap in the companion report.

## Strengths to retain

- Shared printable/scanner geometry.
- Pure scoring and OMR modules with broad unit coverage.
- Explicit unclear/multiple/low-confidence states and a review queue.
- Local scan evidence for the desktop path.
- Finalized-result overwrite guard.
- Cryptographically random pairing-token generation and owner-scoped table RLS.
- Offline-first product intent and honest recognition that camera scanning cannot promise literal zero error.
