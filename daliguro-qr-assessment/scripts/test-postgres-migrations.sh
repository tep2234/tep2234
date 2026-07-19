#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
container="daliguro-postgres-test-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [[ -n "${race_tmp:-}" ]]; then
    rm -rf "$race_tmp"
  fi
}
trap cleanup EXIT

docker run --rm -d \
  --name "$container" \
  -e POSTGRES_PASSWORD=daliguro-test \
  postgres:17-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "$container" pg_isready -U postgres >/dev/null

docker cp "$repo_root/supabase/tests/postgres_bootstrap.sql" "$container:/tmp/0000_bootstrap.sql"
docker cp "$repo_root/supabase/migrations/0001_smartscan_sync.sql" "$container:/tmp/0001.sql"
docker cp "$repo_root/supabase/migrations/0002_phase1_scan_integrity.sql" "$container:/tmp/0002.sql"
docker cp "$repo_root/supabase/migrations/0003_unreadable_review_audit.sql" "$container:/tmp/0003.sql"
docker cp "$repo_root/supabase/migrations/20260713123518_smartscan_realtime_security.sql" "$container:/tmp/0004.sql"
docker cp "$repo_root/supabase/migrations/20260719000000_smartscan_verified_teacher_guard.sql" "$container:/tmp/0005.sql"
docker cp "$repo_root/supabase/tests/unreadable_contract.sql" "$container:/tmp/unreadable_contract.sql"
docker cp "$repo_root/supabase/tests/realtime_security_contract.sql" "$container:/tmp/realtime_security_contract.sql"
docker cp "$repo_root/supabase/tests/realtime_concurrency_fixture.sql" "$container:/tmp/realtime_concurrency_fixture.sql"
docker cp "$repo_root/supabase/tests/realtime_upgrade_fixture.sql" "$container:/tmp/realtime_upgrade_fixture.sql"
docker cp "$repo_root/supabase/tests/realtime_upgrade_contract.sql" "$container:/tmp/realtime_upgrade_contract.sql"
docker cp "$repo_root/supabase/tests/realtime_rollback_rehearsal.sql" "$container:/tmp/realtime_rollback_rehearsal.sql"
docker cp "$repo_root/supabase/tests/concurrency_fixture.sql" "$container:/tmp/concurrency_fixture.sql"
docker cp "$repo_root/supabase/tests/retry_lifecycle_contract.sql" "$container:/tmp/retry_lifecycle_contract.sql"

for sql in /tmp/0000_bootstrap.sql /tmp/0001.sql /tmp/0002.sql /tmp/0003.sql /tmp/0004.sql /tmp/0005.sql /tmp/realtime_security_contract.sql /tmp/unreadable_contract.sql /tmp/concurrency_fixture.sql /tmp/realtime_concurrency_fixture.sql; do
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$sql"
done

# Rehearse an upgrade containing rows produced by the legacy application.
docker exec "$container" createdb -U postgres smartscan_upgrade
for sql in /tmp/0000_bootstrap.sql /tmp/0001.sql /tmp/0002.sql /tmp/0003.sql /tmp/realtime_upgrade_fixture.sql; do
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d smartscan_upgrade -f "$sql"
done
docker exec "$container" psql -v ON_ERROR_STOP=1 --single-transaction -U postgres -d smartscan_upgrade -f /tmp/0004.sql
docker exec "$container" psql -v ON_ERROR_STOP=1 --single-transaction -U postgres -d smartscan_upgrade -f /tmp/0005.sql
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d smartscan_upgrade -f /tmp/realtime_upgrade_contract.sql

# Verify rollback is complete, then prove the same database can recover by
# applying the migration normally without losing the legacy fixture.
docker exec "$container" createdb -U postgres smartscan_rollback
for sql in /tmp/0000_bootstrap.sql /tmp/0001.sql /tmp/0002.sql /tmp/0003.sql /tmp/realtime_upgrade_fixture.sql; do
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d smartscan_rollback -f "$sql"
done
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d smartscan_rollback -f /tmp/realtime_rollback_rehearsal.sql
docker exec "$container" psql -v ON_ERROR_STOP=1 --single-transaction -U postgres -d smartscan_rollback -f /tmp/0004.sql
docker exec "$container" psql -v ON_ERROR_STOP=1 --single-transaction -U postgres -d smartscan_rollback -f /tmp/0005.sql
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d smartscan_rollback -f /tmp/realtime_upgrade_contract.sql

