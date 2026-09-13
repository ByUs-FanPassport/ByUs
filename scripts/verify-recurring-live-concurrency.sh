#!/usr/bin/env bash
set -euo pipefail
if [[ "${PGDATABASE:-}" != "byus_clean" || "${PGHOST:-}" != /*/byus-clean-db.*/socket || ! -d "$PGHOST" ]]; then
  echo 'Recurring LIVE concurrency checks require the disposable local replay socket' >&2
  exit 1
fi
[[ "$(psql -X -Atq -v ON_ERROR_STOP=1 -c "select current_database()||'|'||coalesce(inet_server_addr()::text,'local')")" == 'byus_clean|local' ]]
task_dir="$(mktemp -d "${TMPDIR:-/tmp}/byus-recurring-live-race.XXXXXX")"
cleanup() { status=$?; if [[ $status == 0 ]]; then find "$task_dir" -depth -delete; else echo "Race failure evidence: $task_dir" >&2; fi; }
trap cleanup EXIT

read -r creator series rule slot actor allow observation <<<"$(psql -X -Atq -F ' ' -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare creator uuid; series uuid:=extensions.gen_random_uuid(); rule uuid:=extensions.gen_random_uuid();
  slot uuid:=extensions.gen_random_uuid(); actor uuid:=extensions.gen_random_uuid(); allow_id uuid:=extensions.gen_random_uuid();
  run_id uuid:=extensions.gen_random_uuid(); observation uuid:=extensions.gen_random_uuid();
begin
 select id into creator from public.celebrities where status='published' and archived_at is null limit 1;
 insert into public.app_users(id,privy_user_id,verified_email,status) values(actor,'did:privy:recurring-race-'||actor,'recurring-race@example.invalid','active');
 insert into public.admin_allowlist(id,email,role,active) values(allow_id,'recurring-race@example.invalid','admin',true);
 insert into public.recurring_live_runs(id,idempotency_key,input_hash,mode,status,roster,completed_at)
 values(run_id,'recurring-race-source',repeat('1',64),'bootstrap','completed','{}',clock_timestamp());
 insert into public.recurring_live_observations(id,run_id,celebrity_id,result,verification,source_url,source_account,observed_at,original_text,evidence_path,content_hash)
 values(observation,run_id,creator,'regular','verified','https://www.youtube.com/channel/race','official',clock_timestamp(),'Weekly Friday','race/source.txt',repeat('2',64));
 insert into public.recurring_live_series(id,celebrity_id,series_key) values(series,creator,'race-weekly');
 insert into public.recurring_live_rule_revisions(id,series_id,revision,status,rule,source_observation_ids,proposal_hash,reason,
   approved_actor_app_user_id,approved_actor_admin_allowlist_id,approved_at)
 values(rule,series,1,'approved',jsonb_build_object('timeZone','Asia/Seoul','effectiveFrom','2031-01-01','effectiveUntil',null,
   'provider','youtube','channelUrl','https://www.youtube.com/@race/live','slots',jsonb_build_array(
     jsonb_build_object('id',slot,'isoWeekday',5,'localStartTime','07:00','end',null))),array[observation],repeat('3',64),'initial',actor,allow_id,clock_timestamp());
 update public.recurring_live_series set current_rule_revision_id=rule where id=series;
 perform set_config('byus.race.ids',creator||' '||series||' '||rule||' '||slot||' '||actor||' '||allow_id||' '||observation,false);
end $$;
select current_setting('byus.race.ids');
SQL
)"
run_one='97000000-0000-4000-8000-000000000001'
run_two='97000000-0000-4000-8000-000000000002'

PGAPPNAME=byus_recurring_live_race_first psql -X -q -v ON_ERROR_STOP=1 >"$task_dir/first.log" 2>&1 <<SQL &
begin;
select pg_advisory_xact_lock(hashtextextended('recurring-live:creator:$creator',0));
select pg_sleep(2);
set local role service_role;
select public.replenish_recurring_live_events('$run_one',21,'2031-01-01T00:00:00Z');
commit;
SQL
first_pid=$!
ready=false
for _ in $(seq 1 80); do
  if [[ "$(psql -X -Atq -c "select count(*) from pg_stat_activity where application_name='byus_recurring_live_race_first' and wait_event='PgSleep'")" == '1' ]]; then ready=true; break; fi
  sleep 0.05
