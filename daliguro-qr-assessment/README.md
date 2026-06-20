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
```

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
| 9 | Results dashboard + CSV export | ⬜ pending |
| 10 | Analysis dashboard | ⬜ pending |
| 11 | QR camera scanner placeholder | ⬜ pending |

Tabs: **Setup · Items · Learners · QR Sheets · Check · Results · Analysis**

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
