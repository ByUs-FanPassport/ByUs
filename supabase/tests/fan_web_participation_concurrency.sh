#!/usr/bin/env bash
# Run only against the isolated full-migration test database; uses the caller's PG* settings.
set -euo pipefail
ARTIFACT_DIR="${ARTIFACT_DIR:-work/fan-web-participation-concurrency-$(date +%s)}"
mkdir -p "$ARTIFACT_DIR"
psql -X -v ON_ERROR_STOP=1 -q >"$ARTIFACT_DIR/setup.log" 2>&1 <<'SQL'
begin;
insert into public.app_users(id,privy_user_id,verified_email) values
 ('e9000000-0000-4000-8000-000000000001','did:privy:participation-race-admin','participation-race@example.test'),
 ('e9000000-0000-4000-8000-000000000002','did:privy:participation-race-fan','participation-race-fan@example.test');
insert into public.admin_allowlist(id,email,role,active) values('e9000000-0000-4000-8000-000000000003','participation-race@example.test','operator',true);
insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role) values('e9000000-0000-4000-8000-000000000008','participation-race-creator','published','/images/qa.webp',now(),'{creator}','creator');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values('e9000000-0000-4000-8000-000000000008','en','Race creator','Summary','Photo'),('e9000000-0000-4000-8000-000000000008','ko','검사 크리에이터','소개','사진');
insert into public.brands(id,slug,status,logo_url,logo_alt,published_at) values('e9000000-0000-4000-8000-000000000009','participation-race-brand','published','/images/qa.webp','Brand',now());
insert into public.brand_localizations(brand_id,locale,name,description) values('e9000000-0000-4000-8000-000000000009','ko','검사 브랜드','소개'),('e9000000-0000-4000-8000-000000000009','en','Race brand','Description');
insert into public.live_events(id,slug,celebrity_id,brand_id,publication_status,starts_at,ends_at,reservation_opens_at,reservation_closes_at,youtube_url,approved_hero_url,fan_code_hash,published_at,attendance_valid_from,attendance_valid_until) values('e9000000-0000-4000-8000-000000000004','participation-race-live','e9000000-0000-4000-8000-000000000008','e9000000-0000-4000-8000-000000000009','published',now()+interval '2 days',now()+interval '2 days 1 hour',now()-interval '1 day',now()+interval '1 day','https://www.youtube.com/watch?v=abcdefghijk','/images/qa.webp',extensions.crypt('QA1234',extensions.gen_salt('bf',10)),now(),now()+interval '2 days',now()+interval '2 days 1 hour');
insert into public.live_event_localizations(live_event_id,locale,title,summary,hero_alt) values('e9000000-0000-4000-8000-000000000004','ko','검사 방송','소개','사진'),('e9000000-0000-4000-8000-000000000004','en','Race LIVE','Summary','Photo');
insert into public.live_fan_submission_settings(live_event_id,accepting,closes_at) values('e9000000-0000-4000-8000-000000000004',true,clock_timestamp()+interval '1 day');
select public.fan_web_submit_schedule_suggestion('e9000000-0000-4000-8000-000000000002',jsonb_build_object('celebritySlug',c.slug,'kind','event','title','Race','description','','startsAt',clock_timestamp()+interval '1 day','endsAt',clock_timestamp()+interval '2 days','timeZone','Asia/Seoul','location','','participationInstructions','','sourceUrl','https://example.test/race','locale','en','idempotencyKey','e9000000-0000-4000-8000-000000000005')) from public.celebrities c join public.live_events l on l.celebrity_id=c.id where l.id='e9000000-0000-4000-8000-000000000004';
commit;
SQL
PGAPPNAME=participation_deadline_holder psql -X -v ON_ERROR_STOP=1 >"$ARTIFACT_DIR/holder.log" 2>&1 <<'SQL' &
begin;
update public.live_fan_submission_settings set closes_at=clock_timestamp()+interval '2 seconds' where live_event_id='e9000000-0000-4000-8000-000000000004';
select pg_sleep(4);
commit;
SQL
HOLDER_PID=$!
ready=false
for _ in {1..50}; do
 if [[ "$(psql -X -Atq -c "select exists(select 1 from pg_stat_activity where application_name='participation_deadline_holder' and wait_event='PgSleep')")" == t ]]; then ready=true; break; fi
 sleep 0.1
done
if [[ "$ready" != true ]]; then wait "$HOLDER_PID" || true; echo "holder did not acquire settings lock; $ARTIFACT_DIR" >&2; exit 1; fi
if psql -X -v ON_ERROR_STOP=1 >"$ARTIFACT_DIR/deadline.log" 2>&1 <<'SQL'
begin;
select public.fan_web_submit_live_submission('e9000000-0000-4000-8000-000000000002','participation-race-live','question','Late after lock','e9000000-0000-4000-8000-000000000006');
commit;
SQL
then echo "deadline waiter incorrectly submitted; $ARTIFACT_DIR" >&2; exit 1; fi
wait "$HOLDER_PID"
if ! /usr/bin/grep -q FAN_WEB_CLOSED "$ARTIFACT_DIR/deadline.log"; then cat "$ARTIFACT_DIR/deadline.log" >&2; exit 1; fi
cat >"$ARTIFACT_DIR/approve.sql" <<'SQL'
begin;
select public.fan_web_admin_review_schedule_suggestion('e9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000003','e9000000-0000-4000-8000-000000000007',s.id,1,'approve',null,jsonb_build_object('celebrityId',s.celebrity_id,'kind',s.kind,'title',jsonb_build_object('ko','경쟁 검사','en','Race'),'description',jsonb_build_object('ko','','en',''),'startsAt',s.starts_at,'endsAt',s.ends_at,'timeZone',s.time_zone,'location','','participationInstructions','','officialSourceUrl',s.source_url,'status','published')) from public.schedule_suggestions s where s.idempotency_key='e9000000-0000-4000-8000-000000000005';
select pg_sleep(1);
commit;
SQL
psql -X -v ON_ERROR_STOP=1 -f "$ARTIFACT_DIR/approve.sql" >"$ARTIFACT_DIR/approve-1.log" 2>&1 &
FIRST_PID=$!
psql -X -v ON_ERROR_STOP=1 -f "$ARTIFACT_DIR/approve.sql" >"$ARTIFACT_DIR/approve-2.log" 2>&1 &
SECOND_PID=$!
wait "$FIRST_PID"
wait "$SECOND_PID"
psql -X -v ON_ERROR_STOP=1 >"$ARTIFACT_DIR/assert.log" 2>&1 <<'SQL'
do $$ begin
 if (select count(*) from public.celebrity_schedules s join public.schedule_suggestions q on s.idempotency_key=q.id where q.idempotency_key='e9000000-0000-4000-8000-000000000005')<>1 then raise exception 'duplicate approval created multiple schedules'; end if;
 if exists(select 1 from public.live_fan_submissions where live_event_id='e9000000-0000-4000-8000-000000000004') then raise exception 'deadline race inserted a submission'; end if;
end $$;
-- Fixtures stay in the disposable test database; production lifecycle guards remain intact.
SQL
echo "participation deadline / approval races PASS; logs: $ARTIFACT_DIR"
