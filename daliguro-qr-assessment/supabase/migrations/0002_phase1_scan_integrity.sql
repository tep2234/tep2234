-- Phase 1: immutable, provisional phone-scan submissions.
--
-- Phone captures must never overwrite the canonical learner result. They are
-- inserted once into this pending ledger, receive a scan-specific receipt, and
-- remain non-official until a later teacher-review/promotion workflow makes an
-- explicit keep/replace decision.

-- Retire the pre-ledger direct-write path without deleting legacy records.
-- Stale clients fail closed instead of bypassing the transactional receipt RPC.
revoke insert, update, delete on public.smartscan_checked_results from anon, authenticated;
grant select on public.smartscan_checked_results to authenticated;

create table if not exists public.smartscan_scan_submissions (
  id                    uuid primary key default gen_random_uuid(),
  scan_id               text not null,
  teacher_user_id       uuid not null references auth.users(id) on delete cascade,
  school_id             uuid,
  assessment_id         text not null,
  learner_id            text not null,
  learner_name          text,
  version               text not null,
  score                 numeric not null,
  total_items           integer not null,
  percentage            numeric not null,
  answer_map            jsonb not null,
  item_results          jsonb not null,
  qr_payload            jsonb not null,
  scan_session_id       uuid not null references public.smartscan_sessions(id) on delete restrict,
  scan_source           text not null default 'phone_camera',
  scan_confidence       numeric,
  low_confidence_items  jsonb not null default '[]'::jsonb,
  corrected_by_teacher  boolean not null default false,
  review_status         text not null default 'needs_review',
  is_official           boolean not null default false,
  payload_fingerprint   text not null,
  captured_at           timestamptz not null,
  checked_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (teacher_user_id, scan_id),
  constraint smartscan_submission_scan_id_length
    check (char_length(scan_id) between 8 and 128),
  constraint smartscan_submission_version
    check (version in ('A', 'B', 'C', 'D')),
  constraint smartscan_submission_score_range
    check (score >= 0 and total_items between 1 and 80),
  constraint smartscan_submission_percentage_range
    check (percentage between 0 and 100),
  constraint smartscan_submission_confidence_range
    check (scan_confidence is null or scan_confidence between 0 and 1),
  constraint smartscan_submission_lifecycle
    check (
      review_status = 'needs_review'
      and is_official = false
      and corrected_by_teacher = false
    )
);

-- One unresolved capture per learner/version. A second sheet cannot silently
-- replace the first; the future promotion workflow must resolve the pending
-- record before another capture is accepted.
create unique index if not exists smartscan_submission_pending_learner_uidx
  on public.smartscan_scan_submissions
    (teacher_user_id, assessment_id, learner_id, version)
  where review_status = 'needs_review';

create index if not exists smartscan_submission_lookup_idx
  on public.smartscan_scan_submissions (teacher_user_id, assessment_id, created_at desc);

create index if not exists smartscan_sessions_expiry_idx
  on public.smartscan_sessions (expires_at)
  where status in ('active', 'paired');

alter table public.smartscan_scan_submissions enable row level security;

drop policy if exists "scan submissions: owner read" on public.smartscan_scan_submissions;
create policy "scan submissions: owner read" on public.smartscan_scan_submissions
  for select using (auth.uid() = teacher_user_id);

-- Direct client writes/updates/deletes are deliberately not granted. The RPC
-- below is the sole insert boundary and enforces session ownership, expiry,
-- lifecycle, exact replay, and duplicate decisions transactionally.
revoke all on public.smartscan_scan_submissions from public, anon, authenticated;
grant select on public.smartscan_scan_submissions to authenticated;