done
[[ "$ready" == true ]] || { cat "$task_dir/first.log"; exit 1; }
set +e
PGAPPNAME=byus_recurring_live_race_second psql -X -q -v ON_ERROR_STOP=1 >"$task_dir/second.log" 2>&1 <<SQL &
set role service_role;
select public.replenish_recurring_live_events('$run_two',21,'2031-01-01T00:00:00Z');
SQL
second_pid=$!
set -e
wait "$first_pid"
wait "$second_pid"

psql -X -q -v ON_ERROR_STOP=1 <<SQL
do \$\$
declare total integer; distinct_identity integer; opened_versions integer;
begin
 select count(*),count(distinct (recurring_slot_id,recurrence_week)),count(distinct reservation_opens_at)
   into total,distinct_identity,opened_versions from public.live_events where recurring_series_id='$series';
 if total<1 or total<>distinct_identity or opened_versions<>1 then
   raise exception 'concurrent replenish identity/initial reservation window failed: %/%/%',total,distinct_identity,opened_versions;
 end if;
 if (select (summary->'replenishResult'->>'createdCount')::integer from public.recurring_live_runs where id='$run_one')<1
   or (select (summary->'replenishResult'->>'createdCount')::integer from public.recurring_live_runs where id='$run_two')<>0 then
   raise exception 'concurrent replenish did not create once/reuse thereafter';
 end if;
end \$\$;
SQL
echo 'Recurring LIVE concurrent generation stable-identity exclusion PASS'

# Approval owns the creator lock while a replenisher begins. The replenisher must
# re-read the approved rule after waiting, including occurrences beyond old coverage.
changed_rule='97000000-0000-4000-8000-000000000003'
psql -X -q -v ON_ERROR_STOP=1 <<SQL
insert into public.recurring_live_rule_revisions(id,series_id,revision,rule,source_observation_ids,proposal_hash,reason,review_payload)
select '$changed_rule',series_id,2,jsonb_set(rule,'{slots,0,localStartTime}','"09:00"'),source_observation_ids,repeat('4',64),
  'rule_change','{}' from public.recurring_live_rule_revisions where id='$rule';
SQL
PGAPPNAME=byus_recurring_live_rule_change psql -X -q -v ON_ERROR_STOP=1 >"$task_dir/change.log" 2>&1 <<SQL &
begin;
select pg_advisory_xact_lock(hashtextextended('recurring-live:creator:$creator',0));
select pg_sleep(2);
set local role service_role;
select public.resolve_admin_recurring_live_review('$actor','$allow','$changed_rule','$rule','{"action":"approve_rule"}',gen_random_uuid());
commit;
SQL
change_pid=$!
ready=false
for _ in $(seq 1 80); do
  if [[ "$(psql -X -Atq -c "select count(*) from pg_stat_activity where application_name='byus_recurring_live_rule_change' and wait_event='PgSleep'")" == '1' ]]; then ready=true; break; fi
  sleep 0.05
done
[[ "$ready" == true ]] || { cat "$task_dir/change.log"; exit 1; }
PGAPPNAME=byus_recurring_live_after_rule psql -X -q -v ON_ERROR_STOP=1 >"$task_dir/after-change.log" 2>&1 <<SQL &
set role service_role;
select public.replenish_recurring_live_events('97000000-0000-4000-8000-000000000004',49,'2031-01-01T00:00:00Z');
SQL
after_change_pid=$!
wait "$change_pid"
wait "$after_change_pid"
psql -X -q -v ON_ERROR_STOP=1 <<SQL
do \$\$
begin
 if exists(select 1 from public.live_events where recurring_series_id='$series'
   and (starts_at at time zone 'Asia/Seoul')::time<>'09:00'::time) then
   raise exception 'generation used a stale rule after waiting on approval';
 end if;
 if (select count(*) from public.live_events where recurring_series_id='$series')<6 then
   raise exception 'rule/generation race did not extend coverage';
 end if;
end \$\$;
SQL
echo 'Recurring LIVE approval/generation current-rule exclusion PASS'
