-- Append-only teacher decisions for provisional SmartScan submissions.
-- Detector evidence stays immutable in smartscan_scan_submissions; corrections
-- are separate events so grade-affecting history can never be overwritten.

-- A provisional submission has an explicit terminal review lifecycle. The
-- original detector payload remains immutable; only review metadata may move
-- once from needs_review to reviewed or discarded.
alter table public.smartscan_scan_submissions
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_reason text;

alter table public.smartscan_scan_submissions
  drop constraint if exists smartscan_submission_lifecycle;
alter table public.smartscan_scan_submissions
  add constraint smartscan_submission_lifecycle check (
    review_status in ('needs_review', 'reviewed', 'discarded')
    and is_official = false
    and corrected_by_teacher = (review_status = 'reviewed')
    and ((review_status = 'needs_review' and resolved_at is null and resolution_reason is null)
      or (review_status <> 'needs_review' and resolved_at is not null
        and char_length(resolution_reason) between 3 and 1000))
  );

create table if not exists public.smartscan_scan_review_audit (
  id                       uuid primary key default gen_random_uuid(),
  event_id                 uuid not null,
  submission_id            uuid not null references public.smartscan_scan_submissions(id) on delete restrict,
  teacher_user_id          uuid not null references auth.users(id) on delete restrict,
  scan_id                  text not null,
  item_id                  text not null,
  omr_row_number           integer not null,
  item_number              integer not null,
  original_status          text not null,
  original_detected_answer text not null default '',
  corrected_answer         text not null default '',
  correction_source        text not null,
  reason                   text not null,
  payload_fingerprint      text not null,
  recorded_at              timestamptz not null default now(),
  unique (teacher_user_id, event_id),
  constraint smartscan_review_audit_omr_row_number check (omr_row_number between 1 and 80),
  constraint smartscan_review_audit_item_number check (item_number between 1 and 80),
  constraint smartscan_review_audit_status check (
    original_status in ('selected', 'blank', 'unclear', 'multiple', 'unreadable')
  ),
  constraint smartscan_review_audit_original_answer check (
    original_detected_answer in ('', 'A', 'B', 'C', 'D', 'E')
  ),
  constraint smartscan_review_audit_corrected_answer check (
    corrected_answer in ('', 'A', 'B', 'C', 'D', 'E')
  ),
  constraint smartscan_review_audit_source check (
    correction_source in ('review_queue', 'manual_check', 'results', 'scanner')
  ),
  constraint smartscan_review_audit_reason_length check (char_length(reason) between 3 and 1000),
  constraint smartscan_review_audit_item_id_length check (char_length(item_id) between 1 and 200)
);

create index if not exists smartscan_review_audit_submission_idx
  on public.smartscan_scan_review_audit (submission_id, recorded_at, item_number);

alter table public.smartscan_scan_review_audit enable row level security;

drop policy if exists "scan review audit: owner read" on public.smartscan_scan_review_audit;
create policy "scan review audit: owner read" on public.smartscan_scan_review_audit
  for select using (auth.uid() = teacher_user_id);

-- No client role receives INSERT, UPDATE, or DELETE. Authenticated teachers can
-- append only through the validating RPC and can read only their own history.
revoke all on public.smartscan_scan_review_audit from public, anon, authenticated;
grant select on public.smartscan_scan_review_audit to authenticated;

