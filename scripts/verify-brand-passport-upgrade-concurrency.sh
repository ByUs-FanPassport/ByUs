#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${PGDATABASE:-}" != "byus_clean" || "${PGHOST:-}" != /*/byus-clean-db.*/socket || ! -d "$PGHOST" ]]; then
  echo "Brand Passport upgrade concurrency checks require the disposable clean replay database" >&2
  exit 1
fi

test_dir="$(mktemp -d "${TMPDIR:-/tmp}/byus-brand-passport.XXXXXX")"
cleanup() {
  find "$test_dir" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create or replace function public.issue_first_reaction_stamp()
returns trigger language plpgsql security definer set search_path='' as $$
declare activity_id uuid:=extensions.gen_random_uuid(); passport_id uuid;
begin
  if exists (select 1 from public.celebrities c
    where c.id=new.celebrity_id and c.primary_role='brand') then return new; end if;
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id,occurred_at)
  values(activity_id,new.app_user_id,new.celebrity_id,'first_reaction','fan_reaction',new.id,new.completed_at)
  on conflict(activity_type,source_type,source_id) do nothing;
  select id into strict activity_id from public.fan_activities where activity_type='first_reaction' and source_type='fan_reaction' and source_id=new.id;
  select id into passport_id from public.fan_passports where app_user_id=new.app_user_id and celebrity_id=new.celebrity_id and business_status='issued';
  insert into public.first_reaction_stamps(reaction_id,app_user_id,celebrity_id,passport_id,activity_id,blockchain_source_id,mint_status,tx_hash,token_id)
  values(new.id,new.app_user_id,new.celebrity_id,passport_id,activity_id,new.id,new.mint_status,new.tx_hash,new.token_id)
  on conflict(reaction_id) do nothing;
  return new;
end $$;

insert into public.app_users(id,privy_user_id,verified_email)
values('95700000-0000-4000-8000-000000000001','did:privy:brand-passport-lock','brand-passport-lock@byus.test');
insert into public.user_wallets(app_user_id,chain_id,address)
values('95700000-0000-4000-8000-000000000001',91342,'0x9570000000000000000000000000000000000001');
insert into public.celebrities(id,slug,status,image_url,roles,primary_role)
values('95700000-0000-4000-8000-000000000002','brand-passport-lock','draft','/brand-passport-lock.jpg','{brand}','brand');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('95700000-0000-4000-8000-000000000002','ko','브랜드 패스포트 잠금','브랜드 패스포트 잠금','브랜드 패스포트 잠금'),
  ('95700000-0000-4000-8000-000000000002','en','Brand passport lock','Brand passport lock','Brand passport lock');
update public.celebrities set status='published',published_at=now()
where id='95700000-0000-4000-8000-000000000002';
select public.react_to_creator(
  '95700000-0000-4000-8000-000000000001','95700000-0000-4000-8000-000000000002',
  '95700000-0000-4000-8000-000000000003','95700000-0000-4000-8000-000000000004',
  '0x'||repeat('a',64)
);
SQL

ready_file="$test_dir/updater-ready"
psql -X -v ON_ERROR_STOP=1 >"$test_dir/updater.log" 2>&1 <<SQL &
begin;
update public.blockchain_jobs
set status='COMPLETED',tx_hash='0x'||repeat('e',64),token_id=91,completed_at=now()
where id='95700000-0000-4000-8000-000000000004';
\! touch '$ready_file'
select pg_sleep(4);
commit;
SQL
updater_pid=$!

for _ in {1..100}; do
  [[ -f "$ready_file" ]] && break
  sleep 0.05
done
if [[ ! -f "$ready_file" ]]; then
  echo "Brand Passport concurrency updater did not start" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 -f "$root_dir/supabase/migrations/20261011110000_brand_passports.sql" \
  >"$test_dir/migration.log" 2>&1 &
migration_pid=$!

lock_observed=false
for _ in {1..30}; do
  if [[ "$(psql -X -Atq -v ON_ERROR_STOP=1 -c "select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query ilike 'lock table public.fan_reactions%')")" == "t" ]]; then
    lock_observed=true
    break
  fi
  sleep 0.1
done

wait "$updater_pid"
wait "$migration_pid"
if [[ "$lock_observed" != true ]]; then
  echo "Brand Passport migration did not wait for the in-flight reaction update" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
begin
  if (select count(*) from public.first_reaction_stamps
      where reaction_id='95700000-0000-4000-8000-000000000003')<>1
    or not exists(select 1 from public.first_reaction_stamps
      where reaction_id='95700000-0000-4000-8000-000000000003'
        and mint_status='minted' and tx_hash='0x'||repeat('e',64) and token_id=91) then
    raise exception 'brand Passport migration missed or stale-copied the in-flight reaction';
  end if;
end $$;
SQL

echo "Brand Passport migration waits for reaction writers and backfills latest mint evidence once: PASS"
