#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
psql -X -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/telegram_alert_capture.sql"
psql -X -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/telegram_alert_lifecycle.sql"
psql -X -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/telegram_operator_commands.sql"
psql -X -v ON_ERROR_STOP=1 -f "$root_dir/supabase/tests/cs_telegram_alerts.sql"
python3 <<'PY'
import concurrent.futures, json, subprocess, threading

def sql(query):
    return subprocess.check_output(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',query],text=True).strip()

def race(*queries):
    barrier=threading.Barrier(len(queries))
    def run(query):
        barrier.wait()
        return sql(query)
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as pool:
        return list(pool.map(run,queries))

def enqueue():
    sql("insert into public.telegram_alert_outbox(kind,source_id,activation_id,chat_id,occurred_at) select 'member_joined',gen_random_uuid(),activation_id,chat_id,clock_timestamp() from public.telegram_alert_settings")

sql("select public.configure_telegram_alerts('-100123',true)")
enqueue()
claims=race("select public.claim_telegram_alert_batch_with_cs('-100123')", "select public.claim_telegram_alert_batch_with_identity('-100123')")
assert sum(bool(x) for x in claims)==1, claims
token=json.loads(next(x for x in claims if x))['batch_id']
begins=race(f"select public.begin_telegram_alert_send('{token}','-100123')",f"select public.begin_telegram_alert_send('{token}','-100123')")
assert sorted(begins)==['f','t'],begins
sql(f"select public.finish_telegram_alert_batch('{token}','sent',123)")
sql("update public.telegram_alert_settings set next_send_at='-infinity'")
enqueue()
token=json.loads(sql("select public.claim_telegram_alert_batch_with_identity('-100123')"))['batch_id']
outcomes=race(f"select public.begin_telegram_alert_send('{token}','-100123')", "select public.configure_telegram_alerts('-100456',true)")
status=sql(f"select status from public.telegram_alert_outbox where batch_id='{token}'")
assert status==('sending' if outcomes[0]=='t' else 'skipped'), (outcomes,status)
assert sql(f"select public.begin_telegram_alert_send('{token}','-100123')")=='f'
assert sql("select public.claim_telegram_alert_batch_with_identity('-100456')")==''
sql("select public.configure_telegram_commands(true)")
stamp=sql("select floor(extract(epoch from clock_timestamp()))::bigint")
requests=race(f"select public.begin_telegram_command_reply('-100456',501,'users',{stamp})",
              f"select public.begin_telegram_command_reply('-100456',501,'users',{stamp})")
assert sum(bool(x) for x in requests)==1, 'Concurrent command allowed more than one reply'
race("select public.acknowledge_telegram_command_updates('-100456',502)",
     "select public.acknowledge_telegram_command_updates('-100456',500)")
assert json.loads(sql("select public.read_telegram_command_state('-100456')"))['last_update_id']==502
sql("delete from public.telegram_command_receipts; select public.configure_telegram_commands(false)")
sql("delete from public.telegram_alert_outbox; select public.configure_telegram_alerts(null,false)")
print('PASS Telegram two-session claim, begin, destination-switch, command dedupe and cursor races')
PY