create or replace function public.record_smartscan_review_decisions(
  p_scan_id text,
  p_decisions jsonb
)
returns table (
  audit_id uuid,
  audited_item_number integer,
  recorded_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_submission public.smartscan_scan_submissions%rowtype;
  v_decision jsonb;
  v_original jsonb;
  v_event_id uuid;
  v_item_id text;
  v_omr_row_number integer;
  v_item_number integer;
  v_original_status text;
  v_original_answer text;
  v_corrected_answer text;
  v_source text;
  v_reason text;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_audit_id uuid;
  v_recorded_at timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_scan_id is null or char_length(p_scan_id) not between 8 and 128 then
    raise exception 'invalid_scan_id' using errcode = '22023';
  end if;
  if jsonb_typeof(p_decisions) is distinct from 'array' then
    raise exception 'invalid_review_decisions' using errcode = '22023';
  end if;
  if jsonb_array_length(p_decisions) not between 1 and 80 then
    raise exception 'invalid_review_decisions' using errcode = '22023';
  end if;

  select * into v_submission
  from public.smartscan_scan_submissions
  where teacher_user_id = v_uid and scan_id = p_scan_id
  for update;
  if not found then
    raise exception 'scan_submission_not_found' using errcode = 'P0002';
  end if;

  for v_decision in select value from jsonb_array_elements(p_decisions) loop
    if jsonb_typeof(v_decision) is distinct from 'object' then
      raise exception 'invalid_review_decision_object' using errcode = '22023';
    end if;
    begin
      v_event_id := (v_decision ->> 'eventId')::uuid;
      v_omr_row_number := (v_decision ->> 'omrRowNumber')::integer;
      v_item_number := (v_decision ->> 'itemNumber')::integer;
    exception when others then
      raise exception 'invalid_review_decision_fields' using errcode = '22023';
    end;
    v_item_id := v_decision ->> 'itemId';
    v_original_status := v_decision ->> 'originalStatus';
    v_original_answer := coalesce(v_decision ->> 'originalValue', '');
    v_corrected_answer := coalesce(v_decision ->> 'correctedValue', '');
    v_source := v_decision ->> 'source';
    v_reason := btrim(coalesce(v_decision ->> 'reason', ''));

    if v_omr_row_number not between 1 and v_submission.total_items
       or v_item_number not between 1 and 80
       or v_item_id is null or char_length(v_item_id) not between 1 and 200
       or coalesce(v_original_status, '') not in ('selected', 'blank', 'unclear', 'multiple', 'unreadable')
       or v_original_answer not in ('', 'A', 'B', 'C', 'D', 'E')
       or v_corrected_answer not in ('', 'A', 'B', 'C', 'D', 'E')
       or coalesce(v_source, '') not in ('review_queue', 'manual_check', 'results', 'scanner')
       or char_length(v_reason) not between 3 and 1000 then
      raise exception 'invalid_review_decision_fields' using errcode = '22023';
    end if;

    v_original := v_submission.item_results -> (v_omr_row_number - 1);
    if jsonb_typeof(v_original) is distinct from 'object'
       or (v_original ->> 'item')::integer is distinct from v_omr_row_number
       or (v_original ->> 'status') is distinct from v_original_status
       or coalesce(v_original ->> 'answer', '') is distinct from v_original_answer then
      raise exception 'review_decision_original_mismatch' using errcode = '22023';
    end if;

    v_fingerprint := md5(jsonb_build_object(
      'event_id', v_event_id,
      'submission_id', v_submission.id,
      'scan_id', p_scan_id,
      'item_id', v_item_id,
      'omr_row_number', v_omr_row_number,
      'item_number', v_item_number,
      'original_status', v_original_status,
      'original_answer', v_original_answer,
      'corrected_answer', v_corrected_answer,
      'source', v_source,
      'reason', v_reason
    )::text);

    -- Serialize retries for this event id, then return the original receipt on
    -- an exact replay and reject any attempt to reuse the id with new evidence.
    perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || v_event_id::text));
    select audit.id, audit.payload_fingerprint, audit.recorded_at
      into v_audit_id, v_existing_fingerprint, v_recorded_at
    from public.smartscan_scan_review_audit as audit
    where audit.teacher_user_id = v_uid and audit.event_id = v_event_id;

    if found then
      if v_existing_fingerprint <> v_fingerprint then
        raise exception 'review_event_payload_mismatch' using errcode = '23505';
      end if;
      return query select v_audit_id, v_item_number, v_recorded_at, true;
      continue;
    end if;

    if v_submission.review_status <> 'needs_review' then
      raise exception 'submission_already_resolved' using errcode = '23505';
    end if;

    insert into public.smartscan_scan_review_audit (
      event_id, submission_id, teacher_user_id, scan_id, item_id, omr_row_number, item_number,
      original_status, original_detected_answer, corrected_answer,
      correction_source, reason, payload_fingerprint
    ) values (
      v_event_id, v_submission.id, v_uid, p_scan_id, v_item_id, v_omr_row_number, v_item_number,
      v_original_status, v_original_answer, v_corrected_answer,
      v_source, v_reason, v_fingerprint
    ) returning id, smartscan_scan_review_audit.recorded_at
      into v_audit_id, v_recorded_at;

    return query select v_audit_id, v_item_number, v_recorded_at, false;
  end loop;
end;
$$;

revoke all on function public.record_smartscan_review_decisions(text, jsonb) from public, anon, authenticated;
grant execute on function public.record_smartscan_review_decisions(text, jsonb) to authenticated;

-- One append-only terminal decision per provisional submission. This event is
-- the evidence for the narrow lifecycle metadata update below.
create table if not exists public.smartscan_submission_review_events (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null,
  submission_id       uuid not null references public.smartscan_scan_submissions(id) on delete restrict,
  teacher_user_id     uuid not null references auth.users(id) on delete restrict,
  scan_id             text not null,
  decision            text not null check (decision in ('reviewed', 'discarded')),
  reason              text not null check (char_length(reason) between 3 and 1000),
  payload_fingerprint text not null,
  recorded_at         timestamptz not null default now(),
  unique (teacher_user_id, event_id),
  unique (submission_id)
);

