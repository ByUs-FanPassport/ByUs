#!/usr/bin/env bash
set -euo pipefail

if [[ "${BYUS_PHONE_SMS_TEST_SENTINEL:-}" != "phone-sms-clean-replay" || "${PGDATABASE:-}" != "byus_clean" ]]; then
  echo "Phone SMS concurrency checks require the disposable replay sentinel" >&2
  exit 1
fi
if [[ "${PGHOST:-}" != /*/byus-clean-db.*/socket || ! -d "$PGHOST" ]]; then
  echo "Phone SMS concurrency checks require the disposable local socket" >&2
  exit 1
fi

python3 - <<'PY'
import json, os, subprocess, time

base = ['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-Atq']
def sql(statement, role=False):
    prefix = 'set role service_role; ' if role else ''
    return subprocess.check_output(base + ['-c', prefix + statement], text=True).strip()

assert sql("select current_database()||'|'||case when inet_server_addr() is null then 'local' else 'remote' end") == 'byus_clean|local'

owners = [f'93000000-0000-4000-8000-{i:012d}' for i in range(1, 9)]
values = ','.join(f"('{owner}','did:privy:sms-race-{i}','sms-race-{i}@example.invalid')" for i, owner in enumerate(owners, 1))
sql(f"insert into public.app_users(id,privy_user_id,verified_email) values {values}")

def digest(char): return char * 64
def reserve(owner, challenge, request, phone, key, otp):
    return ("select public.reserve_owned_phone_sms_challenge("+
            f"'{owner}','{challenge}','{request}','{phone}','{key}','{otp}')")

def simultaneous(commands, app_prefix, allow_error=False):
    blocker = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    blocker.stdin.write("begin;\nselect pg_advisory_xact_lock(7142,100);\n\\echo LOCK_HELD\n")
    blocker.stdin.flush()
    assert blocker.stdout.readline().strip() == ''
    assert blocker.stdout.readline().strip() == 'LOCK_HELD'
    racers = []
    for index, command in enumerate(commands):
        env = {**os.environ, 'PGAPPNAME': f'{app_prefix}-{index}'}
        racers.append(subprocess.Popen(base + ['-c', 'set role service_role; ' + command],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env))
    deadline = time.monotonic() + 5
    while True:
        waiting = int(sql(f"select count(*) from pg_stat_activity where application_name like '{app_prefix}-%' and wait_event='advisory'"))
        if waiting == len(racers): break
        if any(process.poll() is not None for process in racers): raise AssertionError('racer completed before advisory barrier')
        if time.monotonic() > deadline: raise AssertionError('advisory waits not observed')
        time.sleep(.03)
    blocker.stdin.write('commit;\n\\q\n'); blocker.stdin.flush()
    assert blocker.wait(timeout=5) == 0, blocker.stderr.read()
    results = []
    for process in racers:
        output, error = process.communicate(timeout=5)
        if not allow_error: assert process.returncode == 0, error
        results.append((process.returncode, output.strip(), error.strip()))
    return results

# Two simultaneous calls with one owner request key create one row; the loser
# receives the existing challenge and never receives another send permission.
request = '93000000-0000-4000-8000-000000000101'
commands = [reserve(owners[0], f'93000000-0000-4000-8000-00000000011{i}', request,
                    '01070000001', digest('a'), digest('b')) + "->>'created'" for i in (1, 2)]
results = simultaneous(commands, 'phone-sms-idempotency')
assert sorted(result[1] for result in results) == ['false', 'true'], results
assert sql(f"select count(*) from public.phone_sms_verification_challenges where app_user_id='{owners[0]}' and request_id='{request}'") == '1'
challenge = sql(f"select id from public.phone_sms_verification_challenges where app_user_id='{owners[0]}' and request_id='{request}'")

