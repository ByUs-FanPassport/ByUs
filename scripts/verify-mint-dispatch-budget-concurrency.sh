#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SENTINEL="mint-dispatch-budget-clean-replay"
if [[ "${BYUS_MINT_BUDGET_TEST_SENTINEL:-}" != "$EXPECTED_SENTINEL" ]]; then
  echo "Mint budget concurrency checks require the clean-replay sentinel" >&2
  exit 1
fi
if [[ "${PGDATABASE:-}" != "byus_clean" || "${PGPORT:-}" != "55472" ]]; then
  echo "Mint budget concurrency checks require byus_clean on port 55472" >&2
  exit 1
fi
if [[ "${PGHOST:-}" != /*/byus-clean-db.*/socket || ! -d "$PGHOST" ]]; then
  echo "Mint budget concurrency checks require the clean-replay local socket" >&2
  exit 1
fi

database_identity="$(psql -X -Atq -v ON_ERROR_STOP=1 -c \
  "select current_database() || '|' || case when pg_catalog.inet_server_addr() is null then 'local' else 'remote' end || '|' || current_setting('port')")"
if [[ "$database_identity" != "byus_clean|local|55472" ]]; then
  echo "Mint budget concurrency checks refused a non-local clean-replay database" >&2
  exit 1
fi

original_daily_limit="$(psql -X -Atq -v ON_ERROR_STOP=1 -c \
  "select daily_job_limit from public.mint_dispatch_policy where singleton")"
if [[ ! "$original_daily_limit" =~ ^[1-9][0-9]*$ ]]; then
  echo "Mint budget concurrency checks require one valid policy row" >&2
  exit 1
fi
existing_reservations="$(psql -X -Atq -v ON_ERROR_STOP=1 -c \
  "select pg_catalog.count(*) from public.mint_dispatch_budget_reservations")"
if [[ "$existing_reservations" != "0" ]]; then
  echo "Mint budget concurrency checks require a clean reservation table" >&2
  exit 1
fi

TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/byus-mint-budget.XXXXXX")"
JOB_A="00000000-0000-4000-8000-000000000301"
JOB_B="00000000-0000-4000-8000-000000000302"

cleanup() {
  psql -X -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL || true
delete from public.mint_dispatch_budget_reservations
where job_id in ('$JOB_A', '$JOB_B');
delete from public.blockchain_jobs where id in ('$JOB_A', '$JOB_B');
update public.mint_dispatch_policy
set daily_job_limit = $original_daily_limit
where singleton;
SQL
  find "$TEST_DIR" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql -X -v ON_ERROR_STOP=1 >/dev/null <<SQL
delete from public.mint_dispatch_budget_reservations
where job_id in ('$JOB_A', '$JOB_B');
delete from public.blockchain_jobs where id in ('$JOB_A', '$JOB_B');
update public.mint_dispatch_policy set daily_job_limit = 1 where singleton;
insert into public.blockchain_jobs (
  id, entity_type, entity_id, operation_key, payload, status, attempts,
  lease_owner, lease_expires_at
) values
  ('$JOB_A', 'passport', '00000000-0000-4000-8000-000000000401',
    'security:budget:concurrent-a', '{}', 'PROCESSING', 1,
    'concurrent-a', pg_catalog.clock_timestamp() + interval '10 minutes'),
  ('$JOB_B', 'passport', '00000000-0000-4000-8000-000000000402',
    'security:budget:concurrent-b', '{}', 'PROCESSING', 1,
    'concurrent-b', pg_catalog.clock_timestamp() + interval '10 minutes');
SQL

# Hold the singleton policy row so both admissions queue behind the same lock.
psql -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select daily_job_limit from public.mint_dispatch_policy where singleton for update;
select pg_catalog.pg_sleep(2);
commit;
SQL
blocker_pid=$!

lock_ready="f"
for _attempt in $(seq 1 100); do
  lock_ready="$(psql -X -Atq -v ON_ERROR_STOP=1 -c \
    "select pg_catalog.count(*) > 0 from pg_catalog.pg_locks lock join pg_catalog.pg_class relation on relation.oid = lock.relation where relation.oid = 'public.mint_dispatch_policy'::regclass and lock.mode = 'RowShareLock' and lock.granted")"
  [[ "$lock_ready" == "t" ]] && break
  sleep 0.02
done
if [[ "$lock_ready" != "t" ]]; then
  echo "Failed to establish the mint policy concurrency barrier" >&2
  exit 1
fi

psql -X -Atq -v ON_ERROR_STOP=1 -c \
  "set role service_role; select public.admit_mint_dispatch('$JOB_A', 'concurrent-a')" \
  >"$TEST_DIR/a.out" &
first_pid=$!
psql -X -Atq -v ON_ERROR_STOP=1 -c \
  "set role service_role; select public.admit_mint_dispatch('$JOB_B', 'concurrent-b')" \
  >"$TEST_DIR/b.out" &
second_pid=$!

wait "$blocker_pid"
wait "$first_pid"
wait "$second_pid"

if [[ "$(sort "$TEST_DIR/a.out" "$TEST_DIR/b.out" | tr '\n' ' ')" != "f t " ]]; then
  echo "Concurrent last-slot admissions did not produce exactly one admit and one hold" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 <<SQL
do \$\$
declare
  utc_day date := (pg_catalog.clock_timestamp() at time zone 'UTC')::date;
begin
  if (select pg_catalog.count(*) from public.mint_dispatch_budget_reservations
      where budget_day = utc_day and job_id in ('$JOB_A', '$JOB_B')) <> 1 then
    raise exception 'concurrent admission overbooked the final mint budget slot';
  end if;
  if (select pg_catalog.count(*) from public.blockchain_jobs
      where id in ('$JOB_A', '$JOB_B') and status = 'PROCESSING'
        and attempts = 1 and lease_owner is not null) <> 1 then
    raise exception 'concurrent admitted job did not retain its active lease';
  end if;
  if (select pg_catalog.count(*) from public.blockchain_jobs
      where id in ('$JOB_A', '$JOB_B') and status = 'RETRYING'
        and attempts = 0 and lease_owner is null and lease_expires_at is null
        and next_attempt_at = (((utc_day + 1)::timestamp) at time zone 'UTC')
        and last_error_code = 'MINT_DAILY_DISPATCH_LIMIT') <> 1 then
    raise exception 'concurrent blocked job consumed an attempt or missed UTC rollover';
  end if;
end;
\$\$;
SQL

echo "Mint dispatch budget concurrency checks passed"
