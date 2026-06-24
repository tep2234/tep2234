# DALIguro QR Assessment (Standalone)

A separate, offline-first QR Assessment System for DepEd teachers. Built to be
tested on its own first, then integrated into the main DALIguro app later.

- **Not** connected to the main DALIguro project.
- **No** Supabase. All data is stored locally on the device.
- Stack: Vite + React + TypeScript + Tailwind CSS v4. QR generation via the
  `qrcode` package; QR scanning via the native `BarcodeDetector` with a
  bundled `jsqr` fallback (no network/runtime dependency — offline-first).

## Run

```bash
npm install
npm run dev      # start the dev server
npm run build    # typecheck (tsc -b) + production build
npm test         # unit tests for the pure logic (scoring, analysis, qr, offline-store, items)
```

### Open it in a browser for testing

Two ways to run the real app locally (both serve the same React app —
this is **not** a single double-click HTML file):

**Option A — Dev mode** (hot reload, for active testing)

```bash
npm run dev
```

Open the URL Vite prints, usually <http://localhost:5173>.

**Option B — Production build preview** (serves the built `dist/` output)

```bash
npm run build
npm run preview
```

Open the preview URL Vite prints, usually <http://localhost:4173>.

> The build output is a static web app in `dist/` (an `index.html` plus
> hashed JS/CSS in `dist/assets/`). It is served locally by `npm run
> preview` (or any static server) — it is not yet a portable
> open-by-double-click HTML file. If a single-file portable export is
> needed later, that is a separate strategy; don't hand-copy the React
> app into one HTML file.

### Test from your phone (same Wi-Fi)

`npm run dev` serves plain **HTTP** with `host: true`, so it works from any
device on the Wi-Fi without cert warnings. Vite prints both URLs:

```text
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.9:5173/
```

Open the **Network** URL on the phone (find the IP with
`ipconfig getifaddr en0`). If a device cannot connect at all, confirm both are
on the same network and, if the macOS firewall is on, allow incoming
connections for `node` (System Settings → Network → Firewall → Options).

#### Camera scanner on a phone needs HTTPS

The camera works on **this Mac** over `http://localhost:5173` (localhost is a
secure context). But on a **remote phone**, iOS/Android Safari/Chrome only
allow `getUserMedia` over **HTTPS**. For phone camera testing, run:

```bash
npm run dev:https
```

This enables a self-signed cert (`@vitejs/plugin-basic-ssl`). Open
`https://YOUR_MAC_IP:5173` on the phone, accept the one-time
"connection is not private" warning (Show Details → visit this website), then
**Check → Camera QR Scan → Start camera**. Without HTTPS the app still loads on
the phone — only the camera mode is blocked (use QR Paste there instead).

## Install as an app (PWA)

The production build is an installable, offline-capable PWA:

- `public/manifest.webmanifest` (name, icons, standalone display, indigo theme),
- `public/sw.js` — a service worker that caches the app shell. Navigations are
  network-first (always update online) with a cached fallback so the app still
  launches with no Wi-Fi; hashed assets are cache-first.
- Registered from `src/main.tsx` **in production builds only** (dev keeps clean
  HMR with no service worker).

A service worker and "Add to Home Screen" need a **secure context**
(HTTPS or localhost). To try it on a phone:

```bash
npm run build
npm run preview:https   # serves dist/ over HTTPS on the LAN
```

Open `https://YOUR_MAC_IP:4173`, accept the cert warning, then use the browser's
**Add to Home Screen / Install** option. Launched from the home screen it opens
full-screen and works offline (all data is already local). Bump `CACHE_VERSION`
in `public/sw.js` on each release so old caches retire.

## Build status (phase by phase)

| Phase | Scope | Status |
|------:|-------|--------|
| 1 | Route/shell + 7-tab navigation | ✅ done |
| 2 | Data model (`src/lib/types.ts`) | ✅ done |
| 3 | Offline storage (`src/lib/offline-store.ts`) | ✅ done |
| 4 | Assessment setup form | ✅ done |
| 5 | Item + answer-key editor | ✅ done |
| 6 | Learner manager (manual + CSV) | ✅ done |
| 7 | QR answer-sheet generator | ✅ done |
| 8 | Assisted checking + scoring | ✅ done |
| 9 | Results dashboard + CSV export | ✅ done |
| 10 | Analysis dashboard | ✅ done |
| 11 | QR camera scanner (BarcodeDetector + jsQR), strict QR validation, demo data, JSON backup/restore, start guide, items+answer-key CSV import, installable PWA | ✅ done |

Tabs: **Setup · Items · Learners · QR Sheets · Check · Results · Analysis**

The **Check** tab identifies a learner three ways: **Manual select**, **QR
Paste**, or **Camera QR Scan**. All three feed the same strict validator
(`src/lib/qr-parse.ts`), which rejects malformed QRs, QRs for another
assessment, unknown learners, and any QR carrying answer/score-shaped fields.
Camera scanning is identity-only — checking always happens manually below.

## Real-device testing required before DALIguro integration

The build passes typecheck, lint, build, and 55 logic unit tests, but QR
rendering, print behavior, local-storage persistence, CSV download, camera
scanning, and mobile layout can only be verified in a real browser. Work
through [`MANUAL_TESTING_GUIDE.md`](./MANUAL_TESTING_GUIDE.md) and the
checklist below on a real machine and pass them **before** starting any
DALIguro/Supabase integration.

