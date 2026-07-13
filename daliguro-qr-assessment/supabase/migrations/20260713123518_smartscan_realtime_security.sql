-- SmartScan Realtime security boundary.
--
-- Anonymous Broadcast is deliberately not part of this architecture. A phone
-- exchanges the one-time QR secret through a narrowly granted RPC, receives a
-- short-lived capability, and writes immutable inbox rows through another RPC.
-- The authenticated PC receives RLS-filtered Postgres Changes and remains the
-- only client allowed to invoke the certified scoring/receipt boundary.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists public.smartscan_assessment_scopes (
  id uuid primary key default gen_random_uuid(),
  teacher_user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null,
  assessment_id text not null,
  created_at timestamptz not null default now(),
  unique (teacher_user_id, assessment_id),
  constraint smartscan_assessment_scope_id_length
    check (char_length(assessment_id) between 1 and 200)
);

alter table public.smartscan_assessment_scopes enable row level security;
alter table public.smartscan_assessment_scopes force row level security;
revoke all on public.smartscan_assessment_scopes from public, anon, authenticated;
grant select on public.smartscan_assessment_scopes to authenticated;
create policy "assessment scopes: owner read"
  on public.smartscan_assessment_scopes
  for select
  to authenticated
  using ((select auth.uid()) = teacher_user_id);

alter table public.smartscan_sessions
  add column if not exists assessment_scope_id uuid,
  add column if not exists allowed_versions text[] not null default array['A','B','C','D']::text[],
  add column if not exists item_count integer not null default 80;

update public.smartscan_sessions
set school_id = teacher_user_id
where school_id is null;

insert into public.smartscan_assessment_scopes (
  teacher_user_id,
  school_id,
  assessment_id
)
select distinct teacher_user_id, school_id, assessment_id
from public.smartscan_sessions
on conflict (teacher_user_id, assessment_id) do nothing;

update public.smartscan_sessions as session_row
set assessment_scope_id = scope_row.id
from public.smartscan_assessment_scopes as scope_row
where session_row.assessment_scope_id is null
  and scope_row.teacher_user_id = session_row.teacher_user_id
  and scope_row.assessment_id = session_row.assessment_id;

alter table public.smartscan_sessions
  alter column school_id set not null,
  alter column assessment_scope_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'smartscan_sessions_assessment_scope_fkey'
      and conrelid = 'public.smartscan_sessions'::regclass
  ) then
    alter table public.smartscan_sessions
      add constraint smartscan_sessions_assessment_scope_fkey
      foreign key (assessment_scope_id)
      references public.smartscan_assessment_scopes(id)
      on delete restrict;
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'smartscan_sessions_item_count'
      and conrelid = 'public.smartscan_sessions'::regclass
  ) then
    alter table public.smartscan_sessions
      add constraint smartscan_sessions_item_count
      check (item_count between 1 and 80);
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'smartscan_sessions_allowed_versions'
      and conrelid = 'public.smartscan_sessions'::regclass
  ) then
    alter table public.smartscan_sessions
      add constraint smartscan_sessions_allowed_versions
      check (
        cardinality(allowed_versions) between 1 and 4
        and allowed_versions <@ array['A','B','C','D']::text[]
      );
  end if;
end
$$;

create table if not exists private.smartscan_session_secrets (
  session_id uuid primary key references public.smartscan_sessions(id) on delete cascade,
  pairing_token_hash text not null,
  pairing_consumed_at timestamptz,
  pairing_revoked_at timestamptz,
  capability_hash text,
  capability_issued_at timestamptz,
  capability_expires_at timestamptz,
  capability_revoked_at timestamptz,
  last_sequence bigint not null default 0,
  constraint smartscan_pairing_hash_shape
    check (pairing_token_hash ~ '^[0-9a-f]{64}$'),
  constraint smartscan_capability_hash_shape
    check (capability_hash is null or capability_hash ~ '^[0-9a-f]{64}$'),
  constraint smartscan_sequence_nonnegative
    check (last_sequence >= 0)
);

