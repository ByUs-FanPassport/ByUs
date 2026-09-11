#!/usr/bin/env bash
set -euo pipefail
# Refuse mutations unless this is the clean replay harness's local socket.
if [[ "${BYUS_KAKAO_TEST_SENTINEL:-}" != "kakao-alimtalk-clean-replay" || "${PGDATABASE:-}" != "byus_clean" ]]; then
  echo "Kakao concurrency checks require the disposable replay sentinel" >&2; exit 1
fi
if [[ "${PGHOST:-}" != /*/byus-clean-db.*/socket || ! -d "$PGHOST" ]]; then
  echo "Kakao concurrency checks require the disposable local socket" >&2; exit 1
fi
python3 - <<'PY'
import json, os, subprocess, time
base=['psql','-X','-v','ON_ERROR_STOP=1','-Atq']
def sql(s):
    return subprocess.check_output(base+['-c',s],text=True).strip()
assert sql("select current_database() || '|' || case when inet_server_addr() is null then 'local' else 'remote' end")=="byus_clean|local"
assert sql("select count(*) from kakao_test.jobs where case_name in ('race-begin','revoke-first','begin-first')")=="3"
sql("select count(*) from public.claim_kakao_notification_deliveries('race-worker',2,60)")
sql("select count(*) from public.claim_kakao_notification_deliveries('race-worker',2,60)")
def job(name):
    return json.loads(sql("select json_build_object('id',j.delivery_id,'owner',j.app_user_id,'channel',j.channel_id,'token',a.attempt_token,'template',a.template_id) from kakao_test.jobs j join public.kakao_notification_attempts a on a.delivery_id=j.delivery_id where case_name='"+name+"'"))
def begin(j):
    return "select public.begin_kakao_notification_send('%s','%s','%s',repeat('e',64));"%(j['id'],j['token'],j['template'])
def revoke(j):
    return "select public.set_owned_notification_channel_consent('%s','%s',false,'kakao-alimtalk-v1') is not null;"%(j['owner'],j['channel'])
def race(first,second,expected):
    holder=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    holder.stdin.write('begin;\n'+first+'\n\\echo LOCK_HELD\n');holder.stdin.flush()
    first_result=holder.stdout.readline().strip()
    assert first_result=='t',('first operation failed',first_result)
    assert holder.stdout.readline().strip()=='LOCK_HELD'
    env={**os.environ,'PGAPPNAME':'kakao-test-racer'}
    racer=subprocess.Popen(base+['-c',second],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
    try:
        deadline=time.monotonic()+5
        while sql("select count(*) from pg_stat_activity where application_name='kakao-test-racer' and wait_event_type='Lock'")!='1':
            if racer.poll() is not None: raise AssertionError('second operation did not wait on owner lock')
            if time.monotonic()>deadline: raise AssertionError('owner-lock wait not observed')
            time.sleep(.03)
        holder.stdin.write('commit;\n\\q\n');holder.stdin.flush()
        assert holder.wait(timeout=5)==0,holder.stderr.read()
        output,err=racer.communicate(timeout=5)
        assert racer.returncode==0,err
        assert output.strip()==expected,(output,expected)
    finally:
        for p in [holder,racer]:
            if p.poll() is None:p.kill()
j=job('race-begin');race(begin(j),begin(j),'f')
assert sql("select attempt_count from public.external_notification_delivery_outbox where id='%s'"%j['id'])=='1'
j=job('revoke-first');race(revoke(j),begin(j),'f')
assert sql("select status from public.kakao_notification_attempts where delivery_id='%s'"%j['id'])=='suppressed'
j=job('begin-first');race(begin(j),revoke(j),'t')
assert sql("select status from public.kakao_notification_attempts where delivery_id='%s'"%j['id'])=='sending'
assert sql("select count(*) from public.fan_notification_channel_private where channel_id='%s'"%j['channel'])=='0'
assert sql("select count(*) from public.claim_kakao_notification_deliveries('race-worker',2,60)")=='0'
print('Kakao concurrent single-begin, revoke-first, begin-first: PASS (observed owner-lock waits)')
PY
