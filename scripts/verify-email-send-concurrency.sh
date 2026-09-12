#!/usr/bin/env bash
set -euo pipefail
if [[ "${BYUS_EMAIL_SAFETY_TEST_SENTINEL:-}" != "email-send-safety-clean-replay" || "${PGDATABASE:-}" != "byus_clean" || "${PGHOST:-}" != /*/byus-clean-db.*/socket || ! -d "$PGHOST" ]]; then
  echo "Email concurrency checks require the disposable clean-replay socket and sentinel" >&2
  exit 1
fi
python3 - <<'PY'
from concurrent.futures import ThreadPoolExecutor
import subprocess

def sql(query):
    return subprocess.check_output(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',query],text=True).strip()

with ThreadPoolExecutor(max_workers=2) as pool:
    outcomes=list(pool.map(sql,["select alert_safety_test.begin(job) from alert_safety_test.race_job"]*2))
assert sorted(outcomes)==['f','t'],outcomes
assert sql("select count(*) from public.email_notification_send_attempts where delivery_id=(select (job->>'id')::uuid from alert_safety_test.race_job)")=='1'
assert sql("select alert_safety_test.begin(job) from alert_safety_test.race_job")=='f'
print('Email concurrent begin: one permission, one durable attempt, replay denied PASS')
PY
