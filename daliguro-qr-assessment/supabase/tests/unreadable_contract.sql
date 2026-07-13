\set ON_ERROR_STOP on

insert into auth.users (id)
values ('11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

insert into public.smartscan_assessment_scopes (
  id, teacher_user_id, school_id, assessment_id
) values (
  '12111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'A1'
);

insert into public.smartscan_sessions (
  id, teacher_user_id, school_id, assessment_id, assessment_scope_id,
  allowed_versions, item_count, status, expires_at
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'A1',
  '12111111-1111-4111-8111-111111111111',
  array['A']::text[],
  1,
  'paired',
  now() + interval '15 minutes'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

-- An unreadable row with affected-choice evidence is accepted provisionally.
select * from public.commit_smartscan_submission(
  jsonb_build_object(
    'scan_id', 'scan-unreadable-0001',
    'teacher_user_id', '11111111-1111-4111-8111-111111111111',
    'scan_session_id', '22222222-2222-4222-8222-222222222222',
    'assessment_id', 'A1',
    'learner_id', 'L1',
    'score', 0,
    'total_items', 1,
    'percentage', 0,
    'scan_confidence', 0.1,
    'answer_map', jsonb_build_object('1', 'A'),
    'item_results', jsonb_build_array(jsonb_build_object(
      'item', 1,
      'answer', 'A',
      'status', 'unreadable',
      'confidence', 0.1,
      'fill', jsonb_build_array(0.4, 0, 0, 0),
      'unreadableChoices', jsonb_build_array(1)
    )),
    'qr_payload', jsonb_build_object(
      'version', 'A',
      'assessmentId', 'A1',
      'learnerId', 'L1',
      'sessionId', '22222222-2222-4222-8222-222222222222',
      'itemCount', 1,
      'capturedAt', extract(epoch from now()) * 1000
    ),
    'low_confidence_items', jsonb_build_array(1),
    'review_status', 'needs_review',
    'is_official', false,
    'corrected_by_teacher', false
  )
);

-- An unreadable/low-confidence item cannot be terminally reviewed before its
-- explicit item decision exists.
do $$
begin
  begin
    perform * from public.resolve_smartscan_submission(
      'scan-unreadable-0001',
      jsonb_build_object(
        'eventId', '55555555-5555-4555-8555-555555555555',
        'decision', 'reviewed',
        'reason', 'This must fail because the unreadable item is unresolved.'
      )
    );
    raise exception 'unreadable submission resolved without an item audit';
  exception when sqlstate '22023' then
    null;
  end;
end
$$;

-- Append the teacher decision and verify exact-event replay is idempotent.
select * from public.record_smartscan_review_decisions(
  'scan-unreadable-0001',
  jsonb_build_array(jsonb_build_object(
    'eventId', '33333333-3333-4333-8333-333333333333',
    'omrRowNumber', 1,
    'itemId', 'item-7',
    'itemNumber', 7,
    'originalStatus', 'unreadable',
    'originalValue', 'A',
    'correctedValue', 'B',
    'source', 'review_queue',
    'reason', 'Unreadable camera evidence required an explicit teacher decision.'
  ))
);

-- Submission resolution is append-only/idempotent and frees the learner's
-- pending slot without changing the original detector evidence.
select * from public.resolve_smartscan_submission(
  'scan-unreadable-0001',
  jsonb_build_object(
    'eventId', '44444444-4444-4444-8444-444444444444',
    'decision', 'reviewed',
    'reason', 'Teacher completed all mandatory camera-evidence review decisions.'
  )
);
select * from public.resolve_smartscan_submission(
  'scan-unreadable-0001',
  jsonb_build_object(
    'eventId', '44444444-4444-4444-8444-444444444444',
    'decision', 'reviewed',
    'reason', 'Teacher completed all mandatory camera-evidence review decisions.'
  )
);
select * from public.record_smartscan_review_decisions(
  'scan-unreadable-0001',
  jsonb_build_array(jsonb_build_object(
    'eventId', '33333333-3333-4333-8333-333333333333',
    'omrRowNumber', 1,
    'itemId', 'item-7',
    'itemNumber', 7,
    'originalStatus', 'unreadable',
    'originalValue', 'A',
    'correctedValue', 'B',
    'source', 'review_queue',
    'reason', 'Unreadable camera evidence required an explicit teacher decision.'
  ))
);

do $$
begin
  if has_table_privilege('authenticated', 'public.smartscan_checked_results', 'INSERT')
     or has_table_privilege('authenticated', 'public.smartscan_checked_results', 'UPDATE')
     or has_table_privilege('authenticated', 'public.smartscan_checked_results', 'DELETE') then
    raise exception 'legacy checked-results table still permits receipt bypass writes';
  end if;
  if has_function_privilege('anon', 'public.commit_smartscan_submission(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_smartscan_review_decisions(text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.resolve_smartscan_submission(text,jsonb)', 'EXECUTE') then
    raise exception 'anonymous role can execute a privileged SmartScan RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.commit_smartscan_submission(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.record_smartscan_review_decisions(text,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.resolve_smartscan_submission(text,jsonb)', 'EXECUTE') then
    raise exception 'authenticated role is missing an intentional SmartScan RPC grant';
  end if;
  if (select count(*) from public.smartscan_scan_review_audit) <> 1 then
    raise exception 'review audit replay created a duplicate row';
  end if;
  if exists (
    select 1 from public.smartscan_scan_review_audit
    where item_number <> 7 or omr_row_number <> 1 or corrected_answer <> 'B'
  ) then
    raise exception 'review audit lost item identity or corrected answer';
  end if;
  if has_table_privilege('authenticated', 'public.smartscan_scan_review_audit', 'INSERT')
     or has_table_privilege('authenticated', 'public.smartscan_scan_review_audit', 'UPDATE')
     or has_table_privilege('authenticated', 'public.smartscan_scan_review_audit', 'DELETE') then
    raise exception 'review audit is not append-only at the client privilege boundary';
  end if;
  if (select count(*) from public.smartscan_submission_review_events) <> 1 then
    raise exception 'submission resolution replay created duplicate evidence';
  end if;
  if not exists (
    select 1 from public.smartscan_scan_submissions
    where scan_id = 'scan-unreadable-0001'
      and review_status = 'reviewed'
      and corrected_by_teacher = true
      and is_official = false
      and resolved_at is not null
  ) then
    raise exception 'submission did not enter the reviewed lifecycle state';
  end if;
  if has_table_privilege('authenticated', 'public.smartscan_submission_review_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.smartscan_submission_review_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.smartscan_submission_review_events', 'DELETE') then
    raise exception 'submission resolution evidence is not append-only';
  end if;
end
$$;

-- Lost-ack recovery: an exact committed scan retry returns its original
-- receipt even after the session expires. Reconstruct the immutable payload
-- from the ledger to guarantee byte-equivalent evidence.
reset role;
update public.smartscan_sessions
set status = 'expired', expires_at = now() - interval '1 hour'
where id = '22222222-2222-4222-8222-222222222222';
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

select * from public.commit_smartscan_submission((
  select jsonb_build_object(
    'scan_id', scan_id,
    'teacher_user_id', teacher_user_id,
    -- Exact replay uses the original client field. The Realtime scope trigger
    -- server-filled the stored tenant without changing that payload fingerprint.
    'school_id', null,
    'scan_session_id', scan_session_id,
    'assessment_id', assessment_id,
    'learner_id', learner_id,
    'learner_name', learner_name,
    'score', score,
    'total_items', total_items,
    'percentage', percentage,
    'scan_confidence', scan_confidence,
    'answer_map', answer_map,
    'item_results', item_results,
    'qr_payload', qr_payload,
    'scan_source', scan_source,
    'low_confidence_items', low_confidence_items,
    'review_status', 'needs_review',
    'is_official', false,
    'corrected_by_teacher', false
  )
  from public.smartscan_scan_submissions
  where scan_id = 'scan-unreadable-0001'
));

-- Restore a live session for the remaining compatibility/validation cases.
reset role;
update public.smartscan_sessions
set status = 'paired', expires_at = now() + interval '15 minutes'
where id = '22222222-2222-4222-8222-222222222222';
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

-- Older selected rows remain valid without unreadableChoices or newer image
-- metrics such as glareLevel, shadowLevel, printContrast, and obscured counts.
select * from public.commit_smartscan_submission(
  jsonb_build_object(
    'scan_id', 'scan-legacy-selected-0002',
    'teacher_user_id', '11111111-1111-4111-8111-111111111111',
    'scan_session_id', '22222222-2222-4222-8222-222222222222',
    'assessment_id', 'A1',
    'learner_id', 'L2',
    'score', 1,
    'total_items', 1,
    'percentage', 100,
    'scan_confidence', 0.95,
    'answer_map', jsonb_build_object('1', 'A'),
    'item_results', jsonb_build_array(jsonb_build_object(
      'item', 1, 'answer', 'A', 'status', 'selected', 'confidence', 0.95
    )),
    'qr_payload', jsonb_build_object(
      'version', 'A', 'assessmentId', 'A1', 'learnerId', 'L2',
      'sessionId', '22222222-2222-4222-8222-222222222222', 'itemCount', 1,
      'capturedAt', extract(epoch from now()) * 1000
    ),
    'review_status', 'needs_review', 'is_official', false, 'corrected_by_teacher', false
  )
);

-- Invalid/missing statuses and unreadable rows without choice evidence reject.
do $$
begin
  begin
    perform * from public.commit_smartscan_submission(
      jsonb_build_object(
        'scan_id', 'scan-invalid-status-0003',
        'teacher_user_id', '11111111-1111-4111-8111-111111111111',
        'scan_session_id', '22222222-2222-4222-8222-222222222222',
        'assessment_id', 'A1', 'learner_id', 'L3', 'score', 0,
        'total_items', 1, 'percentage', 0, 'scan_confidence', 0.2,
        'answer_map', jsonb_build_object('1', ''),
        'item_results', jsonb_build_array(jsonb_build_object(
          'item', 1, 'answer', '', 'status', 'guessed', 'confidence', 0.2
        )),
        'qr_payload', jsonb_build_object(
          'version', 'A', 'assessmentId', 'A1', 'learnerId', 'L3',
          'sessionId', '22222222-2222-4222-8222-222222222222', 'itemCount', 1,
          'capturedAt', extract(epoch from now()) * 1000
        ),
        'review_status', 'needs_review', 'is_official', false, 'corrected_by_teacher', false
      )
    );
    raise exception 'invalid status was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform * from public.commit_smartscan_submission(
      jsonb_build_object(
        'scan_id', 'scan-no-unreadable-evidence-0004',
        'teacher_user_id', '11111111-1111-4111-8111-111111111111',
        'scan_session_id', '22222222-2222-4222-8222-222222222222',
        'assessment_id', 'A1', 'learner_id', 'L4', 'score', 0,
        'total_items', 1, 'percentage', 0, 'scan_confidence', 0.1,
        'answer_map', jsonb_build_object('1', 'A'),
        'item_results', jsonb_build_array(jsonb_build_object(
          'item', 1, 'answer', 'A', 'status', 'unreadable', 'confidence', 0.1
        )),
        'qr_payload', jsonb_build_object(
          'version', 'A', 'assessmentId', 'A1', 'learnerId', 'L4',
          'sessionId', '22222222-2222-4222-8222-222222222222', 'itemCount', 1,
          'capturedAt', extract(epoch from now()) * 1000
        ),
        'review_status', 'needs_review', 'is_official', false, 'corrected_by_teacher', false
      )
    );
    raise exception 'unreadable row without affected choices was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform * from public.commit_smartscan_submission(
      jsonb_build_object(
        'scan_id', 'scan-invalid-lowconf-0005',
        'teacher_user_id', '11111111-1111-4111-8111-111111111111',
        'scan_session_id', '22222222-2222-4222-8222-222222222222',
        'assessment_id', 'A1', 'learner_id', 'L5', 'score', 1,
        'total_items', 1, 'percentage', 100, 'scan_confidence', 0.95,
        'answer_map', jsonb_build_object('1', 'A'),
        'item_results', jsonb_build_array(jsonb_build_object(
          'item', 1, 'answer', 'A', 'status', 'selected', 'confidence', 0.95
        )),
        'low_confidence_items', jsonb_build_array(2),
        'qr_payload', jsonb_build_object(
          'version', 'A', 'assessmentId', 'A1', 'learnerId', 'L5',
          'sessionId', '22222222-2222-4222-8222-222222222222', 'itemCount', 1,
          'capturedAt', extract(epoch from now()) * 1000
        ),
        'review_status', 'needs_review', 'is_official', false, 'corrected_by_teacher', false
      )
    );
    raise exception 'out-of-range low-confidence item was accepted';
  exception when sqlstate '22023' then
    null;
  end;
end
$$;

reset role;