# Concurrent begin calls serialize on the owner and only one wins the send CAS.
begin_commands = [f"select public.begin_phone_sms_send('{owners[0]}','{challenge}')" for _ in range(2)]
processes = [subprocess.Popen(base + ['-c', 'set role service_role; ' + command], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
             for command in begin_commands]
begin_results = []
for process in processes:
    output, error = process.communicate(timeout=5)
    assert process.returncode == 0, error
    begin_results.append(output.strip())
assert sorted(begin_results) == ['f', 't'], begin_results

# Seed two phone events outside cooldown but inside ten minutes. Of two queued
# contenders for the third slot, the global ledger lock admits exactly one.
for i in range(2):
    seeded = f'93000000-0000-4000-8000-00000000012{i+1}'
    sql(f"insert into public.phone_sms_verification_challenges(id,app_user_id,request_id,phone,phone_rate_key,otp_digest,created_at,expires_at,resend_at) values ('{seeded}','{owners[i+1]}','93000000-0000-4000-8000-00000000013{i+1}','01070000002','{digest('c')}','{digest('d')}',now()-interval '2 minutes',now()+interval '3 minutes',now()-interval '1 minute'); insert into public.phone_sms_rate_limit_events(challenge_id,app_user_id,phone_rate_key,reserved_at) values ('{seeded}','{owners[i+1]}','{digest('c')}',now()-interval '2 minutes')")
quota_commands = [reserve(owners[i+3], f'93000000-0000-4000-8000-00000000014{i}',
                          f'93000000-0000-4000-8000-00000000015{i}', '01070000002', digest('c'), digest('e'))
                  for i in range(2)]
quota_results = simultaneous(quota_commands, 'phone-sms-quota', allow_error=True)
assert sorted(result[0] == 0 for result in quota_results) == [False, True], quota_results
assert any(('PHONE_SMS_RATE_LIMIT_10_MIN' in result[2] or 'PHONE_SMS_COOLDOWN' in result[2])
           for result in quota_results if result[0] != 0), quota_results
assert sql(f"select count(*) from public.phone_sms_rate_limit_events where phone_rate_key='{digest('c')}'") == '3'

# Confirm and cancel take the same owner lock. Exactly one consumes or cancels
# the proof, and neither outcome can leave raw phone or digest data behind.
owner = owners[6]
challenge = '93000000-0000-4000-8000-000000000160'
request = '93000000-0000-4000-8000-000000000161'
sql(reserve(owner, challenge, request, '01070000003', digest('f'), digest('1')), role=True)
assert sql(f"select public.begin_phone_sms_send('{owner}','{challenge}')", role=True) == 't'
assert json.loads(sql(f"select public.verify_owned_phone_sms_challenge('{owner}','{challenge}','{digest('1')}')", role=True))['verified'] is True
race_commands = [
    f"do $$ begin perform public.confirm_owned_phone_sms_enrollment('{owner}','{challenge}','kakao-alimtalk-v1'); raise notice 'RACE_RESULT:t'; exception when others then raise notice 'RACE_RESULT:f'; end $$",
    f"do $$ begin if public.cancel_owned_phone_sms_challenge('{owner}','{challenge}') then raise notice 'RACE_RESULT:t'; else raise notice 'RACE_RESULT:f'; end if; end $$"
]
processes = [subprocess.Popen(base + ['-c', 'set role service_role; ' + command], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
             for command in race_commands]
race_results = []
for process in processes:
    output, error = process.communicate(timeout=5)
    assert process.returncode == 0, error
    race_results.append('t' if 'RACE_RESULT:t' in error else 'f')
assert sorted(race_results) == ['f', 't'], race_results
assert sql(f"select (phone is null and otp_digest is null)::text from public.phone_sms_verification_challenges where id='{challenge}'") == 'true'

def prepare_replacement(owner, prefix, first_phone, second_phone):
    first_challenge = f'93000000-0000-4000-8000-000000000{prefix}1'
    second_challenge = f'93000000-0000-4000-8000-000000000{prefix}2'
    first_request = f'93000000-0000-4000-8000-000000000{prefix}3'
    second_request = f'93000000-0000-4000-8000-000000000{prefix}4'
    channel = sql(f"select phone_sms_test.enroll('{owner}','{first_challenge}','{first_request}','{first_phone}','race-first-{prefix}')")
    sql(f"update public.phone_sms_rate_limit_events set reserved_at=now()-interval '2 minutes' where challenge_id='{first_challenge}'")
    rate_key = digest('2' if prefix == '17' else '4')
    sql(reserve(owner, second_challenge, second_request, second_phone, rate_key, digest('3')), role=True)
    assert sql(f"select public.begin_phone_sms_send('{owner}','{second_challenge}')", role=True) == 't'
    assert json.loads(sql(f"select public.verify_owned_phone_sms_challenge('{owner}','{second_challenge}','{digest('3')}')", role=True))['verified'] is True
    return channel, second_challenge

def owner_serialized(first_sql, second_sql, app_name, first_service=True, second_service=True, second_may_fail=False):
    holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    holder.stdin.write('begin;\n' + ('set role service_role;\n' if first_service else '') + first_sql + '\n\\echo OWNER_LOCK_HELD\n')
    holder.stdin.flush()
    first_result = holder.stdout.readline().strip()
    assert first_result, holder.stderr.read()
    assert holder.stdout.readline().strip() == 'OWNER_LOCK_HELD'
    env = {**os.environ, 'PGAPPNAME': app_name}
    second = subprocess.Popen(base + ['-c', ('set role service_role; ' if second_service else '') + second_sql],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    deadline = time.monotonic() + 5
    while sql(f"select count(*) from pg_stat_activity where application_name='{app_name}' and wait_event_type='Lock'") != '1':
        if second.poll() is not None: raise AssertionError('owner racer did not wait')
        if time.monotonic() > deadline: raise AssertionError('owner lock wait not observed')
        time.sleep(.03)
    holder.stdin.write('commit;\n\\q\n'); holder.stdin.flush()
    assert holder.wait(timeout=5) == 0, holder.stderr.read()
    output, error = second.communicate(timeout=5)
    if second_may_fail: assert second.returncode != 0, (output, error)
    else: assert second.returncode == 0, error
    return first_result, output.strip(), error.strip()

# A consent withdrawal queued behind a successful replacement confirmation
# revokes that new destination. There is no gap in which stale consent wins.
owner = owners[5]
channel, challenge = prepare_replacement(owner, '17', '01070000004', '01070000005')
owner_serialized(
    f"select public.confirm_owned_phone_sms_enrollment('{owner}','{challenge}','kakao-alimtalk-v1') is not null;",
    f"select public.set_owned_notification_channel_consent('{owner}','{channel}',false,'kakao-alimtalk-v1') is not null;",
    'phone-sms-confirm-withdraw')
assert sql(f"select (status='disabled' and verification_method is null)::text from public.fan_notification_channels where id='{channel}'") == 'true'
assert sql(f"select count(*) from public.fan_notification_channel_private where channel_id='{channel}'") == '0'

# Account disable takes the owner row first and its trigger purges the pending
# verified proof. The blocked confirmation fails after the disable commits.
owner = owners[7]
channel, challenge = prepare_replacement(owner, '18', '01070000006', '01070000007')
owner_serialized(
    f"update public.app_users set status='disabled' where id='{owner}' returning true;",
    f"select public.confirm_owned_phone_sms_enrollment('{owner}','{challenge}','kakao-alimtalk-v1') is not null;",
    'phone-sms-disable-confirm', first_service=False, second_may_fail=True)
assert sql(f"select (status='disabled' and verification_method is null)::text from public.fan_notification_channels where id='{channel}'") == 'true'
assert sql(f"select (phone is null and otp_digest is null and cancelled_at is not null)::text from public.phone_sms_verification_challenges where id='{challenge}'") == 'true'

print('Phone SMS idempotency, quota, single-begin, confirm/cancel, confirm/withdraw and disable/confirm races: PASS (observed lock waits)')
PY
