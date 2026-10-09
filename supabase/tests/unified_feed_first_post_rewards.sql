-- Run against a disposable latest-chain database. All fixtures roll back.
begin;

create or replace function pg_temp.expect_error(p_sql text,p_message text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error %',p_message;
exception when others then
  if sqlerrm='expected error '||p_message or position(p_message in sqlerrm)=0 then raise; end if;
end $$;

do $$
declare
  creator_id uuid:='fa100000-0000-4000-8000-000000000001';
  wallet_owner uuid:='fa100000-0000-4000-8000-000000000011';
  legacy_owner uuid:='fa100000-0000-4000-8000-000000000012';
  late_wallet_owner uuid:='fa100000-0000-4000-8000-000000000013';
  prior_comment_owner uuid:='fa100000-0000-4000-8000-000000000014';
  disabled_policy_owner uuid:='fa100000-0000-4000-8000-000000000015';
  comment_only_owner uuid:='fa100000-0000-4000-8000-000000000016';
  disabled_owner uuid:='fa100000-0000-4000-8000-000000000017';
  legacy_post_id uuid:='fa100000-0000-4000-8000-000000000021';
  lounge_id uuid:='fa100000-0000-4000-8000-000000000022';
  post_id uuid;
  late_post_id uuid;
  target_post_id uuid;
  score_count bigint;
  result jsonb;
begin
  if not exists(
      select 1 from pg_catalog.pg_attribute
      where attrelid='public.fan_posts'::regclass and attname='first_comment_eligible'
        and attnotnull and not attisdropped)
    or pg_catalog.pg_get_expr(
      (select adbin from pg_catalog.pg_attrdef
       where adrelid='public.fan_posts'::regclass
         and adnum=(select attnum from pg_catalog.pg_attribute
                    where attrelid='public.fan_posts'::regclass
                      and attname='first_comment_eligible')), 'public.fan_posts'::regclass)<>'true' then
    raise exception 'fan post eligibility column contract failed';
  end if;
  if pg_catalog.pg_get_functiondef(
      'public.issue_community_stamp(uuid,uuid,public.community_stamp_kind,text)'::regprocedure)
      not like '%fan_action_native_enabled(v_action_code,p_app_user_id,p_celebrity_id)%'
    or pg_catalog.pg_get_functiondef(
      'public.issue_community_stamp(uuid,uuid,public.community_stamp_kind,text)'::regprocedure)
      not like '%when ''post'' then select created_at into strict v_occurred_at from public.fan_posts%'
  then raise exception 'community stamp issuer lost creator gate or post timestamp'; end if;

  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
  values(creator_id,'unified-reward-qa','published','/images/qa.webp',now(),'{creator}','creator');
  insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
    (creator_id,'ko','통합 보상','소개','사진'),(creator_id,'en','Unified rewards','Summary','Photo');
  insert into public.fan_ticket_activity_policy(celebrity_id,enabled,activated_at)
  values(creator_id,true,clock_timestamp()-interval '1 minute');
  insert into public.app_users(id,privy_user_id,verified_email,status) values
    (wallet_owner,'did:privy:unified-reward-wallet','unified-reward-wallet@example.test','active'),
    (legacy_owner,'did:privy:unified-reward-legacy','unified-reward-legacy@example.test','active'),
    (late_wallet_owner,'did:privy:unified-reward-late','unified-reward-late@example.test','active'),
    (prior_comment_owner,'did:privy:unified-reward-prior','unified-reward-prior@example.test','active'),
    (disabled_policy_owner,'did:privy:unified-reward-policy','unified-reward-policy@example.test','active'),
    (comment_only_owner,'did:privy:unified-reward-comment','unified-reward-comment@example.test','active'),
    (disabled_owner,'did:privy:unified-reward-disabled','unified-reward-disabled@example.test','disabled');
  insert into public.user_profiles(app_user_id,nickname,nickname_normalized) values
    (wallet_owner,'RewardA','rewarda'),(legacy_owner,'RewardB','rewardb'),
    (late_wallet_owner,'RewardC','rewardc'),(prior_comment_owner,'RewardD','rewardd'),
    (disabled_policy_owner,'RewardE','rewarde'),(comment_only_owner,'RewardF','rewardf');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
    (wallet_owner,91342,'0xfa10000000000000000000000000000000000011','privy','embedded'),
    (legacy_owner,91342,'0xfa10000000000000000000000000000000000012','privy','embedded'),
    (prior_comment_owner,91342,'0xfa10000000000000000000000000000000000014','privy','embedded'),
    (disabled_policy_owner,91342,'0xfa10000000000000000000000000000000000015','privy','embedded'),
    (comment_only_owner,91342,'0xfa10000000000000000000000000000000000016','privy','embedded');

  score_count:=(select count(*) from public.fan_score_ledger);
  result:=public.save_fan_post(wallet_owner,'unified-reward-qa',null,'First post','public','{}',null,
    'fa100000-0000-4000-8000-000000000031');
  post_id:=(result->>'id')::uuid;
  result:=public.save_fan_post(wallet_owner,'unified-reward-qa',null,'First post','public','{}',null,
    'fa100000-0000-4000-8000-000000000031');
  if result->>'replayed'<>'true' then raise exception 'fan post replay failed'; end if;
  perform public.save_fan_post(wallet_owner,'unified-reward-qa',post_id,'Edited post','public','{}',1,null);
  perform public.remove_fan_post(wallet_owner,post_id);
  perform public.save_fan_post(wallet_owner,'unified-reward-qa',null,'Replacement post','public','{}',null,
    'fa100000-0000-4000-8000-000000000032');
  if (select count(*) from public.community_stamps where app_user_id=wallet_owner
      and celebrity_id=creator_id and kind='first_comment')<>1
    or (select source_key from public.community_stamps where app_user_id=wallet_owner
      and celebrity_id=creator_id and kind='first_comment')<>'first-comment:post:'||post_id::text
    or (select issued_at from public.community_stamps where app_user_id=wallet_owner
      and celebrity_id=creator_id and kind='first_comment')<>(select created_at from public.fan_posts where id=post_id)
    or (select count(*) from public.fan_ticket_activity_awards where app_user_id=wallet_owner
      and celebrity_id=creator_id and action_key='comment' and scope_key='once')<>1 then
    raise exception 'new post rewards were not exactly-once';
  end if;
  if (select count(*) from public.fan_score_ledger)<>score_count then
    raise exception 'fan post introduced a score reward';
  end if;

  -- A pre-migration row remains ineligible through edits, wallet recovery and
  -- the same evidence function used by admin preview/backfill.
  insert into public.fan_posts(id,celebrity_id,app_user_id,body,visibility,idempotency_key,create_request_hash,first_comment_eligible)
  values(legacy_post_id,creator_id,legacy_owner,'Legacy post','public',
    'fa100000-0000-4000-8000-000000000033',repeat('0',64),false);
  perform public.save_fan_post(legacy_owner,'unified-reward-qa',legacy_post_id,'Edited legacy post','public','{}',1,null);
  perform public.claim_welcome_community_stamp(legacy_owner);
  if exists(select 1 from public.fan_ticket_activity_sources(legacy_owner,creator_id))
    or public.award_fan_ticket_activity(legacy_owner,creator_id,'comment','once',true)
    or exists(select 1 from public.community_stamps where app_user_id=legacy_owner
      and celebrity_id=creator_id and kind='first_comment') then
    raise exception 'legacy post became reward eligible';
  end if;

  result:=public.save_fan_post(late_wallet_owner,'unified-reward-qa',null,'Wallet later','public','{}',null,
    'fa100000-0000-4000-8000-000000000034');
  late_post_id:=(result->>'id')::uuid;
  if exists(select 1 from public.community_stamps where app_user_id=late_wallet_owner and kind='first_comment')
    or not exists(select 1 from public.fan_ticket_activity_awards where app_user_id=late_wallet_owner
      and celebrity_id=creator_id and action_key='comment') then
    raise exception 'wallet-pending post transaction was not preserved';
  end if;
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
  values(late_wallet_owner,91342,'0xfa10000000000000000000000000000000000013','privy','embedded');
  if (select source_key from public.community_stamps where app_user_id=late_wallet_owner
      and celebrity_id=creator_id and kind='first_comment') is distinct from ('first-comment:post:'||late_post_id::text) then
    raise exception 'wallet insertion did not recover first post stamp';
  end if;

  insert into public.fan_lounge_messages(id,celebrity_id,app_user_id,body,idempotency_key)
  values(lounge_id,creator_id,prior_comment_owner,'Earlier cheer','fa100000-0000-4000-8000-000000000035');
  perform public.save_fan_post(prior_comment_owner,'unified-reward-qa',null,'Later post','public','{}',null,
    'fa100000-0000-4000-8000-000000000036');
  if (select count(*) from public.community_stamps where app_user_id=prior_comment_owner
      and celebrity_id=creator_id and kind='first_comment')<>1
    or (select source_key from public.community_stamps where app_user_id=prior_comment_owner
      and celebrity_id=creator_id and kind='first_comment')<>'first-comment:lounge:'||lounge_id::text
    or (select count(*) from public.fan_ticket_activity_awards where app_user_id=prior_comment_owner
      and celebrity_id=creator_id and action_key='comment')<>1 then
    raise exception 'existing comment reward was duplicated by a post';
  end if;

  update public.fan_ticket_activity_policy set enabled=false where celebrity_id=creator_id;
  perform public.save_fan_post(disabled_policy_owner,'unified-reward-qa',null,'Policy disabled','public','{}',null,
    'fa100000-0000-4000-8000-000000000037');
  if not exists(select 1 from public.community_stamps where app_user_id=disabled_policy_owner
      and celebrity_id=creator_id and kind='first_comment')
    or exists(select 1 from public.fan_ticket_activity_awards where app_user_id=disabled_policy_owner
      and celebrity_id=creator_id and action_key='comment') then
    raise exception 'disabled ticket policy was ignored';
  end if;
  update public.fan_ticket_activity_policy set enabled=true where celebrity_id=creator_id;

  result:=public.save_fan_post(wallet_owner,'unified-reward-qa',null,'Comment target','public','{}',null,
    'fa100000-0000-4000-8000-000000000038');
  target_post_id:=(result->>'id')::uuid;
  perform public.post_fan_post_comment(comment_only_owner,target_post_id,null,'Post comment only',
    'fa100000-0000-4000-8000-000000000039');
  if exists(select 1 from public.community_stamps where app_user_id=comment_only_owner
      and celebrity_id=creator_id and kind='first_comment')
    or exists(select 1 from public.fan_ticket_activity_awards where app_user_id=comment_only_owner
      and celebrity_id=creator_id and action_key='comment') then
    raise exception 'fan post comment incorrectly became reward evidence';
  end if;

  perform pg_temp.expect_error(format(
    'select public.save_fan_post(%L,%L,null,%L,%L,''{}'',null,%L)',
    disabled_owner,'unified-reward-qa','Disabled write','public','fa100000-0000-4000-8000-000000000040'),
    'FAN_WEB_ACTIVE_ACCOUNT_REQUIRED');
  if exists(select 1 from public.fan_posts where app_user_id=disabled_owner)
    or exists(select 1 from public.community_stamps where app_user_id=disabled_owner)
    or exists(select 1 from public.fan_ticket_activity_awards where app_user_id=disabled_owner) then
    raise exception 'invalid write left reward state';
  end if;
end $$;

rollback;
select 'Unified feed first-post rewards PASS' as result;