## Browser testing checklist

Fast path: open the app, go to **Setup → Load demo assessment**, then test.

- [ ] **Local dev** — `npm run dev`, open <http://localhost:5173>.
- [ ] **Demo data** — Setup shows the 5-step start guide and *Load demo
      assessment*; loading it creates 1 assessment, 10 items, key, 5 learners,
      versions A & B, and sets it active.
- [ ] **Persistence** — refresh the browser; all data survives (IndexedDB,
      localStorage fallback).
- [ ] **QR sheets** — generate sheets; QR is readable on screen and in print
      preview; the note states the QR identifies the learner only.
- [ ] **Check · Manual** — pick a learner + version, mark answers, save score.
- [ ] **Check · QR Paste** — paste a payload (use the Sheets "QR payload
      preview"); learner + version auto-select; invalid/foreign/unknown QRs are
      rejected with a clear message; a QR with answer-key fields is rejected.
- [ ] **Check · Camera QR Scan** —
  - **Chrome/Android (BarcodeDetector path):** Start camera → state labels
    move Not connected → Camera permission needed → Scanning → QR found;
    learner auto-selects; *Scan another learner* resumes; a cooldown stops one
    QR from firing repeatedly.
  - **Safari / iPhone (jsQR fallback):** Safari has no `BarcodeDetector`, so
    the app shows a "jsQR fallback" badge and decodes frames in JS. Camera
    access needs **HTTPS or localhost** and permission; on a LAN IP over plain
    HTTP iOS will block the camera — use the QR Paste tab there, or serve over
    HTTPS.
- [ ] **Results** — saved score appears with name, LRN, version, %, mastery;
      re-checking the same learner/version updates in place (no duplicate);
      a different version is a separate attempt.
- [ ] **Analysis** — item analysis, common wrong answers, and mastery update
      after results are saved; empty state shows when there are no results.
- [ ] **Backup** — Setup → *Export backup (JSON)*, *Import / restore*, and
      *Clear all data* (double-confirm). Restore replaces device data.

### Security rule (must stay true)

The QR carries **identity only**. Manual checking is the only scoring path —
there is no auto-grading of the answer sheet itself yet (no OMR/OCR).

## Project layout

```
src/
  App.tsx                  # shell + tab navigation (Phase 1)
  lib/
    types.ts               # data model: Assessment, Item, Learner, Result… (Phase 2)
    offline-store.ts       # IndexedDB + localStorage fallback (Phase 3)
    useQrStore.ts          # React hook: load once, auto-persist on change
    ids.ts                 # id + security-token helpers
```

## Security rule

Answer keys live only in local storage and are **never** embedded in QR codes.
The QR payload carries identity only: `assessmentId`, `learnerId`, `lrn`,
`section`, `gradeLevel`, `version`, `securityToken`. The validator in
`src/lib/qr-parse.ts` defensively **rejects** any scanned/pasted QR that
contains answer-key- or score-shaped fields (`answerKey`, `correctAnswer`,
`score`, `itemScores`, …), even though this app never produces one.

## QR camera scanner (current behavior)

The Check tab's **Camera QR Scan** mode:

- opens the rear camera (`facingMode: environment`) with permission handling,
- decodes with the native `BarcodeDetector` when available, otherwise the
  bundled `jsqr` fallback (Safari/iPhone),
- shows explicit states: Not connected → Camera permission needed → Scanning →
  QR found (and Camera unavailable on failure),
- validates the payload against the active assessment and known learners,
- selects the learner + version and reveals the checking grid,
- applies a short cooldown and a *Scan another learner* button so one QR is not
  read repeatedly.

No OMR and no OCR are planned for the spine — checking stays assisted (the
teacher marks answers manually after the learner is identified).

## Bulk import items & answer key (CSV)

The Items tab has **⬆ Import items from CSV** (parser in `src/lib/items-csv.ts`).
Use **Download template** to get the exact header for the active assessment's
versions. Recognised columns (case-insensitive, spaces/underscores ignored):

```text
itemNo, type, question, optionA..optionD, answerVersionA, answerVersionB,
points, competency, difficulty
```

- `answerVersionX` letters populate the per-version answer key only — never the
  QR. Letters outside the choice range are rejected with a row-level note.
- Identification / Fill-in / Short Answer rows can use `correctAnswer` and
  `acceptedAnswers` (comma-separated) instead of version columns.
- Importing **replaces** the active assessment's existing items; keys are set
  for versions enabled in Setup (others are reported so you can enable them).

## Mastery bands

- 85 and above — Mastered
- 75 to 84 — Nearly Mastered
- 60 to 74 — Needs Improvement
- below 60 — Critical Intervention

## Future integration into DALIguro

When this is stable, it can connect to the main app via:

- **Supabase tables** to replace `offline-store.ts` (keep the same load/save API).
- **Gradebook** — push computed scores per component.
- **SF9** — feed quarterly grades.
- **Remediation module** — use analysis output (remediation groups).
- **Subject Teacher dashboard** — surface assessments and results.

The storage layer is isolated behind `loadState` / `saveState` / `clearState`
so swapping local storage for Supabase will not touch the UI components.