insert into private.smartscan_session_secrets (session_id, pairing_token_hash)
select id, lower(session_token_hash)
from public.smartscan_sessions
on conflict (session_id) do nothing;

alter table public.smartscan_sessions
  drop column session_token_hash;

create table if not exists private.smartscan_session_learners (
  session_id uuid not null references public.smartscan_sessions(id) on delete cascade,
  learner_id text not null,
  primary key (session_id, learner_id),
  constraint smartscan_session_learner_length
    check (char_length(learner_id) between 1 and 200)
);

create table if not exists public.smartscan_phone_submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.smartscan_sessions(id) on delete restrict,
  teacher_user_id uuid not null references auth.users(id) on delete restrict,
  school_id uuid not null,
  assessment_id text not null,
  message_id text not null,
  sequence_number bigint not null,
  issued_at timestamptz not null,
  payload jsonb not null,
  payload_digest text not null,
  status text not null default 'received',
  result_receipt_id uuid references public.smartscan_scan_submissions(id) on delete restrict,
  score_summary jsonb,
  rejection_code text,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (session_id, message_id),
  unique (session_id, sequence_number),
  constraint smartscan_phone_message_id_length
    check (char_length(message_id) between 8 and 128),
  constraint smartscan_phone_sequence_positive
    check (sequence_number > 0),
  constraint smartscan_phone_digest_shape
    check (payload_digest ~ '^[0-9a-f]{64}$'),
  constraint smartscan_phone_status
    check (status in ('received', 'processed', 'rejected')),
  constraint smartscan_phone_terminal_shape
    check (
      (status = 'received' and result_receipt_id is null and score_summary is null
        and rejection_code is null and completed_at is null)
      or (status = 'processed' and result_receipt_id is not null and score_summary is not null
        and rejection_code is null and completed_at is not null)
      or (status = 'rejected' and result_receipt_id is null and score_summary is null
        and rejection_code is not null and completed_at is not null)
    )
);

create index if not exists smartscan_phone_submissions_owner_feed_idx
  on public.smartscan_phone_submissions
    (teacher_user_id, assessment_id, status, received_at desc);

alter table public.smartscan_phone_submissions enable row level security;
alter table public.smartscan_phone_submissions force row level security;
revoke all on public.smartscan_phone_submissions from public, anon, authenticated;
grant select on public.smartscan_phone_submissions to authenticated;
create policy "phone submissions: owner read"
  on public.smartscan_phone_submissions
  for select
  to authenticated
  using ((select auth.uid()) = teacher_user_id);

-- Sessions are metadata only. All mutation now goes through authenticated or
-- capability-checked RPCs; no client can replace ownership or tenant columns.
drop policy if exists "sessions: owner read" on public.smartscan_sessions;
drop policy if exists "sessions: owner insert" on public.smartscan_sessions;
drop policy if exists "sessions: owner update" on public.smartscan_sessions;
drop policy if exists "sessions: owner delete" on public.smartscan_sessions;
create policy "sessions: owner read"
  on public.smartscan_sessions
  for select
  to authenticated
  using ((select auth.uid()) = teacher_user_id);
alter table public.smartscan_sessions force row level security;
revoke all on public.smartscan_sessions from public, anon, authenticated;
grant select on public.smartscan_sessions to authenticated;

create or replace function private.current_smartscan_tenant_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb;
  v_claim text;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  v_claim := coalesce(
    v_claims #>> '{app_metadata,school_profile_id}',
    nullif(current_setting('request.jwt.claim.school_profile_id', true), '')
  );
  -- A missing trusted school claim fails closed into a one-teacher tenant. It
  -- never permits two unrelated teachers to share data accidentally.
  return coalesce(v_claim::uuid, v_uid);
exception when invalid_text_representation then
  raise exception 'invalid_tenant_claim' using errcode = '22023';
end
$$;

revoke all on function private.current_smartscan_tenant_id() from public, anon, authenticated;

