# DALIguro SmartScan Assessment Engine (Standalone)

An offline-first assessment engine for DepEd teachers. Print QR-coded bubble
sheets, scan them with a phone camera, auto-check with confidence scoring, review
only the doubtful marks, and turn every scan into item analysis, mastery groups,
and remediation reports.

- **Not** connected to the main DALIguro project (integration comes later).
- **No** Supabase. All data — including scanned-sheet evidence images — is stored
  locally on the device (IndexedDB, with a localStorage fallback).
- Stack: Vite + React 19 + TypeScript + Tailwind CSS v4. QR generation via the
  `qrcode` package; QR decoding via the native `BarcodeDetector` with a bundled
  `jsqr` fallback; OMR bubble reading is pure in-browser computer vision (no
  network, no runtime service — fully offline).

## The honest promise

"Zero error" is not a promise any camera system can keep — not bank check scanners,
not exam machines, not humans. SmartScan aims for something better and truthful:

> **Fast, accurate scanning with confidence checking and teacher verification for
> doubtful marks.**

Every scan gets a **trust score**. Clean, high-confidence scans save automatically;
anything unclear, faint, double-marked, or low-confidence is routed to a **Review**
queue for the teacher. Nothing is silently guessed.

## Run

```bash
npm install
npm run dev      # start the dev server
npm run build    # typecheck (tsc -b) + production build
npm test         # 121 unit tests for the pure logic
```

