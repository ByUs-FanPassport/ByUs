#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${BYUS_COMMUNITY_STAMP_SHARE_RACE_MODE:-}" != "1" ]]; then
  BYUS_CLEAN_DB_PORT="${BYUS_CLEAN_DB_PORT:-55486}" \
  BYUS_COMMUNITY_STAMP_SHARE_RACE_MODE=1 \
  BYUS_CLEAN_DB_SHELL_ASSERTION_FILE="$ROOT_DIR/scripts/verify-community-stamp-share-concurrency.sh" \
    bash "$ROOT_DIR/scripts/verify-clean-migration-chain.sh"
  exit 0
fi

: "${PGHOST:?PGHOST is required in assertion mode}"
: "${PGPORT:?PGPORT is required in assertion mode}"
: "${PGDATABASE:?PGDATABASE is required in assertion mode}"
if [[ "$PGDATABASE" != "byus_clean" || "$PGHOST" != /*/byus-clean-db.*/socket
  || ! -d "$PGHOST" || ! -S "$PGHOST/.s.PGSQL.$PGPORT" ]]; then
  echo "Community stamp share concurrency verification refuses non-disposable PostgreSQL targets" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 \
  -f "$ROOT_DIR/supabase/tests/community_stamp_share_concurrency.sql" >/dev/null

python3 - <<'PY'
import json
import os
import subprocess
import time

base = ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-Atq"]

def sql(statement: str) -> str:
    return subprocess.check_output(base + ["-c", statement], text=True).strip()

def race(first: str, second: str, name: str) -> None:
    holder = subprocess.Popen(
        base,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**os.environ, "PGAPPNAME": f"{name}-holder"},
    )
    assert holder.stdin and holder.stdout and holder.stderr
    holder.stdin.write(f"begin;\n{first}\n\\echo HELD\n")
    holder.stdin.flush()
    first_result = holder.stdout.readline().strip()
    if holder.stdout.readline().strip() != "HELD":
        raise AssertionError(("holder did not reach the overlap point", holder.stderr.read()))

    racer = subprocess.Popen(
        base + ["-c", second],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={**os.environ, "PGAPPNAME": f"{name}-racer"},
    )
    deadline = time.monotonic() + 5
    while sql(
        "select count(*) from pg_catalog.pg_stat_activity "
        f"where application_name='{name}-racer' and wait_event_type='Lock'"
    ) != "1":
        if racer.poll() is not None:
            raise AssertionError(("racer ended before lock wait", racer.communicate()))
        if time.monotonic() > deadline:
            raise AssertionError("concurrent share visit did not enter a PostgreSQL lock wait")
        time.sleep(0.03)

    holder.stdin.write("commit;\n\\q\n")
    holder.stdin.flush()
    if holder.wait(timeout=5) != 0:
        raise AssertionError(holder.stderr.read())
    second_result, second_error = racer.communicate(timeout=5)
    if racer.returncode != 0:
        raise AssertionError((second_result, second_error))
    expected = {"creator": "community-share-race"}
    if json.loads(first_result) != expected or json.loads(second_result) != expected:
        raise AssertionError((first_result, second_result))

token_a = sql(
    "select token from public.community_share_race_tokens "
    "where owner_id='fc130000-0000-4000-8000-000000000011'"
)
token_b = sql(
    "select token from public.community_share_race_tokens "
    "where owner_id='fc130000-0000-4000-8000-000000000012'"
)
race(
    "select public.visit_community_stamp_share_link("
    f"'fc130000-0000-4000-8000-000000000021','{token_a}');",
    "select public.visit_community_stamp_share_link("
    f"'fc130000-0000-4000-8000-000000000021','{token_a}');",
    "share-same-visitor",
)
race(
    "select public.visit_community_stamp_share_link("
    f"'fc130000-0000-4000-8000-000000000021','{token_b}');",
    "select public.visit_community_stamp_share_link("
    f"'fc130000-0000-4000-8000-000000000022','{token_b}');",
    "share-distinct-visitors",
)
print("Community share same-visitor and creator-once lock races: PASS")
PY

psql -X -v ON_ERROR_STOP=1 \
  -c 'select public.assert_community_share_race_fixture() as community_share_race_result;'