alter table public.smartscan_submission_review_events enable row level security;
drop policy if exists "submission review events: owner read" on public.smartscan_submission_review_events;
create policy "submission review events: owner read" on public.smartscan_submission_review_events
  for select using (auth.uid() = teacher_user_id);
revoke all on public.smartscan_submission_review_events from public, anon, authenticated;
grant select on public.smartscan_submission_review_events to authenticated;

create or replace function public.resolve_smartscan_submission(
  p_scan_id text,
  p_resolution jsonb
)
returns table (
  resolution_id uuid,
  review_status text,
  resolved_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_submission public.smartscan_scan_submissions%rowtype;
  v_event_id uuid;
  v_decision text;
  v_reason text;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_resolution_id uuid;
  v_recorded_at timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_scan_id is null or char_length(p_scan_id) not between 8 and 128
     or jsonb_typeof(p_resolution) is distinct from 'object' then
    raise exception 'invalid_submission_resolution' using errcode = '22023';
  end if;
  begin
    v_event_id := (p_resolution ->> 'eventId')::uuid;
  exception when others then
    raise exception 'invalid_submission_resolution' using errcode = '22023';
  end;
  v_decision := p_resolution ->> 'decision';
  v_reason := btrim(coalesce(p_resolution ->> 'reason', ''));
  if coalesce(v_decision, '') not in ('reviewed', 'discarded')
     or char_length(v_reason) not between 3 and 1000 then
    raise exception 'invalid_submission_resolution' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':resolution:' || p_scan_id, 0));
  select * into v_submission
  from public.smartscan_scan_submissions
  where teacher_user_id = v_uid and scan_id = p_scan_id
  for update;
  if not found then
    raise exception 'scan_submission_not_found' using errcode = 'P0002';
  end if;

  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'event_id', v_event_id,
    'submission_id', v_submission.id,
    'scan_id', p_scan_id,
    'decision', v_decision,
    'reason', v_reason
  )::text, 'UTF8')), 'hex');

  select event.id, event.payload_fingerprint, event.recorded_at
    into v_resolution_id, v_existing_fingerprint, v_recorded_at
  from public.smartscan_submission_review_events as event
  where event.teacher_user_id = v_uid and event.event_id = v_event_id;
  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception 'resolution_event_payload_mismatch' using errcode = '23505';
    end if;
    return query select v_resolution_id, v_submission.review_status, v_recorded_at, true;
    return;
  end if;

  if v_submission.review_status <> 'needs_review' then
    raise exception 'submission_already_resolved' using errcode = '23505';
  end if;

  -- Every uncertain detector row, including low-confidence selected/blank
  -- rows, requires an append-only item decision before the submission can be
  -- reviewed. Discard is allowed without corrections because it never scores.
  if v_decision = 'reviewed' and exists (
    select 1
    from jsonb_array_elements(v_submission.item_results) with ordinality as item(value, row_number)
    where (
      item.value ->> 'status' in ('unclear', 'multiple', 'unreadable')
      or exists (
        select 1 from jsonb_array_elements(v_submission.low_confidence_items) as low(value)
        where jsonb_typeof(low.value) = 'number'
          and (low.value #>> '{}')::integer = item.row_number
      )
    ) and not exists (
      select 1 from public.smartscan_scan_review_audit as audit
      where audit.submission_id = v_submission.id
        and audit.omr_row_number = item.row_number
    )
  ) then
    raise exception 'unresolved_items_require_review_decisions' using errcode = '22023';
  end if;

  insert into public.smartscan_submission_review_events (
    event_id, submission_id, teacher_user_id, scan_id, decision, reason, payload_fingerprint
  ) values (
    v_event_id, v_submission.id, v_uid, p_scan_id, v_decision, v_reason, v_fingerprint
  ) returning id, smartscan_submission_review_events.recorded_at
    into v_resolution_id, v_recorded_at;

  update public.smartscan_scan_submissions
  set review_status = v_decision,
      corrected_by_teacher = (v_decision = 'reviewed'),
      is_official = false,
      resolved_at = v_recorded_at,
      resolution_reason = v_reason
  where id = v_submission.id;

  return query select v_resolution_id, v_decision, v_recorded_at, false;
end;
$$;

revoke all on function public.resolve_smartscan_submission(text, jsonb) from public, anon, authenticated;
grant execute on function public.resolve_smartscan_submission(text, jsonb) to authenticated;
