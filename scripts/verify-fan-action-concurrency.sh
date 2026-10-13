#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${BYUS_ACTION_CONCURRENCY_MODE:-}" != "1" ]]; then
  BYUS_CLEAN_DB_PORT="${BYUS_CLEAN_DB_PORT:-55515}" BYUS_ACTION_CONCURRENCY_MODE=1 \
    BYUS_CLEAN_DB_SHELL_ASSERTION_FILE="$ROOT_DIR/scripts/verify-fan-action-concurrency.sh" \
    bash "$ROOT_DIR/scripts/verify-clean-migration-chain.sh"
  exit 0
fi
: "${PGHOST:?}" "${PGPORT:?}" "${PGDATABASE:?}"
if [[ "$PGDATABASE" != "byus_clean" || "$PGHOST" != /*/byus-clean-db.*/socket || ! -S "$PGHOST/.s.PGSQL.$PGPORT" ]]; then
  echo "Refusing non-disposable database" >&2; exit 1
fi
python3 - <<'PY'
import concurrent.futures
import subprocess

base = ['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-Atq']
def sql(statement):
    return subprocess.check_output(base + ['-c', statement], text=True).strip()

sql("""
insert into public.app_users(id,privy_user_id,verified_email)
 values('e9130000-0000-4000-8000-000000000001','did:privy:action-concurrency','action-concurrency@example.test');
insert into public.fan_action_bindings(id,chain_id,environment_id,hub_proxy,relayer,schema_uid,schema_version,binding_version,asset_base_uri,assets)
 values('e9130000-0000-4000-8000-000000000002',91342,'0x'||repeat('1',64),'0x'||repeat('1',40),
 '0x'||repeat('2',40),'0x'||repeat('3',64),1,1,'ipfs://bafyfixture',jsonb_build_object('1','0x'||repeat('4',40)));
insert into public.fan_action_occurrences(id,source_namespace,canonical_source_key,app_user_id,source_occurred_at)
 values('e9130000-0000-4000-8000-000000000003','concurrency','1','e9130000-0000-4000-8000-000000000001',now());
insert into public.fan_action_outbox(id,occurrence_row_id,binding_id,revision,operation_kind,source_snapshot,status,lease_owner,lease_expires_at)
 values('e9130000-0000-4000-8000-000000000004','e9130000-0000-4000-8000-000000000003',
 'e9130000-0000-4000-8000-000000000002',1,'record_only','{}','PROCESSING','writer-a',now()+interval '5 minutes'),
 ('e9130000-0000-4000-8000-000000000005','e9130000-0000-4000-8000-000000000003',
 'e9130000-0000-4000-8000-000000000002',2,'record_only','{}','PROCESSING','writer-b',now()+interval '5 minutes');
""")
def race(pair):
    worker, last = pair
    return sql(f"select public.admit_chain_writer('fan_action','e9130000-0000-4000-8000-00000000000{last}','writer-{worker}',91342,'0x'||repeat('2',40),120)")

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(race, [('a',4),('b',5)]))
assert sorted(results) == ['f','t'], ('two nonce writers admitted',results)
assert sql('select count(*) from public.chain_writer_leases') == '1'
print('PASS: two concurrent sessions admit exactly one nonce writer')
# Race legacy minting and ActionHub against the same actual account lease.
sql("""
delete from public.chain_writer_leases;
update public.fan_action_outbox set status='PROCESSING',lease_owner='writer-a',lease_expires_at=now()+interval '5 minutes'
 where id='e9130000-0000-4000-8000-000000000004';
insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload_version,payload,status,lease_owner,lease_expires_at)
 values('e9130000-0000-4000-8000-000000000006','passport','e9130000-0000-4000-8000-000000000007',
 'byus:passport:v1:concurrency:legacy',1,jsonb_build_object('recipient','0x'||repeat('1',40),'celebritySlug','concurrency','passportId','0x'||repeat('4',64)),
 'PROCESSING','writer-legacy',now()+interval '5 minutes');
""")
def cross_lane(family):
    job, worker = ('4','a') if family == 'fan_action' else ('6','legacy')
    return sql(f"select public.admit_chain_writer('{family}','e9130000-0000-4000-8000-00000000000{job}','writer-{worker}',91342,'0x'||repeat('2',40),120)")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(cross_lane, ['fan_action','legacy']))
assert sorted(results) == ['f','t'], ('legacy/action writer collision',results)
print('PASS: concurrent legacy and action lanes admit exactly one nonce writer')

