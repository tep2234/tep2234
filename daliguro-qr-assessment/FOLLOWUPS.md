# Follow-ups

## SmartScan realtime sync

### 1. Lazy-load Supabase client for offline SmartScan users

Reason:
The SmartScan realtime sync adds `@supabase/supabase-js`, increasing the initial
JavaScript bundle size (~497 kB → ~784 kB).

Goal:
Load Supabase only when live sync is configured and opened.

Acceptance:

* Offline SmartScan users do not load Supabase JS on initial page load.
* `getSupabaseClient()` dynamically imports Supabase only when `VITE_SUPABASE_URL`
  and `VITE_SUPABASE_ANON_KEY` exist.
* Offline mode remains usable without env vars.
* Live SmartScan sync still works.
* lint, typecheck, tests, and build pass.

### 2. Add persistent offline queue for phone SmartScan submissions

Reason:
The phone page currently reports upload failure and allows retry. It needs
durable offline storage for temporary network loss.

Goal:
Allow phone scans to queue locally and auto-sync when online.

Acceptance:

* Phone can save detected scan result locally when offline.
* Queued results survive refresh.
* Results auto-upload when online.
* User sees queued, syncing, and synced states.
* Duplicate protection still works through the existing upsert rule.
* Wrong-assessment and expired-session guards still apply.
* lint, typecheck, tests, and build pass.
