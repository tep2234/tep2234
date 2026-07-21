\set ON_ERROR_STOP on

do $$
declare
  v_session public.smartscan_sessions%rowtype;
begin
  select *
  into strict v_session
  from public.smartscan_sessions
  where id = '77777777-7777-4777-8777-777777777771';

  if v_session.school_id <> '77777777-7777-4777-8777-777777777777'::uuid then
    raise exception 'Legacy nullable tenant was not deterministically backfilled';
  end if;
  if v_session.assessment_scope_id is null
     or v_session.allowed_versions <> array['A','B','C','D']::text[]
     or v_session.item_count <> 80 then
    raise exception 'Legacy session did not receive secure scope defaults';
  end if;
  if not exists (
    select 1
    from public.smartscan_assessment_scopes scope_row
    where scope_row.id = v_session.assessment_scope_id
      and scope_row.teacher_user_id = v_session.teacher_user_id
      and scope_row.school_id = v_session.school_id
      and scope_row.assessment_id = v_session.assessment_id
  ) then
    raise exception 'Legacy session scope was not preserved';
  end if;
  if not exists (
    select 1
    from private.smartscan_session_secrets secret_row
    where secret_row.session_id = v_session.id
      and secret_row.pairing_token_hash = repeat('a', 64)
      and secret_row.pairing_consumed_at is null
  ) then
    raise exception 'Legacy pairing secret was not moved intact to private storage';
  end if;
  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.smartscan_sessions'::regclass
      and attname = 'session_token_hash'
      and not attisdropped
  ) then
    raise exception 'Public legacy token hash column remains exposed';
  end if;
  if not exists (
    select 1
    from public.smartscan_checked_results
    where id = '77777777-7777-4777-8777-777777777772'
      and learner_id = 'LEGACY-LEARNER'
      and score = 1
  ) then
    raise exception 'Legacy checked result was not preserved';
  end if;
end
$$;

select 'SmartScan Realtime production-style upgrade contract passed.' as result;