Open the URL Vite prints (usually <http://localhost:5173>). For phone camera
testing over HTTPS, use `npm run dev:https` and open `https://YOUR_MAC_IP:5173`
(accept the one-time self-signed-cert warning). See **Camera needs HTTPS** below.

## The 10-tab teacher workflow

**Setup · Items · Learners · QR Sheets · SmartScan · Review · Results · Analysis ·
Remediation · Reports**

1. **Setup** — create an assessment (subject, grade, section, term, component,
   versions A–D). *Load demo* seeds a complete, cross-device-consistent sample.
2. **Items** — encode questions; tag each with competency, **topic**, difficulty,
   and **cognitive level** (Bloom). Bulk-import from CSV. Set per-version answer keys.
3. **Learners** — type them in or import a class list (CSV).
4. **QR Sheets** — print one SmartScan bubble sheet per learner. The QR holds
   identity only.
5. **SmartScan** — scan the filled sheets. Batch mode auto-saves clean scans and
   queues doubtful ones.
6. **Review** — the queue of doubtful scans only. Correct flagged items (with the
   archived scan image as evidence), then confirm.
7. **Results** — dashboard cards (checked / pending / finalized / class avg /
   passing rate), the finalize-and-lock workflow, and a per-result audit trail.
8. **Analysis** — mastery + score-distribution charts, item analysis with
   **discrimination index** and **item-quality flags**, competency mastery, and a
   copyable **Smart Teacher Summary**.
9. **Remediation** — automatic support groups A–D with suggested activities, plus
   performance-based **Learning Attention Flags**. Printable for the intervention log.
10. **Reports** — one-click CSVs (learner, item, competency, remediation) and the
    **Gradebook Sync CSV** (finalized results only), plus a teacher reflection blurb.

## The SmartScan answer sheet (template v2)

The printable sheet and the scanner read from **one canonical geometry**
(`src/lib/scanner/omr-template.ts`), so a bubble printed at (cx, cy) is read at
(cx, cy) after perspective correction. Layout:

- Four **target corner markers** (solid square with a white knockout) for alignment.
- A **QR panel** carrying identity only.
- A **shade-one VERSION row** (A–D) that the scanner reads as a *second* identity
  layer — cross-checked against the QR to catch mixed-up sheets.
- A fixed **4-column × 20-row grid, 5 choices (A–E)**, supporting up to 80 items.
  The full grid always prints; rows beyond the active item count are dimmed and
  ignored by the detector, so geometry never shifts when the item bank changes.

## Layered verification (near-zero silent error)

1. **QR integrity** — the identity payload carries a checksum and the printed item
   count; `src/lib/qr-parse.ts` refuses tampered QRs and any QR carrying
   answer/score-shaped fields.
2. **Stale-sheet gate** — a sheet printed with a different item count than the
   current assessment is refused (reprint required).
3. **Version cross-check** — the shaded VERSION bubble must match the QR's version.
4. **Image quality gates** — corner alignment, brightness, and blur are checked
   before scoring; a too-dark or too-blurry frame is rejected with guidance.
5. **Per-item confidence** — each bubble is classified `selected` / `blank` /
   `unclear` / `multiple` with a confidence value; unclear/multiple block auto-save.
6. **Trust score + Review queue** — the mean confidence is the scan's trust score;
   below the auto-accept threshold (or any doubtful item) routes to Review.

## Scanning behavior

- **Batch mode** (default): point the camera; after ~1 second of steady framing
  (QR found + corners aligned + well-lit) it **auto-captures**. Clean scans save
  and log a running "Recent scans" list; doubtful ones go to Review. A cooldown and
  a same-learner guard stop one sheet from firing repeatedly.
- **Single mode**: each scan opens for review before saving.
- **Fallbacks**: Manual (hand-mark answers) and QR Paste (diagnostic) remain.
- **Evidence archive**: a compressed JPEG of each scanned frame is stored in
  IndexedDB, keyed to the result, and shown in the Review tab.

### Camera scanner on a phone needs HTTPS

The camera works on this Mac over `http://localhost` (a secure context), but a
**remote phone** only allows `getUserMedia` over **HTTPS**. Run `npm run dev:https`
for camera testing on a phone; without it the app still loads — only the camera is
blocked (use the photo button or QR Paste there).

## Score lifecycle, finalization, and audit

Results move through `auto → needs_review → reviewed → finalized`. **Finalizing**
locks a score for the gradebook; a later edit requires a typed reason and is recorded
in the result's **audit log** (with timestamps). The Gradebook Sync CSV exports only
finalized results.

## Mastery bands (80 / 60 / 40)

- **Mastered** — 80% and above
- **Near Mastery** — 60 to 79%
- **Needs Reinforcement** — 40 to 59%
- **Critical Support** — below 40%

The same 80/60/40 cutoffs drive item difficulty (Easy / Moderate / Difficult / Very
Difficult) and per-competency mastery.

## Analytics (performance-based, no fake science)

- **Discrimination index** (upper/lower 27%) — how well an item separates high from
  low scorers.
- **Item-quality flags** — very low correct rate, near-zero/negative discrimination,
  a shared wrong answer, too-easy items, and blank-heavy items are surfaced so the
  teacher can check the *item* (answer-key error, unclear wording), not just the learner.
- **Learning Attention Flags** — On Track / Needs Monitoring / Needs Support / Needs
  Immediate Remediation, derived from observable data (score, blanks, patterned
  answering, missed easy items). This does **not** claim to measure attention itself.
- **Smart Teacher Summary & Reflection** — rule-based narratives (average, strengths,
  weak items/competencies, learners needing support, a recommended next action),
  copyable into a DLL reflection or intervention report.

## Security rule (must stay true)

The QR carries **identity only**: `assessmentId`, `learnerId`, `lrn`, `section`,
`gradeLevel`, `version`, `securityToken`, item count, and an integrity checksum.
Answer keys live only in local storage and are **never** embedded in a QR. The
validator defensively rejects any scanned/pasted QR that contains
answer-key- or score-shaped fields, even though this app never produces one.

## Install as an app (PWA)

The production build is an installable, offline-capable PWA (`public/sw.js`,
`public/manifest.webmanifest`). Bump `CACHE_VERSION` in `public/sw.js` on each
release so old caches retire (currently `daliguro-qr-v2`).

```bash
npm run build
npm run preview:https   # serves dist/ over HTTPS on the LAN
```

Open `https://YOUR_MAC_IP:4173`, accept the cert warning, then use the browser's
Add to Home Screen / Install option.

## Release checklist (manual — do before shipping)

Unit tests (121) and headless-browser verification prove the pure OMR/scoring
pipeline and that every tab, the printable sheet, the finalize/audit flow, and the
gradebook export work. **One thing they cannot cover, and it must be signed off by a
human on real hardware before each release:**

- [ ] **Real phone-camera scan** — print an actual SmartScan sheet, shade the bubbles
      with a dark pen/pencil, and scan it with a real phone camera over HTTPS
      (`npm run dev:https` or the deployed URL). Confirm on **both** an Android/Chrome
      device (native `BarcodeDetector` path) and an iPhone/Safari device (jsQR
      fallback) that: the QR decodes, corner markers align, the shaded VERSION bubble
      is read, bubbles score correctly, a clean sheet auto-captures in batch mode, and
      a faint/double mark routes to the Review queue. This is the gate that catches
      real-world lighting, focus, paper, and print-scale issues.

## Real-device testing (also required before DALIguro integration)

The build passes typecheck, lint, build, and 121 logic unit tests, but QR
rendering, print behavior, local-storage persistence, CSV download, live camera
scanning, and mobile layout can only be fully verified on real hardware. Work through
[`MANUAL_TESTING_GUIDE.md`](./MANUAL_TESTING_GUIDE.md) and the checklist below on a
real machine and pass them **before** starting any DALIguro/Supabase integration.

## Browser testing checklist

Fast path: **Setup → Load demo assessment**, then test.

- [ ] **Demo data** — loading the demo creates 1 assessment, 10 A–D items + keys,
      5 learners, versions A & B, set active.
- [ ] **Persistence** — refresh; all data (and scan evidence) survives.
- [ ] **QR Sheets** — the printed sheet matches the SmartScan design (QR panel,
      pre-shaded VERSION bubble, 4×20 grid, target markers); the QR scans in a
      phone camera / QR reader.
- [ ] **SmartScan · batch** — a clean shaded sheet auto-captures and auto-saves; a
      deliberately ambiguous mark routes to **Review** (tab badge increments).
- [ ] **Quality gates** — a too-dark, too-blurry, wrong-version, or stale-item-count
      sheet is refused with a clear message.
- [ ] **Review** — correct a flagged item → it moves to `reviewed`; the evidence
      image opens.
- [ ] **Results** — Finalize one / Finalize all locks the score 🔒; the audit history
      shows the entries; editing a finalized score prompts for a reason.
- [ ] **Analysis** — mastery bars, score histogram, discrimination, item-quality
      flags, and the Smart Teacher Summary all render/copy.
- [ ] **Remediation** — groups A–D and attention flags render and print.
- [ ] **Reports** — each CSV downloads; the Gradebook CSV contains only finalized
      results.
- [ ] **Backup** — Setup → Export / Import / Clear all data (double-confirm).

## Future integration into DALIguro

When stable, this can connect to the main app via:

- **Supabase tables** replacing `offline-store.ts` (keep the same
  `loadState` / `saveState` / `clearState` API — the isolation seam).
- **Gradebook** — push finalized scores per component.
- **SF9** — feed quarterly grades.
- **Remediation module** — reuse the analysis output (groups + attention flags).
- **Subject-teacher dashboard** — surface assessments and results.