race_tmp="$(mktemp -d)"
auth_prefix="set role authenticated; select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',false);"

run_authenticated() {
  docker exec "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "$auth_prefix $1"
}

run_anon() {
  docker exec "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "set role anon; select set_config('request.jwt.claim.sub','',false); $1"
}

# Two phones racing the same one-time QR secret: exactly one claim succeeds.
set +e
run_anon "select capability from public.claim_smartscan_session('99999999-9999-4999-8999-999999999991',repeat('r',64),'Race phone A');" \
  >"$race_tmp/pair-claim-a" 2>"$race_tmp/pair-claim-a.err" &
pid_a="$!"
run_anon "select capability from public.claim_smartscan_session('99999999-9999-4999-8999-999999999991',repeat('r',64),'Race phone B');" \
  >"$race_tmp/pair-claim-b" 2>"$race_tmp/pair-claim-b.err" &
pid_b="$!"
wait "$pid_a"; status_a="$?"
wait "$pid_b"; status_b="$?"
set -e
if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
  echo "Expected exactly one concurrent pairing claim to succeed" >&2
  exit 1
fi

# Two capability holders racing the same next sequence cannot both persist.
set +e
run_anon "select inbox_receipt_id from public.submit_smartscan_phone_scan('99999999-9999-4999-8999-999999999992',repeat('q',64),'realtime-race-message-a',1,clock_timestamp(),public.test_realtime_race_payload('realtime-race-message-a'),encode(sha256(convert_to(public.test_realtime_race_payload('realtime-race-message-a'),'UTF8')),'hex'));" \
  >"$race_tmp/phone-submit-a" 2>"$race_tmp/phone-submit-a.err" &
pid_a="$!"
run_anon "select inbox_receipt_id from public.submit_smartscan_phone_scan('99999999-9999-4999-8999-999999999992',repeat('q',64),'realtime-race-message-b',1,clock_timestamp(),public.test_realtime_race_payload('realtime-race-message-b'),encode(sha256(convert_to(public.test_realtime_race_payload('realtime-race-message-b'),'UTF8')),'hex'));" \
  >"$race_tmp/phone-submit-b" 2>"$race_tmp/phone-submit-b.err" &
pid_b="$!"
wait "$pid_a"; status_a="$?"
wait "$pid_b"; status_b="$?"
set -e
if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
  echo "Expected exactly one same-sequence phone submission to succeed" >&2
  exit 1
fi
realtime_race_rows="$(docker exec "$container" psql -X -qAt -U postgres -d postgres -c \
  "select count(*) from public.smartscan_phone_submissions where session_id='99999999-9999-4999-8999-999999999992';")"
[[ "$realtime_race_rows" = "1" ]]

# Five genuinely concurrent identical transactions must all receive the one
# authoritative receipt and leave one ledger row.
pids=()
for index in $(seq 1 5); do
  run_authenticated "select receipt_id from public.commit_smartscan_submission(public.test_smartscan_submission('race-identical-0001','RACE-L1'));" \
    >"$race_tmp/identical-$index" 2>"$race_tmp/identical-$index.err" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done

identical_rows="$(docker exec "$container" psql -X -qAt -U postgres -d postgres -c \
  "select count(*) from public.smartscan_scan_submissions where teacher_user_id='66666666-6666-4666-8666-666666666666' and scan_id='race-identical-0001';")"
identical_receipts="$(awk '/^[0-9a-f-]{36}$/ { print }' "$race_tmp"/identical-* | sort -u | wc -l | tr -d ' ')"
[[ "$identical_rows" = "1" && "$identical_receipts" = "1" ]]

# Different scan ids for the same learner/version race for one pending slot.
# Exactly one succeeds; the loser must fail closed at the production RPC.
set +e
run_authenticated "select receipt_id from public.commit_smartscan_submission(public.test_smartscan_submission('race-conflict-a-0002','RACE-L2','A'));" \
  >"$race_tmp/conflict-a" 2>"$race_tmp/conflict-a.err" &
pid_a="$!"
run_authenticated "select receipt_id from public.commit_smartscan_submission(public.test_smartscan_submission('race-conflict-b-0003','RACE-L2','B'));" \
  >"$race_tmp/conflict-b" 2>"$race_tmp/conflict-b.err" &
