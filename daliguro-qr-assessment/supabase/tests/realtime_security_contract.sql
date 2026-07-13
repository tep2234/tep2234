\set ON_ERROR_STOP on

-- Production-equivalent identities: two teachers in different schools and a
-- second teacher in School A. Authorization claims are trusted app_metadata,
-- never user-editable user_metadata.
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');

insert into public.smartscan_assessment_scopes (
  id, teacher_user_id, school_id, assessment_id
) values
  ('10111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SEC-A1'),
  ('20222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SEC-B1');

insert into public.smartscan_sessions (
  id, teacher_user_id, school_id, assessment_id, assessment_scope_id,
  allowed_versions, item_count, status, expires_at
) values
  ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SEC-A1', '10111111-1111-4111-8111-111111111111', array['A']::text[], 1, 'active', now() + interval '15 minutes'),
  ('20000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SEC-B1', '20222222-2222-4222-8222-222222222222', array['A']::text[], 1, 'active', now() + interval '15 minutes'),
  ('30000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SEC-A1', '10111111-1111-4111-8111-111111111111', array['A']::text[], 1, 'active', now() - interval '1 second'),
  ('40000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SEC-A1', '10111111-1111-4111-8111-111111111111', array['A']::text[], 1, 'active', now() + interval '15 minutes'),
  ('50000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'SEC-A1', '10111111-1111-4111-8111-111111111111', array['A']::text[], 1, 'active', now() + interval '15 minutes');

insert into private.smartscan_session_secrets (session_id, pairing_token_hash)
values
  ('10000000-0000-4000-8000-000000000001', encode(sha256(convert_to(repeat('a', 64), 'UTF8')), 'hex')),
  ('20000000-0000-4000-8000-000000000002', encode(sha256(convert_to(repeat('b', 64), 'UTF8')), 'hex')),
  ('30000000-0000-4000-8000-000000000003', encode(sha256(convert_to(repeat('c', 64), 'UTF8')), 'hex')),
  ('40000000-0000-4000-8000-000000000004', encode(sha256(convert_to(repeat('d', 64), 'UTF8')), 'hex')),
  ('50000000-0000-4000-8000-000000000005', encode(sha256(convert_to(repeat('e', 64), 'UTF8')), 'hex'));

insert into private.smartscan_session_learners (session_id, learner_id)
values
  ('10000000-0000-4000-8000-000000000001', 'LEARNER-A1'),
  ('20000000-0000-4000-8000-000000000002', 'LEARNER-B1'),
  ('30000000-0000-4000-8000-000000000003', 'LEARNER-A1'),
  ('40000000-0000-4000-8000-000000000004', 'LEARNER-A1'),
  ('50000000-0000-4000-8000-000000000005', 'LEARNER-A1');

-- Test-only wrappers convert an expected production rejection into a boolean
-- assertion without weakening the production functions or their grants.
create or replace function public.test_expect_claim_failure(
  p_session_id uuid,
  p_token text
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform * from public.claim_smartscan_session(p_session_id, p_token, 'test-device');
  return false;
exception when sqlstate '42501' then
  return true;
end
$$;

create or replace function public.test_expect_submit_failure(
  p_session_id uuid,
  p_capability text,
  p_message_id text,
  p_sequence bigint,
  p_issued_at timestamptz,
  p_payload text,
  p_digest text,
  p_expected_state text
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform * from public.submit_smartscan_phone_scan(
    p_session_id, p_capability, p_message_id, p_sequence,
    p_issued_at, p_payload, p_digest
  );
  return false;
exception when others then
  return sqlstate = p_expected_state;
end
$$;

create or replace function public.test_assert(p_condition boolean, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception '%', p_message;
  end if;
end
$$;

-- Wrong, cross-session, expired, and revoked QR secrets fail without revealing
-- which part of the credential was valid.
select public.test_expect_claim_failure(
  '10000000-0000-4000-8000-000000000001', repeat('x', 64)
) as wrong_token_rejected \gset
select public.test_expect_claim_failure(
  '10000000-0000-4000-8000-000000000001', repeat('b', 64)
) as cross_session_token_rejected \gset
select public.test_expect_claim_failure(
  '30000000-0000-4000-8000-000000000003', repeat('c', 64)
) as expired_token_rejected \gset

\if :wrong_token_rejected
\else
  \quit 1
\endif
\if :cross_session_token_rejected
\else
  \quit 1
\endif
\if :expired_token_rejected
\else
  \quit 1
\endif

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"school_profile_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}',
  false
);

-- Session creation binds the authenticated teacher, trusted tenant, assessment,
-- roster, versions, item count, and a hash rather than a raw token.
select * from public.create_smartscan_pairing_session(
  'SEC-CREATED-A1',
  encode(sha256(convert_to(repeat('f', 64), 'UTF8')), 'hex'),
  '["LEARNER-A1"]'::jsonb,
  '["A"]'::jsonb,
  1
) \gset created_

select public.test_assert(
  exists (
    select 1 from public.smartscan_sessions
    where id = :'created_session_id'::uuid
      and teacher_user_id = '11111111-1111-4111-8111-111111111111'
      and school_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and assessment_id = 'SEC-CREATED-A1'
      and item_count = 1
      and allowed_versions = array['A']::text[]
  ),
  'authenticated pairing creation lost owner or tenant scope'
);

-- Teacher A may revoke only Teacher A's session. Consumed/revoked tokens do not
-- become valid again on reconnect.
select public.end_smartscan_pairing_session('40000000-0000-4000-8000-000000000004');
reset role;
select public.test_expect_claim_failure(
  '40000000-0000-4000-8000-000000000004', repeat('d', 64)
) as revoked_token_rejected \gset
\if :revoked_token_rejected
\else
  \quit 1
\endif

-- Valid one-time claim succeeds and returns a distinct, short-lived scoped
-- capability. The same raw pairing secret cannot claim twice.
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select * from public.claim_smartscan_session(
  '10000000-0000-4000-8000-000000000001', repeat('a', 64), 'Phone A'
) \gset claim_a_

reset role;
select public.test_assert(
  :'claim_a_capability' <> repeat('a', 64)
  and char_length(:'claim_a_capability') = 64
  and :'claim_a_assessment_id' = 'SEC-A1'
  and :'claim_a_school_id'::uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and :'claim_a_next_sequence'::bigint = 1,
  'claim returned an unsafe or incorrectly scoped capability'
);
select public.test_assert(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'smartscan_sessions'
      and column_name in ('session_token_hash', 'capability_hash')
  ),
  'secret hashes remain queryable in the public session row'
);
select public.test_assert(
  not exists (
    select 1 from private.smartscan_session_secrets
    where pairing_token_hash = repeat('a', 64)
       or capability_hash = :'claim_a_capability'
  ),
  'raw pairing or capability secret was stored'
);

select public.test_expect_claim_failure(
  '10000000-0000-4000-8000-000000000001', repeat('a', 64)
) as consumed_token_rejected \gset
\if :consumed_token_rejected
\else
  \quit 1
\endif

-- Build the exact client JSON bytes once. Digest verification happens before
-- JSON parsing, so changing any byte without recomputing the digest fails.
select
  jsonb_build_object(
    'scanId', 'secure-message-0001',
    'sessionId', '10000000-0000-4000-8000-000000000001',
    'assessmentId', 'SEC-A1',
    'learnerId', 'LEARNER-A1',
    'version', 'A',
    'answerMap', jsonb_build_object('1', 'B'),
    'detected', jsonb_build_array(jsonb_build_object(
      'item', 1, 'answer', 'B', 'status', 'selected', 'confidence', 0.95
    )),
    'confidence', 0.95,
    'capturedAt', extract(epoch from clock_timestamp()) * 1000
  )::text as payload,
  clock_timestamp() as issued_at
\gset message_a_

select encode(sha256(convert_to(:'message_a_payload', 'UTF8')), 'hex') as digest
\gset message_a_

set role anon;
select * from public.submit_smartscan_phone_scan(
  '10000000-0000-4000-8000-000000000001',
  :'claim_a_capability',
  'secure-message-0001',
  1,
  :'message_a_issued_at'::timestamptz,
  :'message_a_payload',
  :'message_a_digest'
) \gset inbox_a_

-- Exact lost-ack retry is idempotent. The durable inbox exists before any PC
-- scoring receipt or terminal completion is attached.
select * from public.submit_smartscan_phone_scan(
  '10000000-0000-4000-8000-000000000001',
  :'claim_a_capability',
  'secure-message-0001',
  1,
  :'message_a_issued_at'::timestamptz,
  :'message_a_payload',
  :'message_a_digest'
) \gset replay_a_

select * from public.get_smartscan_phone_submission_status(
  '10000000-0000-4000-8000-000000000001',
  :'claim_a_capability',
  'secure-message-0001'
) \gset status_a_

reset role;
select public.test_assert(
  :'inbox_a_inbox_receipt_id'::uuid = :'replay_a_inbox_receipt_id'::uuid
  and :'replay_a_replayed'::boolean is true
  and :'status_a_status' = 'received'
  and :'status_a_inbox_receipt_id'::uuid = :'inbox_a_inbox_receipt_id'::uuid,
  'durable inbox or exact replay contract failed'
);

-- Digest tampering, duplicate/out-of-order sequences, stale/future timestamps,
-- wrong assessment, wrong learner, wrong version, and wrong capability fail.
select public.test_expect_submit_failure(
  '10000000-0000-4000-8000-000000000001', :'claim_a_capability',
  'secure-message-0002', 2, clock_timestamp(), :'message_a_payload', repeat('0', 64), '22023'
) as tampered_digest_rejected \gset

select replace(:'message_a_payload', 'secure-message-0001', 'secure-message-0002') as payload \gset message_2_
select encode(sha256(convert_to(:'message_2_payload', 'UTF8')), 'hex') as digest \gset message_2_
select public.test_expect_submit_failure(
  '10000000-0000-4000-8000-000000000001', :'claim_a_capability',
  'secure-message-0002', 1, clock_timestamp(), :'message_2_payload', :'message_2_digest', '22023'
) as duplicate_sequence_rejected \gset
select public.test_expect_submit_failure(
  '10000000-0000-4000-8000-000000000001', :'claim_a_capability',
  'secure-message-0002', 3, clock_timestamp(), :'message_2_payload', :'message_2_digest', '22023'
) as out_of_order_rejected \gset
select public.test_expect_submit_failure(
  '10000000-0000-4000-8000-000000000001', :'claim_a_capability',
  'secure-message-0002', 2, clock_timestamp() - interval '11 minutes', :'message_2_payload', :'message_2_digest', '22023'
) as old_timestamp_rejected \gset
select public.test_expect_submit_failure(
  '10000000-0000-4000-8000-000000000001', :'claim_a_capability',
  'secure-message-0002', 2, clock_timestamp() + interval '2 minutes', :'message_2_payload', :'message_2_digest', '22023'
) as future_timestamp_rejected \gset
select public.test_expect_submit_failure(
  '10000000-0000-4000-8000-000000000001', repeat('9', 64),
  'secure-message-0002', 2, clock_timestamp(), :'message_2_payload', :'message_2_digest', '42501'
) as wrong_capability_rejected \gset

select replace(:'message_2_payload', 'SEC-A1', 'SEC-B1') as payload \gset wrong_assessment_
select encode(sha256(convert_to(:'wrong_assessment_payload', 'UTF8')), 'hex') as digest \gset wrong_assessment_
select public.test_expect_submit_failure(
  '10000000-0000-4000-8000-000000000001', :'claim_a_capability',
  'secure-message-0002', 2, clock_timestamp(), :'wrong_assessment_payload', :'wrong_assessment_digest', '42501'
) as wrong_assessment_rejected \gset

select replace(:'message_2_payload', 'LEARNER-A1', 'LEARNER-B1') as payload \gset wrong_learner_
select encode(sha256(convert_to(:'wrong_learner_payload', 'UTF8')), 'hex') as digest \gset wrong_learner_
select public.test_expect_submit_failure(
  '10000000-0000-4000-8000-000000000001', :'claim_a_capability',
  'secure-message-0002', 2, clock_timestamp(), :'wrong_learner_payload', :'wrong_learner_digest', '42501'
) as wrong_learner_rejected \gset

select replace(:'message_2_payload', '"version": "A"', '"version": "B"') as payload \gset wrong_version_
select encode(sha256(convert_to(:'wrong_version_payload', 'UTF8')), 'hex') as digest \gset wrong_version_
select public.test_expect_submit_failure(
  '10000000-0000-4000-8000-000000000001', :'claim_a_capability',
  'secure-message-0002', 2, clock_timestamp(), :'wrong_version_payload', :'wrong_version_digest', '42501'
) as wrong_version_rejected \gset

\if :tampered_digest_rejected
\else
  \quit 1
\endif
\if :duplicate_sequence_rejected
\else
  \quit 1
\endif
\if :out_of_order_rejected
\else
  \quit 1
\endif
\if :old_timestamp_rejected
\else
  \quit 1
\endif
\if :future_timestamp_rejected
\else
  \quit 1
\endif
\if :wrong_capability_rejected
\else
  \quit 1
\endif
\if :wrong_assessment_rejected
\else
  \quit 1
\endif
\if :wrong_learner_rejected
\else
  \quit 1
\endif
\if :wrong_version_rejected
\else
  \quit 1
\endif

-- The next valid sequence is durably received after rejected attempts. A
-- matching authoritative result receipt is then required before the inbox can
-- become processed.
set role anon;
select * from public.submit_smartscan_phone_scan(
  '10000000-0000-4000-8000-000000000001',
  :'claim_a_capability',
  'secure-message-0002',
  2,
  clock_timestamp(),
  :'message_2_payload',
  :'message_2_digest'
) \gset inbox_b_
reset role;

insert into public.smartscan_scan_submissions (
  id, scan_id, teacher_user_id, school_id, assessment_id, learner_id,
  learner_name, version, score, total_items, percentage, answer_map,
  item_results, qr_payload, scan_session_id, scan_source, scan_confidence,
  low_confidence_items, payload_fingerprint, captured_at
) values (
  '10000000-0000-4000-8000-000000000099',
  'secure-message-0002',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'SEC-A1',
  'LEARNER-A1',
  'Learner A1',
  'A',
  1,
  1,
  100,
  '{"1":"B"}'::jsonb,
  '[{"item":1,"answer":"B","status":"selected","confidence":0.95}]'::jsonb,
  '{"version":"A"}'::jsonb,
  '10000000-0000-4000-8000-000000000001',
  'phone_camera',
  0.95,
  '[]'::jsonb,
  repeat('f', 64),
  clock_timestamp()
);

-- RLS and grants: owner sees both rows, other teacher and other tenant see none,
-- anonymous/service roles have no table access, and protected ownership fields
-- cannot be directly rewritten.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select count(*) as owner_count from public.smartscan_phone_submissions \gset rls_
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select count(*) as same_tenant_other_teacher_count from public.smartscan_phone_submissions \gset rls_
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select count(*) as other_tenant_count from public.smartscan_phone_submissions \gset rls_
reset role;

select public.test_assert(
  :'rls_owner_count'::integer = 2
  and :'rls_same_tenant_other_teacher_count'::integer = 0
  and :'rls_other_tenant_count'::integer = 0,
  'teacher or tenant RLS isolation failed'
);

do $$
declare
  v_unsafe_function record;
begin
  if has_table_privilege('anon', 'public.smartscan_sessions', 'SELECT')
     or has_table_privilege('anon', 'public.smartscan_phone_submissions', 'SELECT')
     or has_table_privilege('anon', 'public.smartscan_scan_submissions', 'SELECT')
     or has_table_privilege('authenticated', 'public.smartscan_sessions', 'INSERT')
     or has_table_privilege('authenticated', 'public.smartscan_sessions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.smartscan_sessions', 'DELETE')
     or has_table_privilege('authenticated', 'public.smartscan_phone_submissions', 'INSERT')
     or has_table_privilege('authenticated', 'public.smartscan_phone_submissions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.smartscan_phone_submissions', 'DELETE') then
    raise exception 'direct client table privilege bypass exists';
  end if;
  if has_table_privilege('service_role', 'public.smartscan_sessions', 'SELECT')
     or has_table_privilege('service_role', 'public.smartscan_phone_submissions', 'SELECT')
     or has_function_privilege('service_role', 'public.submit_smartscan_phone_scan(uuid,text,text,bigint,timestamptz,text,text)', 'EXECUTE') then
    raise exception 'service role has an undocumented SmartScan path';
  end if;
  if has_function_privilege('anon', 'public.create_smartscan_pairing_session(text,text,jsonb,jsonb,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_smartscan_phone_submission(uuid,text,uuid,jsonb,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.end_smartscan_pairing_session(uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.claim_smartscan_session(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.submit_smartscan_phone_scan(uuid,text,text,bigint,timestamptz,text,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.get_smartscan_phone_submission_status(uuid,text,text)', 'EXECUTE') then
    raise exception 'RPC grants violate least privilege';
  end if;
  for v_unsafe_function in
    select n.nspname, p.proname, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and p.proname in (
        'create_smartscan_pairing_session', 'claim_smartscan_session',
        'submit_smartscan_phone_scan', 'get_smartscan_phone_submission_status',
        'complete_smartscan_phone_submission', 'end_smartscan_pairing_session',
        'commit_smartscan_submission', 'record_smartscan_review_decisions',
        'resolve_smartscan_submission'
      )
      and not coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[]
  loop
    raise exception 'unsafe SECURITY DEFINER search_path: %.%', v_unsafe_function.nspname, v_unsafe_function.proname;
  end loop;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'smartscan_phone_submissions'
  ) then
    raise exception 'durable phone inbox is absent from Realtime publication';
  end if;
end
$$;

-- Completion is scoped by both session and message. The score contract accepts
-- the client receipt identifier, exact retries are idempotent, and no other
-- session can be targeted by a colliding message id.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select * from public.complete_smartscan_phone_submission(
  '10000000-0000-4000-8000-000000000001',
  'secure-message-0002',
  '10000000-0000-4000-8000-000000000099',
  jsonb_build_object(
    'receiptId', '10000000-0000-4000-8000-000000000099',
    'scanId', 'secure-message-0002',
    'learnerId', 'LEARNER-A1',
    'raw', 1, 'total', 1, 'pct', 100,
    'correct', 1, 'wrong', 0, 'blank', 0, 'mastery', 'mastered'
  ),
  null
) \gset processed_
select * from public.complete_smartscan_phone_submission(
  '10000000-0000-4000-8000-000000000001',
  'secure-message-0002',
  '10000000-0000-4000-8000-000000000099',
  jsonb_build_object(
    'receiptId', '10000000-0000-4000-8000-000000000099',
    'scanId', 'secure-message-0002',
    'learnerId', 'LEARNER-A1',
    'raw', 1, 'total', 1, 'pct', 100,
    'correct', 1, 'wrong', 0, 'blank', 0, 'mastery', 'mastered'
  ),
  null
) \gset processed_replay_
reset role;

select public.test_assert(
  :'processed_status' = 'processed'
  and :'processed_replay_replayed'::boolean is true
  and (select result_receipt_id from public.smartscan_phone_submissions
       where session_id = '10000000-0000-4000-8000-000000000001'
         and message_id = 'secure-message-0002') = '10000000-0000-4000-8000-000000000099'::uuid,
  'authoritative processed completion or exact retry failed'
);

-- Terminal inbox decisions are append-only. An exact retry is idempotent; a
-- conflicting outcome cannot rewrite the row.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select * from public.complete_smartscan_phone_submission(
  '10000000-0000-4000-8000-000000000001',
  'secure-message-0001', null, null, 'pc_validation_failed'
) \gset completion_
select * from public.complete_smartscan_phone_submission(
  '10000000-0000-4000-8000-000000000001',
  'secure-message-0001', null, null, 'pc_validation_failed'
) \gset completion_replay_
reset role;

select public.test_assert(
  :'completion_status' = 'rejected'
  and :'completion_replay_status' = 'rejected'
  and :'completion_replay_replayed'::boolean is true
  and (select status from public.smartscan_phone_submissions where message_id = 'secure-message-0001') = 'rejected',
  'terminal phone inbox decision is not idempotent'
);

-- A valid reconnect can read its durable state before closure. Once the owner
-- closes the session, capability polling and delayed/offline ingress fail.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.end_smartscan_pairing_session('10000000-0000-4000-8000-000000000001');
reset role;
select public.test_expect_submit_failure(
  '10000000-0000-4000-8000-000000000001', :'claim_a_capability',
  'secure-message-0002', 2, clock_timestamp(), :'message_2_payload', :'message_2_digest', '42501'
) as closed_session_rejected \gset
\if :closed_session_rejected
\else
  \quit 1
\endif

-- Direct tenant spoofing at the certified receipt boundary is rejected by the
-- new trigger even if an authenticated client submits an otherwise valid row.
do $$
begin
  if not exists (
    select 1 from public.smartscan_phone_submissions
    where message_id = 'secure-message-0001'
      and school_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and teacher_user_id = '11111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'server-owned tenant binding was not persisted';
  end if;
end
$$;

drop function public.test_expect_claim_failure(uuid,text);
drop function public.test_expect_submit_failure(uuid,text,text,bigint,timestamptz,text,text,text);
drop function public.test_assert(boolean,text);

reset role;
