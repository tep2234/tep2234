# DALIguro QR Assessment (Standalone)

A separate, offline-first QR Assessment System for DepEd teachers. Built to be
tested on its own first, then integrated into the main DALIguro app later.

- **Not** connected to the main DALIguro project.
- **No** Supabase. All data is stored locally on the device.
- Stack: Vite + React + TypeScript + Tailwind CSS v4. QR via the `qrcode` package.

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

```bash
npm run dev -- --host 0.0.0.0
```

Find your Mac's IP, then open `http://YOUR_MAC_IP:5173` on the phone:

- System Settings → Wi-Fi → Details → IP Address, or
- Terminal: `ipconfig getifaddr en0`

So if `ipconfig getifaddr en0` prints `192.168.1.20`, open
`http://192.168.1.20:5173` on the phone. Mac and phone must be on the
same network.

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
| 11 | QR camera scanner placeholder | ✅ done |
| 12 | Camera QR Scan (live, identity-only) | ✅ done |

Tabs: **Setup · Items · Learners · QR Sheets · Check · Results · Analysis**

## Real-device testing required before DALIguro integration

The build passes typecheck, lint, build, and 41 logic unit tests, but QR
rendering, print behavior, local-storage persistence, CSV download, and
mobile layout can only be verified in a real browser. Work through
[`MANUAL_TESTING_GUIDE.md`](./MANUAL_TESTING_GUIDE.md) on a real machine
(Chrome/Safari desktop, plus a mobile browser if available) and pass it
**before** starting any DALIguro/Supabase integration.

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
The QR payload carries identity only: `assessmentId`, `learnerId`, `section`,
`gradeLevel`, `version`, `securityToken`.

## QR camera scanner (Phase 12 — live)

The Check tab has a **Scan Mode** selector: Manual Checking, QR Payload Paste,
Camera QR Scan, and two "planned" placeholders (Full Sheet Scan, Batch Scan).
Manual Checking is always the default fallback.

**Connect Camera Scanner** (`src/components/scanner/CameraQrScanner.tsx`)
opens the device camera, decodes a QR continuously using the native
`BarcodeDetector` API where available (Chrome/Android), falling back to
`jsQR` via canvas frame capture otherwise (Safari/iOS). Once a QR is decoded,
the payload is validated (`src/lib/scanner/qr-payload.ts`) before anything is
selected:

- rejects invalid JSON, missing identity fields, wrong assessment, unknown
  learner, or an invalid version,
- rejects outright if the payload carries answer-key-shaped data
  (`answerKey`, `correctAnswer`, `acceptedAnswers`, `score`, `itemScores`, …)
  even though the writer side never puts it there,
- on success, only the learner and version are auto-selected — the camera
  never touches the answer key, item data, learner data, or any saved result.

If a result already exists for the scanned learner/version, the teacher sees
"Existing result found. Review before updating." instead of a silent
overwrite. The teacher still reviews and clicks **Save Score** manually.

### Future full-sheet scan (Phase 2–6, not built yet)

1. **Capture** — grab the answer-sheet image, detect page boundaries and the
   black alignment markers, correct rotation, crop the answer area.
2. **OMR layout map** — generate a scan map from the answer-sheet layout so
   the exact x/y position of every bubble and answer zone is known.
3. **Bubble detection** — detect the selected answer, blank, or multiple
   marks, with a confidence score per item.
4. **Scan review** — show item number, scanned answer, correct answer,
   status, confidence, and a teacher-override control before anything saves.
5. **Batch scanning** — scan many papers in a row, review only flagged items,
   save results, move to the next learner.

Confidence levels once OMR exists: 90%+ auto-accepted, 70–89% review
suggested, below 70% needs review. Perfect accuracy is never promised —
teacher approval is always required before a score is saved.

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
