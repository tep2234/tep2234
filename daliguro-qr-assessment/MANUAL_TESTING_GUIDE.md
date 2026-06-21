# Manual Testing Guide — DALIguro QR Assessment (Standalone)

Real-device testing for the standalone app. The sandbox build proves
typecheck / lint / build / unit logic, but **QR rendering, print
behavior, local storage persistence, CSV download, and mobile layout
can only be verified in a real browser.** Work through this guide on
your own machine before any DALIguro integration.

> Scope: this is testing only. No new features. No DALIguro/Supabase
> integration. Record findings as you go — bug fixes come after.

---

## 1. How to run locally

```bash
cd daliguro-qr-assessment
npm install
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`).

Optional sanity check before you start:

```bash
npm test          # 41 logic unit tests, should all pass
npm run build     # typecheck + production build
```

---

## 2. Browser testing checklist

Run the full golden path on each browser you have access to:

- [ ] Chrome desktop
- [ ] Safari desktop
- [ ] Mobile browser (iOS Safari or Android Chrome) if available

Note any browser-specific differences (print dialog, QR rendering,
file download, layout reflow).

---

## 3. Golden path test data — Assessment

Create a new assessment (Setup tab → **+ New Assessment**) with:

| Field        | Value                          | Notes                                  |
|--------------|--------------------------------|----------------------------------------|
| Title        | Entrepreneurship Term 1 Quiz 1 |                                        |
| Subject      | Entrepreneurship               | free text                              |
| Grade Level  | 12                             | dropdown (7–12)                        |
| Section      | Aristotle                      | free text                              |
| School Year  | 2026-2027                      |                                        |
| Term         | **First**                      | dropdown is First/Second/Third → "Term 1" = First |
| Component    | Written Work                   |                                        |
| Versions     | A                              | toggle buttons A–D, at least one       |
| Teacher Name | Alvin M. Diaz                  |                                        |

Save, then **Set Active** so the other tabs unlock.

---

## 4. Sample learners CSV

Header the importer expects: `LRN, Full Name, Sex, Grade Level, Section`.

**Use this parser-correct version for the clean golden path.** Two
real rules of the current parser:

1. The parser splits on **commas**, so any name containing a comma
   (e.g. `DELA CRUZ, JUAN`) **must be quoted** or it splits into two
   columns.
2. `Sex` is read as a **single letter** — `M` or `F`. Full words like
   `Male` / `Female` do **not** match and silently fall back to `M`
   (see the edge-case section to test this on purpose).

```csv
LRN,Full Name,Sex,Grade Level,Section
123456789001,"DELA CRUZ, JUAN SANTOS",M,12,Aristotle
123456789002,"REYES, ANA MARIE",F,12,Aristotle
123456789003,"SANTOS, MARK LEO",M,12,Aristotle
123456789004,"VILLANUEVA, KAYE",F,12,Aristotle
123456789005,"GARCIA, PAOLO",M,12,Aristotle
```

Import via **Import CSV file** or the **paste CSV** box on the
Learners tab.

> Keep the original full-word / unquoted version below for the
> edge-case test in section 11 — it is expected to mis-parse, and the
> test is to confirm *how* it behaves so we can decide whether to
> harden the parser later.
>
> ```csv
> LRN,Full Name,Sex,Grade Level,Section
> 123456789001,DELA CRUZ, JUAN SANTOS,Male,Grade 12,Aristotle
> ```

---

## 5. Sample item set (15 items)

Add on the **Items** tab. Mix:

| # | Type             | Points | Competency (sample)                 | Difficulty | Answer key            |
|---|------------------|--------|-------------------------------------|------------|-----------------------|
| 1 | Multiple Choice  | 1      | Identify entrepreneurial traits     | Easy       | A                     |
| 2 | Multiple Choice  | 1      | Distinguish needs vs wants          | Easy       | C                     |
| 3 | Multiple Choice  | 1      | Define market                       | Average    | B                     |
| 4 | Multiple Choice  | 1      | Identify factors of production      | Average    | D                     |
| 5 | Multiple Choice  | 1      | Recognize SWOT components           | Difficult  | A                     |
| 6 | True or False    | 1      | Profit vs revenue                   | Easy       | T                     |
| 7 | True or False    | 1      | Role of an entrepreneur             | Easy       | F                     |
| 8 | True or False    | 1      | Supply and demand basics            | Average    | T                     |
| 9 | Matching Type    | 1      | Match terms to definitions          | Average    | A                     |
| 10| Matching Type    | 1      | Match terms to definitions          | Average    | C                     |
| 11| Identification   | 2      | Name the business document          | Average    | business plan (accepted: businessplan) |
| 12| Identification   | 2      | Name the pricing strategy           | Difficult  | penetration pricing   |
| 13| Problem Solving  | 3      | Compute simple break-even           | Difficult  | manual                |
| 14| Essay            | 5      | Explain a business idea             | Difficult  | manual                |
| 15| Performance Task | 5      | Present a product pitch             | Difficult  | manual                |

