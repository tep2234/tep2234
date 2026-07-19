-- Enforce that only VERIFIED (non-anonymous) teachers can create pairing
-- sessions or write durable submission/review records.
--
-- Anonymous Supabase users carry the `authenticated` Postgres role, so table
-- grants and RLS cannot tell them apart from a real teacher. The only
-- trustworthy signal is the `is_anonymous` JWT claim. The prior release added a
-- client-side gate (teacherPrincipalId / UI blocking), but the SECURITY DEFINER
-- RPCs never enforced it — an anonymous user with the public anon key could call
-- them directly and mint teacher-shaped durable records.
--
-- The phone pairing path may legitimately be anonymous, and it only ever
-- UPDATEs the shared `smartscan_sessions` / `smartscan_phone_submissions` tables
-- (via claim/submit). Teacher creation and every durable teacher write is an
-- INSERT (or an UPDATE of a teacher-only table), so guarding those specific
-- operations closes the gap without touching the phone. `smartscan_sessions`
-- INSERT is the linchpin: an anonymous caller cannot create a session, so it has
-- nothing downstream to claim, complete, or resolve.
--
-- Fail-closed policy: the guard permits a write only when there is a verified,
-- non-anonymous request subject (auth.uid()), OR the write runs in a trusted
-- maintenance context identified by an explicit database-role check (owner /
-- superuser — never `authenticated`/`anon`). Missing, empty, or malformed JWT
-- claims are NEVER treated as a verified teacher for application-facing roles.

create or replace function private.assert_verified_teacher_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid;
  v_raw text;
  v_claims jsonb;
  v_is_anonymous boolean := false;
begin
  -- Resolve the request subject with the SAME identity source RLS and the RPCs
  -- authorize with. auth.uid() is derived from the per-request JWT GUC, which a
  -- SECURITY DEFINER RPC does NOT change, so this reflects the real caller even
  -- for INSERTs performed inside a hardened function. A failing/garbled auth
  -- context fails closed rather than defaulting to "trusted".
  begin
    v_uid := auth.uid();
  exception when others then
    raise exception 'verified_teacher_required' using errcode = '42501';
  end;

  if v_uid is not null then
    -- There is a request subject. It must not be anonymous. The anonymity flag
    -- may arrive as the jsonb claims blob or the legacy per-claim GUC.
    v_raw := nullif(current_setting('request.jwt.claims', true), '');
    if v_raw is not null then
      begin
        v_claims := v_raw::jsonb;
      exception when others then
        -- Claims present but unparseable => untrusted token => fail closed.
        raise exception 'verified_teacher_required' using errcode = '42501';
      end;
      v_is_anonymous := coalesce((v_claims ->> 'is_anonymous')::boolean, false);
    else
      begin
        v_is_anonymous := coalesce(
          nullif(current_setting('request.jwt.claim.is_anonymous', true), '')::boolean,
          false
        );
      exception when others then
        raise exception 'verified_teacher_required' using errcode = '42501';
      end;
    end if;
    if v_is_anonymous then
      raise exception 'verified_teacher_required' using errcode = '42501';
    end if;
    -- Verified, non-anonymous subject. The RPC/RLS layers still enforce tenant
    -- and scope; this trigger only rules out anonymous/unauthenticated writers.
    return new;
  end if;

  -- No request subject at all. Do NOT treat "missing claims" as a verified
  -- teacher. Fail closed for application-facing roles; permit only trusted
  -- maintenance contexts (migrations/seeds run as the table owner or a
  -- superuser, never as an application role). This is an explicit role check,
  -- not a "missing claims == trusted" assumption. Checking both current_user
  -- and session_user covers a SECURITY DEFINER call (current_user = owner) that
  -- was nonetheless entered from an application session.
  if current_user in ('authenticated', 'anon')
     or session_user in ('authenticated', 'anon') then
    raise exception 'verified_teacher_required' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function private.assert_verified_teacher_write() from public, anon, authenticated;

-- Session creation (teacher-only INSERT). The phone claim/submit paths UPDATE
-- this table and are intentionally not guarded.
drop trigger if exists smartscan_sessions_require_verified_teacher on public.smartscan_sessions;
create trigger smartscan_sessions_require_verified_teacher
  before insert on public.smartscan_sessions
  for each row execute function private.assert_verified_teacher_write();

-- Assessment scope creation (teacher-only INSERT) — defense in depth for create.
drop trigger if exists smartscan_scopes_require_verified_teacher on public.smartscan_assessment_scopes;
create trigger smartscan_scopes_require_verified_teacher
  before insert on public.smartscan_assessment_scopes
  for each row execute function private.assert_verified_teacher_write();

-- Durable scored submissions: INSERT via commit, UPDATE via resolve. Teacher-only.
drop trigger if exists smartscan_submissions_require_verified_teacher on public.smartscan_scan_submissions;
create trigger smartscan_submissions_require_verified_teacher
  before insert or update on public.smartscan_scan_submissions
  for each row execute function private.assert_verified_teacher_write();

-- Append-only review audit (teacher-only INSERT).
drop trigger if exists smartscan_review_audit_require_verified_teacher on public.smartscan_scan_review_audit;
create trigger smartscan_review_audit_require_verified_teacher
  before insert on public.smartscan_scan_review_audit
  for each row execute function private.assert_verified_teacher_write();

-- Submission review events (teacher-only INSERT, via resolve).
drop trigger if exists smartscan_review_events_require_verified_teacher on public.smartscan_submission_review_events;
create trigger smartscan_review_events_require_verified_teacher
  before insert on public.smartscan_submission_review_events
  for each row execute function private.assert_verified_teacher_write();

-- Checked results ledger (teacher-only INSERT/UPDATE).
drop trigger if exists smartscan_checked_results_require_verified_teacher on public.smartscan_checked_results;
create trigger smartscan_checked_results_require_verified_teacher
  before insert or update on public.smartscan_checked_results
  for each row execute function private.assert_verified_teacher_write();
