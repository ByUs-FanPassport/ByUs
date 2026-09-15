#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/byus-creator-raffle-lock.XXXXXX")"
HOLDER_OUT="$ARTIFACT_DIR/holder.out"
BLOCKED_ERR="$ARTIFACT_DIR/blocked.err"
cleanup() {
  find "$ARTIFACT_DIR" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.app_users(id,privy_user_id,verified_email,status)
values('e0000000-0000-4000-8000-000000000001','did:privy:creator-raffle-lock-admin',
  'creator-raffle-lock-admin@example.test','active');
insert into public.admin_allowlist(id,email,role,active)
values('e0000000-0000-4000-8000-000000000002','creator-raffle-lock-admin@example.test','admin',true);
create table public.creator_raffle_concurrency_fixture(owner_id uuid,other_id uuid);
insert into public.creator_raffle_concurrency_fixture(owner_id,other_id)
select ids[1],ids[2] from (
  select array_agg(id order by id) ids from (
    select id from public.celebrities
    where status='published' and archived_at is null order by id limit 2
  ) creators
) selected;
do $$ begin
  if (select owner_id is null or other_id is null or owner_id=other_id
      from public.creator_raffle_concurrency_fixture) then
    raise exception 'two published creator fixtures are required';
  end if;
end $$;
insert into public.benefits
select * from jsonb_populate_record(null::public.benefits,(select to_jsonb(b) from public.benefits b limit 1)
  ||jsonb_build_object('id','e2000000-0000-4000-8000-000000000001','slug','creator-raffle-lock-benefit',
    'celebrity_id',(select owner_id from public.creator_raffle_concurrency_fixture),'publication_status','draft',
    'published_at',null,'archived_at',null,'claim_opens_at','2026-09-01T00:00:00Z',
    'claim_closes_at','2027-01-01T00:00:00Z'));
insert into public.live_benefit_campaigns(
  id,live_event_id,celebrity_id,entry_opens_at,entry_closes_at,actor_app_user_id,actor_admin_allowlist_id
) values(
  'e3000000-0000-4000-8000-000000000001',null,
  (select owner_id from public.creator_raffle_concurrency_fixture),
  clock_timestamp(),clock_timestamp()+interval '1 day','e0000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000002'
);
SQL

PGAPPNAME=creator_raffle_lock_holder psql -X -v ON_ERROR_STOP=1 >"$HOLDER_OUT" 2>&1 <<'SQL' &
begin;
insert into public.live_benefit_campaign_items(
  campaign_id,benefit_id,priority,winner_quantity,fulfillment_method
) values(
  'e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',1,1,'digital'
);
select pg_sleep(4);
rollback;
SQL
HOLDER_PID=$!

holder_ready=false
for _ in {1..30}; do
  if [[ "$(psql -X -Atq -c "select exists(select 1 from pg_stat_activity where application_name='creator_raffle_lock_holder' and wait_event='PgSleep')")" == "t" ]]; then
    holder_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$holder_ready" != true ]]; then
  wait "$HOLDER_PID" || true
  echo "campaign item lock holder did not reach the post-insert checkpoint" >&2
  exit 1
fi

if psql -X -v ON_ERROR_STOP=1 2>"$BLOCKED_ERR" <<'SQL'
set lock_timeout='300ms';
update public.benefits
set celebrity_id=(select other_id from public.creator_raffle_concurrency_fixture)
where id='e2000000-0000-4000-8000-000000000001';
SQL
then
  echo "concurrent benefit owner update bypassed the campaign item owner lock" >&2
  exit 1
fi
if ! rg -q "canceling statement due to lock timeout" "$BLOCKED_ERR"; then
  echo "concurrent owner update failed for an unexpected reason" >&2
  sed -n '1,20p' "$BLOCKED_ERR" >&2
  exit 1
fi
wait "$HOLDER_PID"

psql -X -v ON_ERROR_STOP=1 -q <<'SQL'
begin;
update public.benefits
set celebrity_id=(select other_id from public.creator_raffle_concurrency_fixture)
where id='e2000000-0000-4000-8000-000000000001';
rollback;
SQL

printf '%s\n' '{"creatorRaffleOwnerLockConcurrency":"PASS"}'
