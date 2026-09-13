#!/usr/bin/env bash
set -euo pipefail
# Only the repository's disposable migration-replay database is permitted.
if [[ "${PGDATABASE:-}" != "byus_clean" || "${PGHOST:-}" != /*/byus-clean-db.*/socket || ! -d "$PGHOST" ]]; then
  echo 'Home banner concurrency checks require the disposable local replay socket' >&2
  exit 1
fi
identity="$(psql -X -Atq -v ON_ERROR_STOP=1 -c "select current_database() || '|' || coalesce(inet_server_addr()::text,'local')")"
[[ "$identity" == 'byus_clean|local' ]] || exit 1
[[ "$(psql -X -Atq -c 'select count(*) from public.home_banners')" == '0' ]] || { echo 'Requires empty banner fixtures'; exit 1; }
task_dir="$(mktemp -d "${TMPDIR:-/tmp}/byus-banner-race.XXXXXX")"
actor='96000000-0000-4000-8000-000000000001'
allow='96000000-0000-4000-8000-000000000002'
cleanup() {
  status=$?
  if [[ $status == 0 ]]; then rm -r "$task_dir"; else echo "Race failure evidence: $task_dir" >&2; fi
}
trap cleanup EXIT
psql -X -q -v ON_ERROR_STOP=1 <<SQL
insert into public.app_users(id,privy_user_id,verified_email,status) values('$actor','did:privy:banner-race','banner-race@example.invalid','active');
insert into public.admin_allowlist(id,email,role,active) values('$allow','banner-race@example.invalid','admin',true);
SQL
blank='{"ko":{},"en":{}}'
first="$(psql -X -Atq -v ON_ERROR_STOP=1 -c "set role service_role; select public.save_admin_home_banner('$actor','$allow',gen_random_uuid(),null,0,'announcement',null,'$blank')->>'id'")"
PGAPPNAME=byus_banner_race_create psql -X -q -v ON_ERROR_STOP=1 > "$task_dir/create.log" 2>&1 <<SQL &
begin;
set local role service_role;
select public.save_admin_home_banner('$actor','$allow',gen_random_uuid(),null,0,'announcement',null,'$blank');
select pg_sleep(2);
commit;
SQL
create_pid=$!
# Wait for the first transaction to hold the application lock before racing it.
ready=false
for attempt in $(seq 1 80); do
  if [[ "$(psql -X -Atq -c "select count(*) from pg_stat_activity where application_name='byus_banner_race_create' and wait_event='PgSleep'")" == '1' ]]; then ready=true; break; fi
  sleep 0.05
done
[[ "$ready" == true ]] || { cat "$task_dir/create.log"; exit 1; }
if psql -X -q -v ON_ERROR_STOP=1 > "$task_dir/reorder.log" 2>&1 <<SQL
set role service_role;
select public.reorder_admin_home_banners('$actor','$allow',gen_random_uuid(),'[{"id":"$first","expectedRevision":1}]');
SQL
then
  echo 'Concurrent create was omitted by a successful stale reorder' >&2; exit 1
fi
wait "$create_pid"
grep -Fq 'full reorder required' "$task_dir/reorder.log"
[[ "$(psql -X -Atq -c 'select count(*) from public.home_banners')" == '2' ]] || exit 1
[[ "$(psql -X -Atq -c 'select min(revision) || chr(124) || max(revision) from public.home_banners')" == '1|1' ]] || exit 1
psql -X -q -v ON_ERROR_STOP=1 <<SQL
set role service_role;
select public.reorder_admin_home_banners('$actor','$allow',gen_random_uuid(),
 (select jsonb_agg(jsonb_build_object('id',item->>'id','expectedRevision',(item->>'revision')::integer) order by ord desc)
 from jsonb_array_elements(public.get_admin_home_banner_manager('$actor','$allow')->'items') with ordinality x(item,ord)));
reset role;
do \$\$ begin
 if (select count(*) from public.home_banners where revision=2)<>2 then raise exception 'complete reorder did not atomically update both revisions'; end if;
end \$\$;
-- Remove only this guarded disposable test's banner fixtures.
-- Audit rows and their actors remain append-only until replay DB teardown.
delete from public.home_banner_localizations;
delete from public.home_banners;
SQL
echo 'Home banner concurrent create/full-reorder exclusion PASS'