create or replace function public.commit_smartscan_submission(p_submission jsonb)
returns table (
  receipt_id uuid,
  committed_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_teacher_id uuid;
  v_session_id uuid;
  v_scan_id text := p_submission ->> 'scan_id';
  v_assessment_id text := p_submission ->> 'assessment_id';
  v_learner_id text := p_submission ->> 'learner_id';
  v_version text := p_submission #>> '{qr_payload,version}';
  v_total_items integer;
  v_score numeric;
  v_percentage numeric;
  v_confidence numeric;
  v_captured_at timestamptz;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_receipt_id uuid;
  v_committed_at timestamptz;
  v_session public.smartscan_sessions%rowtype;
  v_item jsonb;
  v_item_index integer := 0;
  v_item_number integer;
  v_item_status text;
  v_item_answer text;
  v_item_confidence numeric;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_submission is null or jsonb_typeof(p_submission) <> 'object' then
    raise exception 'malformed_submission' using errcode = '22023';
  end if;

  begin
    v_teacher_id := (p_submission ->> 'teacher_user_id')::uuid;
    v_session_id := (p_submission ->> 'scan_session_id')::uuid;
    v_total_items := (p_submission ->> 'total_items')::integer;
    v_score := (p_submission ->> 'score')::numeric;
    v_percentage := (p_submission ->> 'percentage')::numeric;
    v_confidence := nullif(p_submission ->> 'scan_confidence', '')::numeric;
    v_captured_at := to_timestamp(
      ((p_submission #>> '{qr_payload,capturedAt}')::double precision) / 1000.0
    );
  exception when others then
    raise exception 'malformed_submission_fields' using errcode = '22023';
  end;

  if v_teacher_id <> v_uid then
    raise exception 'teacher_identity_mismatch' using errcode = '42501';
  end if;
  if v_scan_id is null or char_length(v_scan_id) not between 8 and 128 then
    raise exception 'invalid_scan_id' using errcode = '22023';
  end if;
  if v_assessment_id is null or v_assessment_id = '' or v_learner_id is null or v_learner_id = '' then
    raise exception 'missing_assessment_or_learner' using errcode = '22023';
  end if;
  if char_length(v_assessment_id) > 200 or char_length(v_learner_id) > 200
     or char_length(coalesce(p_submission ->> 'learner_name', '')) > 300
     or char_length(coalesce(p_submission ->> 'section_name', '')) > 300
     or char_length(coalesce(p_submission ->> 'subject_name', '')) > 300 then
    raise exception 'submission_identity_too_long' using errcode = '22023';
  end if;
  if coalesce(nullif(p_submission ->> 'scan_source', ''), 'phone_camera') <> 'phone_camera' then
    raise exception 'invalid_scan_source' using errcode = '22023';
  end if;
  if v_version not in ('A', 'B', 'C', 'D') then
    raise exception 'invalid_version' using errcode = '22023';
  end if;
  if p_submission #>> '{qr_payload,assessmentId}' is distinct from v_assessment_id
     or p_submission #>> '{qr_payload,learnerId}' is distinct from v_learner_id
     or p_submission #>> '{qr_payload,sessionId}' is distinct from v_session_id::text then
    raise exception 'qr_identity_mismatch' using errcode = '22023';
  end if;
  if (p_submission #>> '{qr_payload,itemCount}')::integer is distinct from v_total_items then
    raise exception 'qr_item_count_mismatch' using errcode = '22023';
  end if;
  if v_total_items not between 1 and 80 then
    raise exception 'invalid_item_coverage' using errcode = '22023';
  end if;
  if jsonb_typeof(p_submission -> 'answer_map') is distinct from 'object' then
    raise exception 'invalid_item_coverage' using errcode = '22023';
  end if;
  if (
    select count(*)
    from jsonb_object_keys(p_submission -> 'answer_map') as answer_key
  ) <> v_total_items then
    raise exception 'invalid_item_coverage' using errcode = '22023';
  end if;
  if jsonb_typeof(p_submission -> 'item_results') is distinct from 'array' then
    raise exception 'invalid_item_coverage' using errcode = '22023';
  end if;
  if jsonb_array_length(p_submission -> 'item_results') <> v_total_items then
    raise exception 'invalid_item_coverage' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_submission -> 'low_confidence_items', '[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(p_submission -> 'low_confidence_items', '[]'::jsonb)) > v_total_items
     or exists (
       select 1
       from jsonb_array_elements(coalesce(p_submission -> 'low_confidence_items', '[]'::jsonb)) as low(value)
       where jsonb_typeof(low.value) <> 'number'
          or (low.value #>> '{}') !~ '^[0-9]+$'
          or (low.value #>> '{}')::integer not between 1 and v_total_items
     )
     or (
       select count(distinct low.value)
       from jsonb_array_elements(coalesce(p_submission -> 'low_confidence_items', '[]'::jsonb)) as low(value)
     ) <> jsonb_array_length(coalesce(p_submission -> 'low_confidence_items', '[]'::jsonb)) then
    raise exception 'invalid_low_confidence_items' using errcode = '22023';
  end if;

  -- Runtime JSON contract, including the Phase 1 `unreadable` state. Older
  -- selected/blank/unclear/multiple rows remain valid without newer evidence
  -- fields; unreadable rows must name at least one affected choice.
  for v_item in select value from jsonb_array_elements(p_submission -> 'item_results') loop
    v_item_index := v_item_index + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_item_result_object' using errcode = '22023';
    end if;
    begin
      v_item_number := (v_item ->> 'item')::integer;
      v_item_status := v_item ->> 'status';
      v_item_answer := coalesce(v_item ->> 'answer', '');
      v_item_confidence := (v_item ->> 'confidence')::numeric;
    exception when others then
      raise exception 'invalid_item_result_fields' using errcode = '22023';
    end;
    if v_item_number is distinct from v_item_index
       or coalesce(v_item_status, '') not in ('selected', 'blank', 'unclear', 'multiple', 'unreadable')
       or coalesce(v_item_answer, '') not in ('', 'A', 'B', 'C', 'D', 'E')
       or v_item_confidence is null
       or v_item_confidence not between 0 and 1
       or (p_submission -> 'answer_map' ->> v_item_index::text) is distinct from v_item_answer then
      raise exception 'inconsistent_item_result' using errcode = '22023';
    end if;
    if (v_item_status = 'selected' and v_item_answer = '')
       or (v_item_status in ('blank', 'multiple') and v_item_answer <> '') then
      raise exception 'inconsistent_item_status_answer' using errcode = '22023';
    end if;
    if v_item ? 'fill' then
      if jsonb_typeof(v_item -> 'fill') is distinct from 'array'
         or jsonb_array_length(v_item -> 'fill') > 5 then
        raise exception 'invalid_item_fill_evidence' using errcode = '22023';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(v_item -> 'fill') as fill_value(value)
        where case
          when jsonb_typeof(value) = 'number'
            then (value #>> '{}')::numeric between 0 and 1
          else false
        end = false
      ) then
        raise exception 'invalid_item_fill_evidence' using errcode = '22023';
      end if;
    end if;
    if v_item_status = 'unreadable' then
      if jsonb_typeof(v_item -> 'unreadableChoices') is distinct from 'array' then
        raise exception 'unreadable_item_missing_choice_evidence' using errcode = '22023';
      end if;
      if jsonb_array_length(v_item -> 'unreadableChoices') not between 1 and 5 then
        raise exception 'unreadable_item_missing_choice_evidence' using errcode = '22023';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(v_item -> 'unreadableChoices') as unreadable_choice(value)
        where jsonb_typeof(value) <> 'number'
           or value::text !~ '^[0-4]$'
      ) or (
        select count(distinct value)
        from jsonb_array_elements(v_item -> 'unreadableChoices') as unreadable_choice(value)
      ) <> jsonb_array_length(v_item -> 'unreadableChoices') then
        raise exception 'invalid_unreadable_choice_evidence' using errcode = '22023';
      end if;
    end if;
  end loop;
  if v_score < 0 or v_percentage not between 0 and 100
     or (v_confidence is not null and v_confidence not between 0 and 1) then
    raise exception 'invalid_score_or_confidence' using errcode = '22023';
  end if;
  if coalesce(p_submission ->> 'review_status', '') <> 'needs_review'
     or coalesce((p_submission ->> 'is_official')::boolean, true)
     or coalesce((p_submission ->> 'corrected_by_teacher')::boolean, true) then
    raise exception 'invalid_provisional_lifecycle' using errcode = '22023';
  end if;

  -- Fingerprint every immutable client field that can affect identity,
  -- evidence, or scoring. SHA-256 avoids treating an MD5 collision as an
  -- idempotent replay at a grade-bearing boundary.
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'scan_id', v_scan_id,
    'session_id', v_session_id,
    'teacher_id', v_teacher_id,
    'school_id', nullif(p_submission ->> 'school_id', ''),
    'assessment_id', v_assessment_id,
    'learner_id', v_learner_id,
    'learner_name', nullif(p_submission ->> 'learner_name', ''),
    'section_name', nullif(p_submission ->> 'section_name', ''),
    'subject_name', nullif(p_submission ->> 'subject_name', ''),
    'version', v_version,
    'answer_map', p_submission -> 'answer_map',
    'item_results', p_submission -> 'item_results',
    'qr_payload', p_submission -> 'qr_payload',
    'score', v_score,
    'total_items', v_total_items,
    'percentage', v_percentage,
    'scan_source', coalesce(nullif(p_submission ->> 'scan_source', ''), 'phone_camera'),
    'scan_confidence', v_confidence,
    'low_confidence_items', coalesce(p_submission -> 'low_confidence_items', '[]'::jsonb),
    'captured_at', v_captured_at
  )::text, 'UTF8')), 'hex');

  -- Serialize identical scan ids. Exact retries recover their original
  -- receipt even if the pairing session expired after the database committed
  -- but before the phone received its acknowledgement.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':scan:' || v_scan_id, 0));

  select id, payload_fingerprint, created_at
    into v_receipt_id, v_existing_fingerprint, v_committed_at
  from public.smartscan_scan_submissions
  where teacher_user_id = v_uid and scan_id = v_scan_id;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception 'scan_id_payload_mismatch' using errcode = '23505';
    end if;
    return query select v_receipt_id, v_committed_at, true;
    return;
  end if;

  select * into v_session
  from public.smartscan_sessions
  where id = v_session_id
  for share;
  if not found
     or v_session.teacher_user_id <> v_uid
     or v_session.assessment_id <> v_assessment_id then
    raise exception 'invalid_pairing_session' using errcode = '42501';
  end if;
  if v_session.status = 'ended' then
    raise exception 'pairing_session_ended' using errcode = '22023';
  end if;
  -- A phone may have captured while paired and temporarily lost internet.
  -- Accept that queued capture for at most 24 hours after expiry, but never a
  -- frame captured after the session's own validity window.
  if now() > v_session.expires_at + interval '24 hours' then
    raise exception 'offline_catchup_window_expired' using errcode = '22023';
  end if;
  if v_captured_at < v_session.created_at - interval '1 minute'
     or v_captured_at > v_session.expires_at + interval '5 minutes'
     or v_captured_at > now() + interval '5 minutes' then
    raise exception 'invalid_capture_time' using errcode = '22023';
  end if;

  -- Different scan ids for one learner/version must also serialize. Without
  -- this lock, two concurrent transactions can both pass the pending check
  -- and race at the partial unique index with an opaque database error.
  perform pg_advisory_xact_lock(hashtextextended(
    v_uid::text || ':learner:' || v_assessment_id || ':' || v_learner_id || ':' || v_version,
    0
  ));

  if exists (
    select 1 from public.smartscan_scan_submissions
    where teacher_user_id = v_uid
      and assessment_id = v_assessment_id
      and learner_id = v_learner_id
      and version = v_version
      and review_status = 'needs_review'
  ) then
    raise exception 'duplicate_submission_requires_teacher_decision' using errcode = '23505';
  end if;

  insert into public.smartscan_scan_submissions (
    scan_id, teacher_user_id, school_id, assessment_id, learner_id,
    learner_name, version, score, total_items, percentage, answer_map,
    item_results, qr_payload, scan_session_id, scan_source, scan_confidence,
    low_confidence_items, corrected_by_teacher, review_status, is_official,
    payload_fingerprint, captured_at
  ) values (
    v_scan_id,
    v_uid,
    nullif(p_submission ->> 'school_id', '')::uuid,
    v_assessment_id,
    v_learner_id,
    nullif(p_submission ->> 'learner_name', ''),
    v_version,
    v_score,
    v_total_items,
    v_percentage,
    p_submission -> 'answer_map',
    p_submission -> 'item_results',
    p_submission -> 'qr_payload',
    v_session_id,
    'phone_camera',
    v_confidence,
    coalesce(p_submission -> 'low_confidence_items', '[]'::jsonb),
    false,
    'needs_review',
    false,
    v_fingerprint,
    v_captured_at
  )
  returning id, created_at into v_receipt_id, v_committed_at;

  return query select v_receipt_id, v_committed_at, false;
end;
$$;

revoke all on function public.commit_smartscan_submission(jsonb) from public, anon, authenticated;
grant execute on function public.commit_smartscan_submission(jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'smartscan_scan_submissions'
  ) then
    alter publication supabase_realtime add table public.smartscan_scan_submissions;
  end if;
end $$;
