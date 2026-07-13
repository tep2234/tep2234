\set ON_ERROR_STOP on

insert into auth.users (id)
values ('66666666-6666-4666-8666-666666666666');

insert into public.smartscan_sessions (
  id, teacher_user_id, assessment_id, session_token_hash, status, expires_at
) values (
  '77777777-7777-4777-8777-777777777777',
  '66666666-6666-4666-8666-666666666666',
  'CONCURRENCY-A1',
  repeat('b', 64),
  'paired',
  now() + interval '15 minutes'
);

-- Test-only canonical payload builder. Every concurrent psql connection calls
-- the production SECURITY DEFINER RPC with an identical JSONB contract.
create or replace function public.test_smartscan_submission(
  p_scan_id text,
  p_learner_id text,
  p_answer text default 'A',
  p_status text default 'selected',
  p_confidence numeric default 0.95
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'scan_id', p_scan_id,
    'teacher_user_id', '66666666-6666-4666-8666-666666666666',
    'scan_session_id', '77777777-7777-4777-8777-777777777777',
    'assessment_id', 'CONCURRENCY-A1',
    'learner_id', p_learner_id,
    'score', case when p_answer = 'A' then 1 else 0 end,
    'total_items', 1,
    'percentage', case when p_answer = 'A' then 100 else 0 end,
    'scan_confidence', p_confidence,
    'answer_map', jsonb_build_object('1', p_answer),
    'item_results', jsonb_build_array(jsonb_build_object(
      'item', 1,
      'answer', p_answer,
      'status', p_status,
      'confidence', p_confidence,
      'unreadableChoices', case when p_status = 'unreadable'
        then jsonb_build_array(0) else null end
    ) - case when p_status = 'unreadable' then 'never' else 'unreadableChoices' end),
    'qr_payload', jsonb_build_object(
      'version', 'A',
      'assessmentId', 'CONCURRENCY-A1',
      'learnerId', p_learner_id,
      'sessionId', '77777777-7777-4777-8777-777777777777',
      'itemCount', 1,
      -- Fixed per scan identity, deterministic across separate connections.
      'capturedAt', 1700000000000 + abs(hashtextextended(p_scan_id, 0) % 1000000)
    ),
    'low_confidence_items', case when p_status = 'unreadable'
      then jsonb_build_array(1) else '[]'::jsonb end,
    'review_status', 'needs_review',
    'is_official', false,
    'corrected_by_teacher', false
  )
$$;

-- The fixed capture epoch above must fall inside the session window.
update public.smartscan_sessions
set created_at = to_timestamp(1699999990),
    expires_at = now() + interval '15 minutes'
where id = '77777777-7777-4777-8777-777777777777';
