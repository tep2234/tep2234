\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', false);

-- A queued capture reaches the server just inside the trusted 24-hour window.
update public.smartscan_sessions
set status = 'expired', expires_at = now() - interval '23 hours 59 minutes'
where id = '77777777-7777-4777-8777-777777777777';

select * from public.commit_smartscan_submission(
  public.test_smartscan_submission('offline-near-boundary-0005', 'RACE-L4')
);

-- Once the trusted server clock crosses 24 hours, new ingress is rejected,
-- while an exact retry still recovers its already-authoritative receipt.
update public.smartscan_sessions
set expires_at = now() - interval '24 hours 1 minute'
where id = '77777777-7777-4777-8777-777777777777';

select * from public.commit_smartscan_submission(
  public.test_smartscan_submission('offline-near-boundary-0005', 'RACE-L4')
);

do $$
begin
  begin
    perform * from public.commit_smartscan_submission(
      public.test_smartscan_submission('offline-after-boundary-0006', 'RACE-L5')
    );
    raise exception 'new capture was accepted after the offline catch-up boundary';
  exception when sqlstate '22023' then
    null;
  end;
end
$$;

update public.smartscan_sessions
set status = 'paired', expires_at = now() + interval '15 minutes'
where id = '77777777-7777-4777-8777-777777777777';

-- Reviewed resolution releases the partial unique pending slot.
select * from public.commit_smartscan_submission(
  public.test_smartscan_submission('review-release-first-0007', 'RACE-L6')
);
select * from public.resolve_smartscan_submission(
  'review-release-first-0007',
  jsonb_build_object(
    'eventId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'decision', 'reviewed',
    'reason', 'Teacher explicitly confirmed the clean provisional scan.'
  )
);
select * from public.commit_smartscan_submission(
  public.test_smartscan_submission('review-release-next-0008', 'RACE-L6')
);

-- Discard also releases the slot. Retrying the discarded original still
-- returns its original receipt and never reopens it.
select * from public.commit_smartscan_submission(
  public.test_smartscan_submission('discard-release-first-0009', 'RACE-L7')
);
select * from public.resolve_smartscan_submission(
  'discard-release-first-0009',
  jsonb_build_object(
    'eventId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'decision', 'discarded',
    'reason', 'Teacher rejected the physical sheet and requested a rescan.'
  )
);
select * from public.commit_smartscan_submission(
  public.test_smartscan_submission('discard-release-next-0010', 'RACE-L7')
);
select * from public.commit_smartscan_submission(
  public.test_smartscan_submission('discard-release-first-0009', 'RACE-L7')
);

do $$
begin
  if (select count(*) from public.smartscan_scan_submissions
      where learner_id = 'RACE-L6') <> 2 then
    raise exception 'reviewed pending-slot release failed';
  end if;
  if (select count(*) from public.smartscan_scan_submissions
      where learner_id = 'RACE-L7') <> 2 then
    raise exception 'discarded pending-slot release or retry idempotency failed';
  end if;
  if exists (
    select 1 from public.smartscan_scan_submissions
    where scan_id = 'discard-release-first-0009'
      and review_status <> 'discarded'
  ) then
    raise exception 'exact retry reopened discarded evidence';
  end if;
end
$$;

reset role;
