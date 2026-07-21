\set ON_ERROR_STOP on

insert into auth.users (id) values ('88888888-8888-4888-8888-888888888888')
on conflict (id) do nothing;

insert into public.smartscan_assessment_scopes (
  id, teacher_user_id, school_id, assessment_id
) values (
  '89888888-8888-4888-8888-888888888888',
  '88888888-8888-4888-8888-888888888888',
  '88888888-8888-4888-8888-888888888888',
  'REALTIME-RACE'
);

insert into public.smartscan_sessions (
  id, teacher_user_id, school_id, assessment_id, assessment_scope_id,
  allowed_versions, item_count, status, paired_at, expires_at
) values
  (
    '99999999-9999-4999-8999-999999999991',
    '88888888-8888-4888-8888-888888888888',
    '88888888-8888-4888-8888-888888888888',
    'REALTIME-RACE',
    '89888888-8888-4888-8888-888888888888',
    array['A']::text[], 1, 'active', null, now() + interval '15 minutes'
  ),
  (
    '99999999-9999-4999-8999-999999999992',
    '88888888-8888-4888-8888-888888888888',
    '88888888-8888-4888-8888-888888888888',
    'REALTIME-RACE',
    '89888888-8888-4888-8888-888888888888',
    array['A']::text[], 1, 'paired', now(), now() + interval '15 minutes'
  );

insert into private.smartscan_session_secrets (
  session_id, pairing_token_hash, pairing_consumed_at,
  capability_hash, capability_issued_at, capability_expires_at
) values
  (
    '99999999-9999-4999-8999-999999999991',
    encode(sha256(convert_to(repeat('r', 64), 'UTF8')), 'hex'),
    null, null, null, null
  ),
  (
    '99999999-9999-4999-8999-999999999992',
    encode(sha256(convert_to(repeat('unused', 16), 'UTF8')), 'hex'),
    now(),
    encode(sha256(convert_to(repeat('q', 64), 'UTF8')), 'hex'),
    now(), now() + interval '15 minutes'
  );

insert into private.smartscan_session_learners (session_id, learner_id)
values
  ('99999999-9999-4999-8999-999999999991', 'RACE-LEARNER'),
  ('99999999-9999-4999-8999-999999999992', 'RACE-LEARNER');

create or replace function public.test_realtime_race_payload(p_message_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'scanId', p_message_id,
    'sessionId', '99999999-9999-4999-8999-999999999992',
    'assessmentId', 'REALTIME-RACE',
    'learnerId', 'RACE-LEARNER',
    'version', 'A',
    'answerMap', jsonb_build_object('1', 'A'),
    'detected', jsonb_build_array(jsonb_build_object(
      'item', 1, 'answer', 'A', 'status', 'selected', 'confidence', 0.95
    )),
    'confidence', 0.95,
    'capturedAt', extract(epoch from now()) * 1000
  )::text
$$;