# Admission waits for the pause transaction even for signed, budget-reserved jobs.
sql("""
update public.fan_action_outbox set status='PROCESSING',lease_owner='writer-a',lease_expires_at=now()+interval '5 minutes',attempts=1,
 payload='{}',action_id='0x'||repeat('a',64),occurrence_id='0x'||repeat('b',64),request_hash='0x'||repeat('c',64),
 tx_hash='0x'||repeat('d',64),signed_transaction='0x1234' where id='e9130000-0000-4000-8000-000000000004';
update public.blockchain_jobs set status='PROCESSING',lease_owner='writer-legacy',lease_expires_at=now()+interval '5 minutes',attempts=1
 where id='e9130000-0000-4000-8000-000000000006';
insert into public.fan_action_dispatch_reservations values((clock_timestamp() at time zone 'UTC')::date,'e9130000-0000-4000-8000-000000000004');
insert into public.mint_dispatch_budget_reservations(budget_day,job_id) values((clock_timestamp() at time zone 'UTC')::date,'e9130000-0000-4000-8000-000000000006');
""")
pause = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
pause.stdin.write("begin; update public.mint_dispatch_policy set transmission_paused=true where singleton;\n\\echo PAUSE_LOCKED\n")
pause.stdin.flush()
assert pause.stdout.readline().strip() == 'PAUSE_LOCKED'
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    native = pool.submit(sql, "select public.admit_fan_action_dispatch('e9130000-0000-4000-8000-000000000004','writer-a')")
    legacy = pool.submit(sql, "select public.admit_mint_dispatch('e9130000-0000-4000-8000-000000000006','writer-legacy')")
    _, error = pause.communicate('commit;\n', timeout=10)
    assert pause.returncode == 0, error
    assert native.result(timeout=10) == legacy.result(timeout=10) == 'f'
assert sql("select attempts from public.fan_action_outbox where id='e9130000-0000-4000-8000-000000000004'") == '0'
assert sql("select attempts from public.blockchain_jobs where id='e9130000-0000-4000-8000-000000000006'") == '0'
sql('update public.mint_dispatch_policy set transmission_paused=false where singleton')
print('PASS: committed transmission pause blocks concurrent signed/reserved admissions without consuming retries')

# A source enqueued before route commit must keep v1 when replayed after v2 activates.
sql("""
insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
 values('e9130000-0000-4000-8000-000000000010','kyaa-route-race','published','/test.webp',now(),'{artist}','idol');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt)
 values('e9130000-0000-4000-8000-000000000010','ko','경쟁 검사','경쟁 검사','경쟁 검사'),
 ('e9130000-0000-4000-8000-000000000010','en','Route race','Route race','Route race');
insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
 values('e9130000-0000-4000-8000-000000000001',91342,'0x'||repeat('1',40),'privy','embedded');
insert into public.fan_action_bindings(id,chain_id,environment_id,hub_proxy,relayer,schema_uid,schema_version,binding_version,asset_base_uri,assets)
 select 'e9130000-0000-4000-8000-000000000012',chain_id,environment_id,hub_proxy,relayer,schema_uid,1,2,asset_base_uri,
 jsonb_build_object('1','0x'||repeat('5',40)) from public.fan_action_bindings where id='e9130000-0000-4000-8000-000000000002';
insert into public.fan_action_producer_routes(action_code,binding_id,enabled,policy_version,enabled_at)
 values(6,'e9130000-0000-4000-8000-000000000002',true,1,now());
""")
def enqueue(source, entity):
    return f"""select public.enqueue_fan_action_source('kyaa_route_race','{source}',
    'e9130000-0000-4000-8000-000000000001','e9130000-0000-4000-8000-000000000010',null,'2026-10-13T00:00:00Z',6,
    jsonb_build_array(jsonb_build_object('entityType','reaction','entityId','e9130000-0000-4000-8000-{entity}',
      'kind',1,'issuanceKey','0x'||repeat('6',64),'operationKey','kyaa:race:{source}',
      'legacyPayload',jsonb_build_object('recipient','0x'||repeat('1',40),'celebritySlug','kyaa-route-race',
        'issuanceId','0x'||repeat('6',64),'reactionType','FirstReaction'))))"""
source = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
source.stdin.write('begin;'+enqueue('before','000000000013')+';\n'); source.stdin.flush()
old_job=source.stdout.readline().strip(); assert old_job
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    changed=pool.submit(sql,"update public.fan_action_producer_routes set binding_id='e9130000-0000-4000-8000-000000000012' where action_code=6 returning binding_id")
    # A blocked updater cannot change which binding the in-flight source has selected.
    _,error=source.communicate('commit;\n',timeout=10);assert source.returncode==0,error
    assert changed.result(timeout=10)=='e9130000-0000-4000-8000-000000000012'
assert sql(enqueue('before','000000000013'))==old_job
assert sql(f"select source_snapshot->>'bindingVersion' from public.fan_action_outbox where id='{old_job}'")=='1'
new_job=sql(enqueue('after','000000000014'))
assert sql(f"select source_snapshot->>'bindingVersion' from public.fan_action_outbox where id='{new_job}'")=='2'
print('PASS: concurrent route cutover preserves the in-flight source and assigns v2 only to the next new source')
sql("delete from public.fan_action_producer_routes where action_code=6 and binding_id='e9130000-0000-4000-8000-000000000012'")

PY
