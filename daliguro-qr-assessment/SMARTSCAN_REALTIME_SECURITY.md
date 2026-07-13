# SmartScan Realtime security architecture

This document defines the security boundary for phone-to-PC scanning. The
database is the system of record. Supabase Broadcast and Presence are not used
for scan transport, pairing, or scoring.

## Data-flow map

| # | Question | Enforced design |
|---|---|---|
| 1 | Who creates the session? | A signed-in teacher calls `create_smartscan_pairing_session`. The RPC derives `teacher_user_id` from `auth.uid()` and the tenant from trusted JWT `app_metadata.school_profile_id`. |
| 2 | What identifier does the phone receive? | A random database session UUID in the one-time QR URL. The identifier is not an authorization credential. |
| 3 | What secret does the phone receive? | A 256-bit random, single-use pairing secret. The database stores only its SHA-256 hash in the non-exposed `private` schema. |
| 4 | Where is the token stored? | The raw pairing secret exists only in the initial QR URL and memory. It is never written to local/session storage. After exchange, the phone removes the query string with `history.replaceState`. A short-lived scoped capability is kept in `sessionStorage` for same-tab recovery. |
| 5 | How does the phone authenticate? | The phone presents the session UUID and one-time secret to the narrowly granted claim RPC. The RPC locks the session and secret rows, verifies status and expiry, consumes the secret, and returns a new short-lived capability. |
| 6 | How does the PC subscribe? | The authenticated PC subscribes only to Postgres Changes on `smartscan_phone_submissions`, filtered by teacher and assessment. Table RLS is evaluated using the teacher JWT. The PC also performs an owned initial fetch after mount/reconnect. |
| 7 | How does the phone publish? | It calls `submit_smartscan_phone_scan` with the scoped capability, session ID, unique message ID, strict sequence, issued timestamp, exact JSON bytes, and SHA-256 payload digest. It cannot write any table directly. |
| 8 | How does the server validate ownership? | Session owner, tenant, assessment, roster, allowed versions, item count, lifecycle, capability hash, expiry, timestamp window, message ID, sequence, and digest are checked inside `SECURITY DEFINER` RPCs with an empty `search_path`. |
| 9 | How are database rows protected? | Session, inbox, provisional result, correction, and resolution rows use forced/owner RLS where applicable. Anonymous and authenticated direct writes are revoked. Secret and roster tables are in `private`; SmartScan access is also revoked from `service_role`. |
| 10 | How does a session expire? | Pairing and capability expiry are server timestamps capped at 15 minutes. End-session atomically marks the session ended and revokes both pairing and capability credentials. Expired or ended sessions reject submit and status calls. |
| 11 | How are reconnects authorized? | A phone may reuse only its unexpired scoped capability from same-tab `sessionStorage`. The PC restores state through an RLS-owned database fetch. No channel message is trusted as recovery state. |
| 12 | How are duplicates/replays rejected? | `(session_id, message_id)` and `(session_id, sequence_number)` are unique. The secret row is locked while enforcing the exact next sequence. Only a byte-identical retry of the same message ID, sequence, timestamp, and digest returns the original durable receipt. |

## Authoritative processing path

1. The phone validates a capture locally and creates an offline outbox entry.
2. The capability RPC validates and persists an immutable inbox row.
3. Only after receiving the database inbox receipt does the phone remove its
   local outbox entry.
4. The authenticated PC fetches or receives the RLS-filtered inbox row.
5. The PC validates and previews scoring, then calls the certified provisional
   result receipt RPC.
6. The inbox becomes `processed` only when its teacher, session, message, and
   result receipt all match. A validation rejection is a specific terminal
   outcome; transient processing failures leave the inbox retriable.
7. The phone polls only its own capability-scoped status. The response contains
   the minimum receipt/score status needed by that phone.

Realtime delivery is an optimization. Missing, duplicate, or delayed delivery
cannot create or replace an authoritative grade.

## Disconnect and reconnect contract

| Scenario | Expected behavior |
|---|---|
| Phone disconnects before inbox persistence | Capture remains in the local outbox and retries with the same message metadata. |
| Phone loses the inbox acknowledgement | Exact retry returns the original inbox receipt without a second row. |
| PC disconnects before processing | Durable inbox remains `received`; initial fetch processes it after reconnect. |
| PC disconnects after result persistence | Receipt RPC and terminal completion are idempotent; recovery cannot duplicate the result. |
| Phone reconnects with active capability | Same-tab recovery may submit the next sequence and poll its scoped messages. |
| Phone reconnects with expired/revoked capability | Server rejects it; the UI requires a new teacher-issued QR. |
| Pairing token is reused | The consumed timestamp causes a uniform rejection. |
| Two phones claim one QR concurrently | Row locking permits exactly one successful claim. |
| Two submissions race for one sequence | Row locking and uniqueness permit exactly one new inbox row. |
| Offline replay arrives after expiry/closure | Server rejects it; it cannot enter the authoritative inbox. |
| Delayed Realtime event arrives after closure | The PC processes only the referenced current database row; no Broadcast event exists to trust. |

## Trust and data-minimization rules

- Channel names are random correlation labels, never authorization controls.
- No raw pairing secret, capability, access token, service key, teacher profile,
  or unrelated learner/assessment record is sent through Realtime.
- The one-time QR includes only the phone route, session UUID, and initial
  pairing secret. The secret is removed immediately after claim.
- Browser diagnostics use the existing redacted scanner diagnostic boundary.
- Client errors are mapped to safe, non-enumerating messages; internal database
  errors and stack traces are not shown to the phone.
- Ownership and tenant fields come from authenticated server state, never from
  phone input.

## Migration and recovery

The migration backfills legacy nullable tenant IDs deterministically, creates
assessment scopes, moves pairing hashes into `private`, and preserves existing
sessions and checked results. It is intended to run transactionally. If the
migration fails before commit, PostgreSQL rollback restores the prior public
token-hash column and removes the new objects. The certification harness proves
that a rolled-back database can then apply the migration successfully.

Production rollout must still use a backup, a maintenance window, migration
monitoring, and the normal change-approval process. This repository test does
not access or modify Production.
