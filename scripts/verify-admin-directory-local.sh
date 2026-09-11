#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${BYUS_ADMIN_DIRECTORY_INNER:-}" != "1" ]]; then
  EVIDENCE_ROOT="${BYUS_ADMIN_DIRECTORY_EVIDENCE_DIR:-/tmp/byus-admin-directory-evidence}"
  RUN_DIR="$EVIDENCE_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -p "$RUN_DIR"
  export BYUS_ADMIN_DIRECTORY_RUN_DIR="$RUN_DIR"

  BYUS_ADMIN_DIRECTORY_INNER=1 \
  BYUS_CLEAN_DB_PORT=55443 \
  BYUS_CLEAN_DB_ASSERTION_FILE="$ROOT_DIR/supabase/tests/admin_directory.sql" \
  BYUS_CLEAN_DB_SHELL_ASSERTION_FILE="$ROOT_DIR/scripts/verify-admin-directory-local.sh" \
    bash "$ROOT_DIR/scripts/verify-clean-migration-chain.sh" \
      2>&1 | tee "$RUN_DIR/clean-migration-and-contract.log"

  printf '%s\n' "$RUN_DIR"
  exit 0
fi

: "${PGHOST:?PGHOST is required for the inner concurrency check}"
: "${PGPORT:?PGPORT is required for the inner concurrency check}"
: "${PGDATABASE:?PGDATABASE is required for the inner concurrency check}"

EXPECTED_SOCKET="$PGHOST/.s.PGSQL.$PGPORT"
if [[ "$PGPORT" != "55443" || "$PGDATABASE" != "byus_clean"
      || "$PGHOST" != /* || ! -S "$EXPECTED_SOCKET" ]]; then
  echo "inner admin-directory verification requires the disposable byus_clean Unix socket on port 55443" >&2
  exit 1
fi

RUN_DIR="${BYUS_ADMIN_DIRECTORY_RUN_DIR:-/tmp/byus-admin-directory-evidence/inner-$$}"
mkdir -p "$RUN_DIR"

ACTOR_A="d1000000-0000-4000-8000-000000000001"
ACTOR_B="d1000000-0000-4000-8000-000000000002"
ALLOW_A="d2000000-0000-4000-8000-000000000001"
ALLOW_B="d2000000-0000-4000-8000-000000000002"

psql -X -v ON_ERROR_STOP=1 <<SQL >"$RUN_DIR/concurrency-fixture.log"
insert into public.app_users(id,privy_user_id,verified_email,status) values
  ('$ACTOR_A','did:privy:admin-directory-race-a','race-a@example.invalid','active'),
  ('$ACTOR_B','did:privy:admin-directory-race-b','race-b@example.invalid','active');
insert into public.admin_allowlist(id,email,role,active) values
  ('$ALLOW_A','race-a@example.invalid','admin',true),
  ('$ALLOW_B','race-b@example.invalid','admin',true);
SQL

EXPECTED_A="$(psql -X -Atqc "select updated_at from public.admin_allowlist where id='$ALLOW_A'")"
EXPECTED_B="$(psql -X -Atqc "select updated_at from public.admin_allowlist where id='$ALLOW_B'")"

HOLDER_FIFO="$RUN_DIR/race-holder.sql.fifo"
mkfifo "$HOLDER_FIFO"
psql -X -v ON_ERROR_STOP=1 \
  -v expected_b="$EXPECTED_B" <"$HOLDER_FIFO" \
  >"$RUN_DIR/race-holder.log" 2>"$RUN_DIR/race-holder.err" &
HOLDER_PID=$!
exec 9>"$HOLDER_FIFO"
printf '%s\n' \
  'begin;' \
  'set local role service_role;' \
  'select pg_catalog.pg_advisory_xact_lock(5215997671129202561);' \
  '\echo LOCKED' >&9

for _ in $(seq 1 100); do
  if grep -q '^LOCKED$' "$RUN_DIR/race-holder.log" 2>/dev/null; then
    break
  fi
  sleep 0.05
done
if ! grep -q '^LOCKED$' "$RUN_DIR/race-holder.log" 2>/dev/null; then
  exec 9>&-
  wait "$HOLDER_PID" || true
  echo "concurrency lock holder did not become ready" >&2
  exit 1
fi

LOSER_STATUS=0
PGAPPNAME="byus-admin-directory-waiter" \
psql -X -v ON_ERROR_STOP=1 \
  -v expected_a="$EXPECTED_A" <<SQL >"$RUN_DIR/race-waiter.log" 2>"$RUN_DIR/race-waiter.err" &
begin;
set local role service_role;
select public.update_admin_directory_entry(
  '$ACTOR_B', '$ALLOW_B', 'd3000000-0000-4000-8000-000000000002',
  '$ALLOW_A', 'admin', false, :'expected_a'::timestamptz
);
commit;
SQL
WAITER_PID=$!

for _ in $(seq 1 100); do
  if psql -X -Atqc "select count(*) from pg_stat_activity where application_name='byus-admin-directory-waiter' and wait_event_type='Lock' and lower(coalesce(wait_event,'')) like '%advisory%'" \
      | grep -q '^1$'; then
    break
  fi
  sleep 0.05
done
WAIT_OBSERVED="$(psql -X -Atqc "select count(*) from pg_stat_activity where application_name='byus-admin-directory-waiter' and wait_event_type='Lock' and lower(coalesce(wait_event,'')) like '%advisory%'")"
printf 'advisoryWaiters=%s\n' "$WAIT_OBSERVED" | tee "$RUN_DIR/race-wait-observed.log"
if [[ "$WAIT_OBSERVED" != "1" ]]; then
  exec 9>&-
  wait "$HOLDER_PID" || true
  wait "$WAITER_PID" || true
  echo "competing admin mutation was not observed waiting on the advisory lock" >&2
  exit 1
fi

printf '%s\n' \
  "select public.update_admin_directory_entry('$ACTOR_A','$ALLOW_A','d3000000-0000-4000-8000-000000000001','$ALLOW_B','operator',true,:'expected_b'::timestamptz);" \
  'commit;' \
  '\q' >&9
exec 9>&-

wait "$HOLDER_PID"
wait "$WAITER_PID" || LOSER_STATUS=$?

if [[ "$LOSER_STATUS" -eq 0 ]]; then
  echo "revoked actor unexpectedly mutated the other admin after waiting" >&2
  exit 1
fi
if ! grep -q 'ADMIN_DIRECTORY_FORBIDDEN' "$RUN_DIR/race-waiter.err"; then
  echo "waiting actor did not fail with ADMIN_DIRECTORY_FORBIDDEN" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 <<SQL | tee "$RUN_DIR/concurrency-result.log"
do \$\$
begin
  if (select role from public.admin_allowlist where id='$ALLOW_B') <> 'operator'
     or not (select active from public.admin_allowlist where id='$ALLOW_B') then
    raise exception 'lock holder did not demote the competing actor';
  end if;
  if (select role from public.admin_allowlist where id='$ALLOW_A') <> 'admin'
     or not (select active from public.admin_allowlist where id='$ALLOW_A') then
    raise exception 'revoked waiter changed the surviving admin';
  end if;
  if (select count(*) from public.audit_logs
      where correlation_id in (
        'd3000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002'
      )) <> 1 then
    raise exception 'parallel mutation audit cardinality is wrong';
  end if;
end
\$\$;
select jsonb_build_object(
  'status','PASS',
  'parallelWinner','demote-competing-actor',
  'parallelLoser','ADMIN_DIRECTORY_FORBIDDEN-after-lock-wait',
  'auditRows',1
) as admin_directory_concurrency_result;
SQL