create or replace function public.create_smartscan_pairing_session(
  p_assessment_id text,
  p_pairing_token_hash text,
  p_learner_ids jsonb,
  p_allowed_versions jsonb,
  p_item_count integer
)
returns table (
  session_id uuid,
  expires_at timestamptz,
  school_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_school_id uuid;
  v_scope_id uuid;
  v_session_id uuid;
  v_expires_at timestamptz := clock_timestamp() + interval '15 minutes';
  v_versions text[];
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_assessment_id is null or char_length(p_assessment_id) not between 1 and 200
     or p_pairing_token_hash !~ '^[0-9a-f]{64}$'
     or p_item_count not between 1 and 80
     or jsonb_typeof(p_learner_ids) is distinct from 'array'
     or jsonb_array_length(p_learner_ids) not between 1 and 500
     or jsonb_typeof(p_allowed_versions) is distinct from 'array'
     or jsonb_array_length(p_allowed_versions) not between 1 and 4 then
    raise exception 'invalid_pairing_request' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_learner_ids) as learner(value)
    where char_length(learner.value) not between 1 and 200
  ) or (
    select count(distinct learner.value)
    from jsonb_array_elements_text(p_learner_ids) as learner(value)
  ) <> jsonb_array_length(p_learner_ids) then
    raise exception 'invalid_pairing_roster' using errcode = '22023';
  end if;
  select array_agg(version.value order by version.value)
    into v_versions
  from jsonb_array_elements_text(p_allowed_versions) as version(value);
  if v_versions is null
     or not (v_versions <@ array['A','B','C','D']::text[])
     or cardinality(v_versions) <> (
       select count(distinct version.value)
       from jsonb_array_elements_text(p_allowed_versions) as version(value)
     ) then
    raise exception 'invalid_pairing_versions' using errcode = '22023';
  end if;

  v_school_id := private.current_smartscan_tenant_id();
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':assessment:' || p_assessment_id, 0));

  select scope_row.id into v_scope_id
  from public.smartscan_assessment_scopes as scope_row
  where scope_row.teacher_user_id = v_uid
    and scope_row.assessment_id = p_assessment_id;
  if found then
    if not exists (
      select 1 from public.smartscan_assessment_scopes as scope_row
      where scope_row.id = v_scope_id and scope_row.school_id = v_school_id
    ) then
      raise exception 'assessment_tenant_mismatch' using errcode = '42501';
    end if;
  else
    insert into public.smartscan_assessment_scopes (
      teacher_user_id, school_id, assessment_id
    ) values (v_uid, v_school_id, p_assessment_id)
    returning id into v_scope_id;
  end if;

  insert into public.smartscan_sessions (
    teacher_user_id, school_id, assessment_id, assessment_scope_id,
    allowed_versions, item_count, status, expires_at
  ) values (
    v_uid, v_school_id, p_assessment_id, v_scope_id,
    v_versions, p_item_count, 'active', v_expires_at
  ) returning id into v_session_id;

  insert into private.smartscan_session_secrets (
    session_id, pairing_token_hash
  ) values (v_session_id, p_pairing_token_hash);

  insert into private.smartscan_session_learners (session_id, learner_id)
  select v_session_id, learner.value
  from jsonb_array_elements_text(p_learner_ids) as learner(value);

  return query select v_session_id, v_expires_at, v_school_id;
end
$$;

revoke all on function public.create_smartscan_pairing_session(text,text,jsonb,jsonb,integer)
  from public, anon, authenticated;
grant execute on function public.create_smartscan_pairing_session(text,text,jsonb,jsonb,integer)
  to authenticated;

