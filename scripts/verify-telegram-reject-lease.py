"""Disposable local DB only: reject must recheck time after acquiring its lock."""
import json
import os
import subprocess
import time

PSQL = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"]


def sql(query):
    return subprocess.check_output(PSQL + ["-c", query], text=True, timeout=15).strip()


assert sql("select current_database()='byus_clean' and inet_server_addr() is null") == "t"
sql("select public.configure_telegram_alerts('-1001234567890',true); "
    "update public.telegram_alert_settings set next_send_at='-infinity'; "
    "insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at) "
    "select 'business_received',gen_random_uuid(),activation_id,chat_id,clock_timestamp() "
    "from public.telegram_alert_settings")
batch = json.loads(sql("select public.claim_telegram_alert_batch_with_cs_content('-1001234567890')"))["batch_id"]
sql("update public.telegram_alert_settings set lease_expires_at=clock_timestamp()+interval '5 seconds'; "
    "update public.telegram_alert_outbox set lease_expires_at=clock_timestamp()+interval '5 seconds'")
snapshot = "select jsonb_build_object('settings',to_jsonb(s),'rows',(select jsonb_agg(to_jsonb(o) order by id) from public.telegram_alert_outbox o)) from public.telegram_alert_settings s"
before = json.loads(sql(snapshot))
locker = subprocess.Popen(PSQL, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
rejection = None
try:
    locker.stdin.write("set statement_timeout='10s'; begin; select 'LOCKED' from public.telegram_alert_settings where singleton for update;\n")
    locker.stdin.flush()
    assert locker.stdout.readline().strip() == "LOCKED"
    rejection = subprocess.Popen(PSQL + ["-c", f"set statement_timeout='10s'; select public.reject_telegram_alert_batch('{batch}','-1001234567890')"],
                                 text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 env={**os.environ, "PGAPPNAME": "telegram-reject-lease-test"})
    waiting = "select exists(select 1 from pg_stat_activity a cross join public.telegram_alert_settings s where a.application_name='telegram-reject-lease-test' and a.wait_event_type='Lock' and a.query_start<s.lease_expires_at)"
    for _ in range(40):
        if sql(waiting) == "t":
            break
        time.sleep(0.05)
    else:
        raise AssertionError("reject did not wait on the lock before lease expiry")
    sql("select pg_sleep(greatest(extract(epoch from lease_expires_at-clock_timestamp()),0)+0.1) from public.telegram_alert_settings")
    locker.stdin.write("commit;\n\\q\n")
    locker.stdin.flush()
    _, error = locker.communicate(timeout=10)
    assert locker.returncode == 0, error
    outcome, error = rejection.communicate(timeout=10)
    assert rejection.returncode == 0, error
    assert outcome.strip() == "f", "expired claimant changed the batch after waiting for the lock"
    assert json.loads(sql(snapshot)) == before, "expired rejection changed queue state"
finally:
    for child in (rejection, locker):
        if child is not None and child.poll() is None:
            child.kill()
            child.communicate(timeout=10)
    sql("delete from public.telegram_alert_outbox; select public.configure_telegram_alerts(null,false)")
print("PASS Telegram rejection waits for the lock, rejects the expired lease and preserves the batch")
