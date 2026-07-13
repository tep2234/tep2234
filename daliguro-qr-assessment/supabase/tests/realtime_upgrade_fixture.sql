\set ON_ERROR_STOP on

-- Production-shaped rows created before the Realtime security migration.
-- Their nullable school and public token hash exercise the compatibility path.
insert into auth.users (id)
values ('77777777-7777-4777-8777-777777777777')
on conflict (id) do nothing;

insert into public.smartscan_sessions (
  id,
  teacher_user_id,
  school_id,
  assessment_id,
  session_token_hash,
  status,
  created_at,
  expires_at
)
values (
  '77777777-7777-4777-8777-777777777771',
  '77777777-7777-4777-8777-777777777777',
  null,
  'legacy-assessment',
  repeat('a', 64),
  'active',
  now() - interval '1 minute',
  now() + interval '14 minutes'
);

insert into public.smartscan_checked_results (
  id,
  assessment_id,
  teacher_user_id,
  learner_id,
  learner_name,
  score,
  total_items,
  percentage,
  answer_map,
  item_results,
  scan_session_id
)
values (
  '77777777-7777-4777-8777-777777777772',
  'legacy-assessment',
  '77777777-7777-4777-8777-777777777777',
  'LEGACY-LEARNER',
  'Legacy Learner',
  1,
  1,
  100,
  '{"1":"A"}'::jsonb,
  '[{"itemNumber":1,"answer":"A","status":"selected"}]'::jsonb,
  '77777777-7777-4777-8777-777777777771'
);
