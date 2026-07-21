\set ON_ERROR_STOP on

begin;
\i /tmp/0004.sql

do $$
begin
  if to_regclass('public.smartscan_phone_submissions') is null
     or to_regclass('private.smartscan_session_secrets') is null then
    raise exception 'Migration was not visible inside rollback rehearsal';
  end if;
  if not exists (
    select 1
    from private.smartscan_session_secrets
    where session_id = '77777777-7777-4777-8777-777777777771'
      and pairing_token_hash = repeat('a', 64)
  ) then
    raise exception 'Legacy secret was not available before rollback';
  end if;
end
$$;

rollback;

do $$
begin
  if to_regclass('public.smartscan_phone_submissions') is not null
     or to_regclass('private.smartscan_session_secrets') is not null then
    raise exception 'Transactional rollback left new security tables behind';
  end if;
  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.smartscan_sessions'::regclass
      and attname = 'session_token_hash'
      and not attisdropped
  ) then
    raise exception 'Transactional rollback did not restore the legacy token column';
  end if;
  if not exists (
    select 1
    from public.smartscan_sessions
    where id = '77777777-7777-4777-8777-777777777771'
      and school_id is null
      and session_token_hash = repeat('a', 64)
  ) then
    raise exception 'Transactional rollback changed the legacy session';
  end if;
  if not exists (
    select 1
    from public.smartscan_checked_results
    where id = '77777777-7777-4777-8777-777777777772'
  ) then
    raise exception 'Transactional rollback lost legacy checked data';
  end if;
end
$$;

select 'SmartScan Realtime transactional rollback rehearsal passed.' as result;
