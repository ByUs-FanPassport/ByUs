#!/usr/bin/env bash
set -euo pipefail

if [[ "${PGDATABASE:-}" != "byus_clean" || "${PGHOST:-}" != *"/byus-clean-db."*"/socket" ]]; then
  echo "This test only runs against verify-clean-migration-chain.sh's disposable database" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
values('fa200000-0000-4000-8000-000000000001','unified-reward-race','draft','/images/qa.webp',null,'{creator}','creator');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('fa200000-0000-4000-8000-000000000001','ko','동시 보상','소개','사진'),
  ('fa200000-0000-4000-8000-000000000001','en','Concurrent rewards','Summary','Photo');
update public.celebrities set status='published',published_at=now()
where id='fa200000-0000-4000-8000-000000000001';
insert into public.fan_ticket_activity_policy(celebrity_id,enabled,activated_at)
values('fa200000-0000-4000-8000-000000000001',true,clock_timestamp()-interval '1 minute');
insert into public.app_users(id,privy_user_id,verified_email)
values('fa200000-0000-4000-8000-000000000011','did:privy:unified-reward-race','unified-reward-race@example.test');
insert into public.user_profiles(app_user_id,nickname,nickname_normalized)
values('fa200000-0000-4000-8000-000000000011','RewardRace','rewardrace');
insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
values('fa200000-0000-4000-8000-000000000011',91342,'0xfa20000000000000000000000000000000000011','privy','embedded');
SQL

first_sql="select public.save_fan_post('fa200000-0000-4000-8000-000000000011','unified-reward-race',null,'Concurrent A','public','{}',null,'fa200000-0000-4000-8000-000000000021');"
second_sql="select public.save_fan_post('fa200000-0000-4000-8000-000000000011','unified-reward-race',null,'Concurrent B','public','{}',null,'fa200000-0000-4000-8000-000000000022');"

psql -X -v ON_ERROR_STOP=1 -c "$first_sql" >/dev/null &
first_pid=$!
psql -X -v ON_ERROR_STOP=1 -c "$second_sql" >/dev/null &
second_pid=$!
wait "$first_pid"
wait "$second_pid"

psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if (select count(*) from public.fan_posts
      where app_user_id='fa200000-0000-4000-8000-000000000011'
        and celebrity_id='fa200000-0000-4000-8000-000000000001')<>2
    or (select count(*) from public.community_stamps
      where app_user_id='fa200000-0000-4000-8000-000000000011'
        and celebrity_id='fa200000-0000-4000-8000-000000000001'
        and kind='first_comment')<>1
    or (select count(*) from public.fan_ticket_activity_awards
      where app_user_id='fa200000-0000-4000-8000-000000000011'
        and celebrity_id='fa200000-0000-4000-8000-000000000001'
        and action_key='comment' and scope_key='once')<>1
    or (select count(*) from public.fan_ticket_ledger
      where app_user_id='fa200000-0000-4000-8000-000000000011'
        and celebrity_id='fa200000-0000-4000-8000-000000000001'
        and source_type='fan_activity_reward')<>1
    or exists(select 1 from public.fan_score_ledger
      where app_user_id='fa200000-0000-4000-8000-000000000011'
        and celebrity_id='fa200000-0000-4000-8000-000000000001') then
    raise exception 'concurrent first posts did not converge to one stamp and ticket';
  end if;
end $$;
select 'Unified feed first-post reward concurrency PASS' as result;
SQL
