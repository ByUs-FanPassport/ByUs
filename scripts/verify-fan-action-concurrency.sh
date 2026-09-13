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
 '0x'||repeat('2',40),'0x'||repeat('3',64),1,1,'ipfs://bafyfixture','{}');
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

PY
