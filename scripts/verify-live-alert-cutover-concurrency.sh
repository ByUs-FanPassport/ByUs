#!/usr/bin/env bash
set -euo pipefail
if [[ "${BYUS_EMAIL_SAFETY_TEST_SENTINEL:-}" != "email-send-safety-clean-replay" || "${PGDATABASE:-}" != "byus_clean" || "${PGHOST:-}" != /*/byus-clean-db.*/socket || ! -d "$PGHOST" ]]; then
  echo "Cutover checks require the disposable local replay harness" >&2; exit 1
fi
python3 - <<'PY'
import json,os,subprocess,time
base=['psql','-X','-v','ON_ERROR_STOP=1','-Atq']
def sql(s):return subprocess.check_output(base+['-c',s],text=True).strip()
assert sql("select current_database() || '|' || case when inet_server_addr() is null then 'local' else 'remote' end")=='byus_clean|local'
def job(ch):
    sql("select public.configure_fan_notification_delivery('%s','enabled')"%ch)
    n=sql("select alert_safety_test.notification(alert_safety_test.owner('%s',%s))"%('en' if ch=='email' else 'ko','false' if ch=='email' else 'true'))
    fn='claim_email_notification_deliveries_safely' if ch=='email' else 'claim_kakao_notification_deliveries'
    j=json.loads(sql("select to_jsonb(q) from public.%s('cutover-race',2,120) q where notification_id='%s'"%(fn,n)))
    if ch=='email':
        fingerprint=sql("select encode(extensions.digest('%s','sha256'),'hex')"%j['destination'])
        begin="select public.begin_email_notification_send('%s','cutover-race',%s,'%s');"%(j['id'],j['attempt_count'],fingerprint)
    else:
        begin="select public.begin_kakao_notification_send('%s','%s','%s',repeat('e',64));"%(j['id'],j['attempt_token'],j['template_id'])
    return j,begin

def race(first,second,expected):
    holder=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    holder.stdin.write('begin;\n'+first+'\n\\echo LOCK_HELD\n');holder.stdin.flush()
    assert holder.stdout.readline().strip()=='t'
    assert holder.stdout.readline().strip()=='LOCK_HELD'
    racer=subprocess.Popen(base+['-c',second],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,'PGAPPNAME':'cutover-test-racer'})
    try:
        deadline=time.monotonic()+5
        while sql("select count(*) from pg_stat_activity where application_name='cutover-test-racer' and wait_event_type='Lock'")!='1':
            assert racer.poll() is None,'racer skipped control lock'
            assert time.monotonic()<deadline,'control lock wait not observed'
            time.sleep(.03)
        holder.stdin.write('commit;\n\\q\n');holder.stdin.flush()
        assert holder.wait(timeout=5)==0,holder.stderr.read()
        output,err=racer.communicate(timeout=5)
        assert racer.returncode==0,err
        assert output.strip()==expected,(output,expected)
    finally:
        for p in [holder,racer]:
            if p.poll() is None:p.kill()
for ch in ('email','kakao'):
    pause="select public.configure_fan_notification_delivery('%s','disabled') is not null;"%ch
    j,begin=job(ch)
    snapshot="select md5(to_jsonb(d)::text) from public.external_notification_delivery_outbox d where id='%s'"%j['id']
    before=sql(snapshot);race(pause,begin,'f');assert sql(snapshot)==before,'pause-first changed pending row'
    j,begin=job(ch);race(begin,pause,'t')
    table='email_notification_send_attempts' if ch=='email' else 'kakao_notification_attempts'
    assert sql("select status from public.%s where delivery_id='%s'"%(table,j['id']))=='sending'
print('Email/Kakao pause-first blocks begin; begin-first serializes pause: PASS (observed control-lock waits)')
PY