create or replace function public.claim_smartscan_session(
  p_session_id uuid,
  p_pairing_token text,
  p_device_name text
)
returns table (
  capability text,
  capability_expires_at timestamptz,
  assessment_id text,
  school_id uuid,
  item_count integer,
  allowed_versions text[],
  next_sequence bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.smartscan_sessions%rowtype;
  v_secret private.smartscan_session_secrets%rowtype;
  v_now timestamptz := clock_timestamp();
  v_capability text;
  v_capability_expires_at timestamptz;
begin
  if p_pairing_token is null or char_length(p_pairing_token) not between 32 and 256
     or char_length(coalesce(p_device_name, '')) > 160 then
    raise exception 'invalid_or_expired_pairing' using errcode = '42501';
  end if;
  select session_row.* into v_session
  from public.smartscan_sessions as session_row
  where session_row.id = p_session_id
  for update;
  select secret_row.* into v_secret
  from private.smartscan_session_secrets as secret_row
  where secret_row.session_id = p_session_id
  for update;
  if v_session.id is null or v_secret.session_id is null
     or v_session.status <> 'active'
     or v_session.expires_at <= v_now
     or v_secret.pairing_consumed_at is not null
     or v_secret.pairing_revoked_at is not null
     or v_secret.pairing_token_hash <> encode(sha256(convert_to(p_pairing_token, 'UTF8')), 'hex') then
    raise exception 'invalid_or_expired_pairing' using errcode = '42501';
  end if;

  v_capability := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_capability_expires_at := least(v_session.expires_at, v_now + interval '15 minutes');
  update private.smartscan_session_secrets
  set pairing_consumed_at = v_now,
      capability_hash = encode(sha256(convert_to(v_capability, 'UTF8')), 'hex'),
      capability_issued_at = v_now,
      capability_expires_at = v_capability_expires_at,
      capability_revoked_at = null,
      last_sequence = 0
  where session_id = p_session_id;
  update public.smartscan_sessions
  set status = 'paired',
      paired_device_name = nullif(left(p_device_name, 160), ''),
      paired_at = v_now,
      last_seen_at = v_now
  where id = p_session_id;

  return query select
    v_capability,
    v_capability_expires_at,
    v_session.assessment_id,
    v_session.school_id,
    v_session.item_count,
    v_session.allowed_versions,
    1::bigint;
end
$$;

revoke all on function public.claim_smartscan_session(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.claim_smartscan_session(uuid,text,text)
  to anon, authenticated;

create or replace function public.submit_smartscan_phone_scan(
  p_session_id uuid,
  p_capability text,
  p_message_id text,
  p_sequence_number bigint,
  p_issued_at timestamptz,
  p_payload_text text,
  p_payload_digest text
)
returns table (
  inbox_receipt_id uuid,
  received_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.smartscan_sessions%rowtype;
  v_secret private.smartscan_session_secrets%rowtype;
  v_payload jsonb;
  v_now timestamptz := clock_timestamp();
  v_existing public.smartscan_phone_submissions%rowtype;
  v_receipt_id uuid;
  v_received_at timestamptz;
  v_captured_at timestamptz;
  v_learner_id text;
  v_version text;
begin
  if p_capability is null or char_length(p_capability) <> 64
     or p_message_id is null or char_length(p_message_id) not between 8 and 128
     or p_sequence_number is null or p_sequence_number <= 0
     or p_issued_at is null
     or p_payload_text is null or octet_length(p_payload_text) not between 2 and 262144
     or p_payload_digest !~ '^[0-9a-f]{64}$'
     or p_payload_digest <> encode(sha256(convert_to(p_payload_text, 'UTF8')), 'hex') then
    raise exception 'invalid_phone_submission' using errcode = '22023';
  end if;
  begin
    v_payload := p_payload_text::jsonb;
    v_captured_at := to_timestamp(((v_payload ->> 'capturedAt')::double precision) / 1000.0);
  exception when others then
    raise exception 'invalid_phone_submission' using errcode = '22023';
  end;
  if jsonb_typeof(v_payload) is distinct from 'object' then
    raise exception 'invalid_phone_submission' using errcode = '22023';
  end if;

  select session_row.* into v_session
  from public.smartscan_sessions as session_row
  where session_row.id = p_session_id
  for update;
  select secret_row.* into v_secret
  from private.smartscan_session_secrets as secret_row
  where secret_row.session_id = p_session_id
  for update;
  if v_session.id is null or v_secret.session_id is null
     or v_session.status <> 'paired'
     or v_session.expires_at <= v_now
     or v_secret.capability_expires_at is null
     or v_secret.capability_expires_at <= v_now
     or v_secret.capability_revoked_at is not null
     or v_secret.capability_hash <> encode(sha256(convert_to(p_capability, 'UTF8')), 'hex') then
    raise exception 'invalid_or_expired_capability' using errcode = '42501';
  end if;

  select * into v_existing
  from public.smartscan_phone_submissions
  where session_id = p_session_id and message_id = p_message_id;
  if found then
    if v_existing.sequence_number <> p_sequence_number
       or v_existing.payload_digest <> p_payload_digest
       or v_existing.issued_at <> p_issued_at then
      raise exception 'message_id_payload_mismatch' using errcode = '23505';
    end if;
    return query select v_existing.id, v_existing.received_at, true;
    return;
  end if;

  if p_sequence_number <> v_secret.last_sequence + 1 then
    raise exception 'out_of_order_sequence' using errcode = '22023';
  end if;
  if p_issued_at < v_now - interval '10 minutes'
     or p_issued_at > v_now + interval '1 minute'
     or p_issued_at < coalesce(v_session.paired_at, v_session.created_at) - interval '1 minute'
     or p_issued_at > v_session.expires_at then
    raise exception 'message_timestamp_outside_window' using errcode = '22023';
  end if;

  v_learner_id := v_payload ->> 'learnerId';
  v_version := v_payload ->> 'version';
  if v_payload ->> 'scanId' is distinct from p_message_id
     or v_payload ->> 'sessionId' is distinct from p_session_id::text
     or v_payload ->> 'assessmentId' is distinct from v_session.assessment_id
     or v_learner_id is null
     or v_version is null or not (v_version = any(v_session.allowed_versions))
     or jsonb_typeof(v_payload -> 'answerMap') is distinct from 'object'
     or jsonb_typeof(v_payload -> 'detected') is distinct from 'array'
     or jsonb_array_length(v_payload -> 'detected') <> v_session.item_count
     or (select count(*) from jsonb_object_keys(v_payload -> 'answerMap')) <> v_session.item_count
     or not exists (
       select 1 from private.smartscan_session_learners as roster
       where roster.session_id = p_session_id and roster.learner_id = v_learner_id
     ) then
    raise exception 'submission_scope_mismatch' using errcode = '42501';
  end if;
  if v_captured_at < coalesce(v_session.paired_at, v_session.created_at) - interval '1 minute'
     or v_captured_at > v_session.expires_at
     or v_captured_at > v_now + interval '1 minute' then
    raise exception 'capture_timestamp_outside_window' using errcode = '22023';
  end if;

  insert into public.smartscan_phone_submissions (
    session_id, teacher_user_id, school_id, assessment_id,
    message_id, sequence_number, issued_at, payload, payload_digest
  ) values (
    p_session_id, v_session.teacher_user_id, v_session.school_id, v_session.assessment_id,
    p_message_id, p_sequence_number, p_issued_at, v_payload, p_payload_digest
  ) returning id, smartscan_phone_submissions.received_at
    into v_receipt_id, v_received_at;
  update private.smartscan_session_secrets
  set last_sequence = p_sequence_number
  where session_id = p_session_id;
  update public.smartscan_sessions
  set last_seen_at = v_now
  where id = p_session_id;

  return query select v_receipt_id, v_received_at, false;
end
$$;

revoke all on function public.submit_smartscan_phone_scan(uuid,text,text,bigint,timestamptz,text,text)
  from public, anon, authenticated;
grant execute on function public.submit_smartscan_phone_scan(uuid,text,text,bigint,timestamptz,text,text)
  to anon, authenticated;

create or replace function public.get_smartscan_phone_submission_status(
  p_session_id uuid,
  p_capability text,
  p_message_id text
)
returns table (
  status text,
  inbox_receipt_id uuid,
  result_receipt_id uuid,
  score_summary jsonb,
  rejection_code text,
  received_at timestamptz,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.smartscan_sessions%rowtype;
  v_secret private.smartscan_session_secrets%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select session_row.* into v_session
  from public.smartscan_sessions as session_row
  where session_row.id = p_session_id;
  select secret_row.* into v_secret
  from private.smartscan_session_secrets as secret_row
  where secret_row.session_id = p_session_id;
  if v_session.id is null or v_secret.session_id is null
     or v_session.status <> 'paired'
     or v_session.expires_at <= v_now
     or v_secret.capability_expires_at is null
     or v_secret.capability_expires_at <= v_now
     or v_secret.capability_revoked_at is not null
     or v_secret.capability_hash <> encode(sha256(convert_to(coalesce(p_capability, ''), 'UTF8')), 'hex') then
    raise exception 'invalid_or_expired_capability' using errcode = '42501';
  end if;
  return query
  select message.status, message.id, message.result_receipt_id,
         message.score_summary, message.rejection_code,
         message.received_at, message.completed_at
  from public.smartscan_phone_submissions as message
  where message.session_id = p_session_id
    and message.message_id = p_message_id;
end
$$;

revoke all on function public.get_smartscan_phone_submission_status(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.get_smartscan_phone_submission_status(uuid,text,text)
  to anon, authenticated;

create or replace function public.complete_smartscan_phone_submission(
  p_session_id uuid,
  p_message_id text,
  p_result_receipt_id uuid default null,
  p_score_summary jsonb default null,
  p_rejection_code text default null
)
returns table (
  inbox_receipt_id uuid,
  status text,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_message public.smartscan_phone_submissions%rowtype;
  v_status text;
  v_allowed_rejections constant text[] := array[
    'pc_validation_failed',
    'learner_or_version_invalid',
    'duplicate_requires_review',
    'durable_commit_failed'
  ];
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  select * into v_message
  from public.smartscan_phone_submissions
  where teacher_user_id = v_uid
    and session_id = p_session_id
    and message_id = p_message_id
  for update;
  if not found then
    raise exception 'phone_submission_not_found' using errcode = '42501';
  end if;
  if (p_result_receipt_id is null) = (p_rejection_code is null) then
    raise exception 'invalid_completion_outcome' using errcode = '22023';
  end if;

  if p_result_receipt_id is not null then
    if p_score_summary is null or jsonb_typeof(p_score_summary) is distinct from 'object'
       or (p_score_summary - array['receiptId','scanId','learnerId','raw','total','pct','correct','wrong','blank','mastery']::text[]) <> '{}'::jsonb
       or not exists (
         select 1
         from public.smartscan_scan_submissions as result_row
         where result_row.id = p_result_receipt_id
           and result_row.teacher_user_id = v_uid
           and result_row.scan_session_id = v_message.session_id
           and result_row.scan_id = v_message.message_id
       ) then
      raise exception 'invalid_result_receipt' using errcode = '22023';
    end if;
    v_status := 'processed';
  else
    if p_score_summary is not null or not (p_rejection_code = any(v_allowed_rejections)) then
      raise exception 'invalid_rejection_code' using errcode = '22023';
    end if;
    v_status := 'rejected';
  end if;

  if v_message.status <> 'received' then
    if v_message.status = v_status
       and v_message.result_receipt_id is not distinct from p_result_receipt_id
       and v_message.score_summary is not distinct from p_score_summary
       and v_message.rejection_code is not distinct from p_rejection_code then
      return query select v_message.id, v_message.status, true;
      return;
    end if;
    raise exception 'phone_submission_already_terminal' using errcode = '23505';
  end if;

  update public.smartscan_phone_submissions
  set status = v_status,
      result_receipt_id = p_result_receipt_id,
      score_summary = p_score_summary,
      rejection_code = p_rejection_code,
      completed_at = clock_timestamp()
  where id = v_message.id;
  return query select v_message.id, v_status, false;
end
$$;

revoke all on function public.complete_smartscan_phone_submission(uuid,text,uuid,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.complete_smartscan_phone_submission(uuid,text,uuid,jsonb,text)
  to authenticated;

create or replace function public.end_smartscan_pairing_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  update public.smartscan_sessions
  set status = 'ended', last_seen_at = clock_timestamp()
  where id = p_session_id and teacher_user_id = v_uid and status <> 'ended';
  get diagnostics v_updated = row_count;
  if v_updated = 0 and not exists (
    select 1 from public.smartscan_sessions
    where id = p_session_id and teacher_user_id = v_uid and status = 'ended'
  ) then
    raise exception 'pairing_session_not_found' using errcode = '42501';
  end if;
  update private.smartscan_session_secrets
  set pairing_revoked_at = coalesce(pairing_revoked_at, clock_timestamp()),
      capability_revoked_at = coalesce(capability_revoked_at, clock_timestamp())
  where session_id = p_session_id;
  return true;
end
$$;

revoke all on function public.end_smartscan_pairing_session(uuid)
  from public, anon, authenticated;
grant execute on function public.end_smartscan_pairing_session(uuid)
  to authenticated;

-- Defense in depth for the certified result RPC: tenant identity is taken from
-- the pairing session. A missing client school id is filled; a spoofed one is
-- rejected before immutable evidence is inserted.
create or replace function private.enforce_smartscan_submission_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session public.smartscan_sessions%rowtype;
begin
  select * into v_session
  from public.smartscan_sessions
  where id = new.scan_session_id;
  if not found
     or new.teacher_user_id <> v_session.teacher_user_id
     or new.assessment_id <> v_session.assessment_id then
    raise exception 'submission_session_scope_mismatch' using errcode = '42501';
  end if;
  if new.school_id is null then
    new.school_id := v_session.school_id;
  elsif new.school_id <> v_session.school_id then
    raise exception 'submission_tenant_mismatch' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function private.enforce_smartscan_submission_scope() from public, anon, authenticated;
drop trigger if exists smartscan_submission_scope_guard on public.smartscan_scan_submissions;
create trigger smartscan_submission_scope_guard
  before insert or update on public.smartscan_scan_submissions
  for each row execute function private.enforce_smartscan_submission_scope();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'smartscan_phone_submissions'
  ) then
    alter publication supabase_realtime add table public.smartscan_phone_submissions;
  end if;
end
$$;

-- The certified functions already schema-qualify their relations. Tighten
-- their execution environment without rewriting their validated bodies.
alter function public.commit_smartscan_submission(jsonb) set search_path = '';
alter function public.record_smartscan_review_decisions(text,jsonb) set search_path = '';
alter function public.resolve_smartscan_submission(text,jsonb) set search_path = '';

-- This browser application has no service-role path. Explicitly remove any
-- platform/default grants so a leaked server key cannot become an undocumented
-- SmartScan API. Database owners retain operational recovery access.
revoke all on public.smartscan_assessment_scopes from service_role;
revoke all on public.smartscan_sessions from service_role;
revoke all on public.smartscan_phone_submissions from service_role;
revoke all on public.smartscan_scan_submissions from service_role;
revoke all on public.smartscan_checked_results from service_role;
revoke all on public.smartscan_scan_review_audit from service_role;
revoke all on public.smartscan_submission_review_events from service_role;
revoke all on function public.create_smartscan_pairing_session(text,text,jsonb,jsonb,integer) from service_role;
revoke all on function public.claim_smartscan_session(uuid,text,text) from service_role;
revoke all on function public.submit_smartscan_phone_scan(uuid,text,text,bigint,timestamptz,text,text) from service_role;
revoke all on function public.get_smartscan_phone_submission_status(uuid,text,text) from service_role;
revoke all on function public.complete_smartscan_phone_submission(uuid,text,uuid,jsonb,text) from service_role;
revoke all on function public.end_smartscan_pairing_session(uuid) from service_role;
revoke all on function public.commit_smartscan_submission(jsonb) from service_role;
revoke all on function public.record_smartscan_review_decisions(text,jsonb) from service_role;
revoke all on function public.resolve_smartscan_submission(text,jsonb) from service_role;