For each item, confirm you can set: **points**, **competency tag**,
**difficulty**, and the **answer key** (objective/identification only;
Problem Solving / Essay / Performance Task are scored manually).

Set the **Version A** answer key on the answer-key editor for items
1–12.

---

## 6. Test QR Sheets (QR Sheets tab)

- [ ] One learner sheet generates
- [ ] All learner sheets generate
- [ ] QR code renders (not the fallback placeholder)
- [ ] **QR payload does NOT contain the answer key** — open the debug
      payload preview and confirm only identity fields appear
      (`assessmentId, learnerId, lrn, section, gradeLevel, version,
      securityToken`)
- [ ] Print preview works (browser print dialog opens)
- [ ] Each learner starts on a new page
- [ ] Long names (the quoted comma names above) do not break layout
- [ ] All 15 items still print clearly

---

## 7. Test Checking (Check tab)

Check at least 3 learners covering different profiles:

- [ ] **High score** learner — mostly correct
- [ ] **Mixed score** learner — some correct, some blank
- [ ] **Low score** learner — mostly wrong, with manual-item scores

Confirm:

- [ ] Auto-scoring works for MC / True-False / Matching
- [ ] Accepted answers work for Identification (try `businessplan` for
      item 11 to confirm the accepted-answer match)
- [ ] Manual scores clamp correctly (try entering more than the item's
      points — it should cap at the max)
- [ ] Override on an auto-scored item works and replaces the auto value
- [ ] Result saves
- [ ] Reopening the **same learner + version** loads the existing
      result and **updates it — no duplicate result row**
- [ ] QR-payload paste selects the right learner (paste a payload copied
      from the debug preview in section 6)

---

## 8. Test Results (Results tab)

Confirm:

- [ ] Class average is correct
- [ ] Highest score is correct
- [ ] Lowest score is correct
- [ ] Mastery filter works
- [ ] Sort works
- [ ] Search works
- [ ] CSV export downloads a file
- [ ] CSV opens correctly in a spreadsheet (columns aligned, names with
      commas intact)

---

## 9. Test Analysis (Analysis tab)

Confirm each section renders with real numbers:

- [ ] Item difficulty labels
- [ ] Most-missed items
- [ ] Blank count
- [ ] Common wrong answers
- [ ] Competency mastery (incl. "Untagged Competency" if any item has no tag)
- [ ] Remediation groups (learners bucketed by mastery band with actions)
- [ ] Component summary exports to CSV

---

## 10. Offline behavior

- [ ] Create data (assessment + learners + items + at least one result)
- [ ] Reload the browser — confirm all data remains
- [ ] Turn off Wi-Fi
- [ ] Open the existing app tab — confirm saved data remains and the app
      still works
- [ ] Add or update a result while offline (if possible) — confirm it saves
- [ ] Turn Wi-Fi back on — confirm nothing was lost

---

## 11. Edge cases

Test each and record the actual behavior:

- [ ] No active assessment — tabs that need one show the picker/empty state
- [ ] No learners — QR Sheets and Check show a sensible empty state
- [ ] No items — Check / Analysis behave gracefully
- [ ] Blank answer key — objective items with no key are never marked correct
- [ ] **Duplicate LRN** — import two learners with the same LRN; confirm both
      appear (app does not currently dedupe) and note whether that's a problem
- [ ] **Long learner name** — confirm no layout break on screen and in print
- [ ] **CSV with missing columns** — import a CSV missing `Sex` or `Section`;
      confirm it imports with defaults rather than crashing
- [ ] **Unquoted comma name + full-word Sex** — import the variant CSV from
      section 4; confirm how it mis-parses (name splits / `Female` → `M`)
- [ ] **Item with zero points** — confirm scoring/percentage does not divide
      by zero or show NaN
- [ ] **Delete an item after a result exists** — confirm no crash; check what
      happens to that item in existing results and analysis
- [ ] **Delete a learner after a result exists** — confirm no crash; check the
      result/remediation shows a sensible label for the missing learner

---

## 12. Reporting findings

For each issue, note: **tab**, **steps**, **expected**, **actual**,
**browser/device**. Group them into:

- **Bugs to fix** (incorrect scoring, crashes, data loss, payload leak)
- **UI polish** (layout, print spacing, mobile reflow)
- **Parser hardening** (quoted commas, full-word Sex) — decide whether
  to harden now or document the required CSV format

Once real-device testing passes, the next decision is: fix bugs →
polish UI → or start DALIguro integration.