pid_b="$!"
wait "$pid_a"; status_a="$?"
wait "$pid_b"; status_b="$?"
set -e
if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
  echo "Expected exactly one conflicting learner submission to succeed" >&2
  exit 1
fi
conflict_rows="$(docker exec "$container" psql -X -qAt -U postgres -d postgres -c \
  "select count(*) from public.smartscan_scan_submissions where teacher_user_id='66666666-6666-4666-8666-666666666666' and learner_id='RACE-L2' and review_status='needs_review';")"
[[ "$conflict_rows" = "1" ]]

# A correction and terminal resolution started together can never produce a
# reviewed row without its required item audit. If resolution wins the race it
# rejects and is retried only after the correction commits.
run_authenticated "select receipt_id from public.commit_smartscan_submission(public.test_smartscan_submission('race-review-0004','RACE-L3','A','unreadable',0.1));" >/dev/null
decision="jsonb_build_array(jsonb_build_object('eventId','88888888-8888-4888-8888-888888888888','omrRowNumber',1,'itemId','race-item-1','itemNumber',1,'originalStatus','unreadable','originalValue','A','correctedValue','A','source','review_queue','reason','Concurrent teacher review decision.'))"
resolution="jsonb_build_object('eventId','99999999-9999-4999-8999-999999999999','decision','reviewed','reason','Concurrent review resolution after required evidence.')"
set +e
run_authenticated "select audit_id from public.record_smartscan_review_decisions('race-review-0004',$decision);" \
  >"$race_tmp/review-audit" 2>"$race_tmp/review-audit.err" &
pid_a="$!"
run_authenticated "select resolution_id from public.resolve_smartscan_submission('race-review-0004',$resolution);" \
  >"$race_tmp/review-resolution" 2>"$race_tmp/review-resolution.err" &
pid_b="$!"
wait "$pid_a"; audit_status="$?"
wait "$pid_b"; resolution_status="$?"
set -e
[[ "$audit_status" -eq 0 ]]
if [[ "$resolution_status" -ne 0 ]]; then
  run_authenticated "select resolution_id from public.resolve_smartscan_submission('race-review-0004',$resolution);" >/dev/null
fi
review_integrity="$(docker exec "$container" psql -X -qAt -U postgres -d postgres -c \
  "select (s.review_status='reviewed' and count(a.id)=1 and count(e.id)=1)::int from public.smartscan_scan_submissions s left join public.smartscan_scan_review_audit a on a.submission_id=s.id left join public.smartscan_submission_review_events e on e.submission_id=s.id where s.scan_id='race-review-0004' group by s.review_status;")"
[[ "$review_integrity" = "1" ]]

# Two devices attempt different terminal decisions for one clean submission.
# The submission row lock and unique terminal event allow exactly one winner.
run_authenticated "select receipt_id from public.commit_smartscan_submission(public.test_smartscan_submission('race-two-reviewers-0011','RACE-L8'));" >/dev/null
set +e
run_authenticated "select resolution_id from public.resolve_smartscan_submission('race-two-reviewers-0011',jsonb_build_object('eventId','cccccccc-cccc-4ccc-8ccc-cccccccccccc','decision','reviewed','reason','First concurrent reviewer decision.'));" \
  >"$race_tmp/reviewer-a" 2>"$race_tmp/reviewer-a.err" &
pid_a="$!"
run_authenticated "select resolution_id from public.resolve_smartscan_submission('race-two-reviewers-0011',jsonb_build_object('eventId','dddddddd-dddd-4ddd-8ddd-dddddddddddd','decision','discarded','reason','Second concurrent reviewer decision.'));" \
  >"$race_tmp/reviewer-b" 2>"$race_tmp/reviewer-b.err" &
pid_b="$!"
wait "$pid_a"; status_a="$?"
wait "$pid_b"; status_b="$?"
set -e
if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
  echo "Expected exactly one concurrent terminal reviewer to succeed" >&2
  exit 1
fi
review_event_count="$(docker exec "$container" psql -X -qAt -U postgres -d postgres -c \
  "select count(*) from public.smartscan_submission_review_events where scan_id='race-two-reviewers-0011';")"
[[ "$review_event_count" = "1" ]]

docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/retry_lifecycle_contract.sql

echo "SmartScan PostgreSQL certification passed: clean install, legacy upgrade, rollback/recovery, one-time pairing race, sequence serialization, receipt idempotency, correction ordering, competing reviewers, expiry recovery, and pending-slot release."
