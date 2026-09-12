-- Run against the local database after 20260912155839_community_stamps.sql.
-- Every fixture, stamp and queue transition rolls back.
begin;

create function pg_temp.expect_error(statement text,expected text)
returns void language plpgsql as $$
declare caught boolean:=false;
begin
  begin execute statement;
  exception when others then
    if position(expected in sqlerrm)=0 then
      raise exception 'Unexpected error %, wanted %',sqlerrm,expected;
    end if;
    caught:=true;
  end;
  if not caught then raise exception 'Expected error was not raised: %',expected; end if;
end $$;

do $$
declare
  creator_id uuid:='a9130000-0000-4000-8000-000000000001';
  notice_id uuid:='a9130000-0000-4000-8000-000000000002';
  owner_a uuid:='a9130000-0000-4000-8000-000000000011';
  owner_b uuid:='a9130000-0000-4000-8000-000000000012';
  owner_c uuid:='a9130000-0000-4000-8000-000000000013';
  owner_d uuid:='a9130000-0000-4000-8000-000000000014';
  owner_e uuid:='a9130000-0000-4000-8000-000000000015';
  notice_comment_id uuid:='a9130000-0000-4000-8000-000000000021';
  lounge_comment_id uuid:='a9130000-0000-4000-8000-000000000022';
  late_comment_id uuid:='a9130000-0000-4000-8000-000000000023';
  invalid_stamp_id uuid:='a9130000-0000-4000-8000-000000000031';
  invalid_job_id uuid:='a9130000-0000-4000-8000-000000000032';
  invalid_source_stamp_id uuid:='a9130000-0000-4000-8000-000000000033';
  invalid_source_job_id uuid:='a9130000-0000-4000-8000-000000000034';
  invite_a jsonb;
  invite_b jsonb;
  result jsonb;
  job_id uuid;
  operation_key text;
  claim_count integer;
begin
  if array(select kind::text from pg_catalog.unnest(
      enum_range(null::public.community_stamp_kind)) kind) is distinct from
    array['welcome','first_comment','subscription','support','share','invite','daily_checkin']::text[] then
    raise exception 'community stamp kinds changed';
  end if;
  if public.community_stamp_kst_date('2026-09-12 14:59:59+00')<>'2026-09-12'
    or public.community_stamp_kst_date('2026-09-12 15:00:00+00')<>'2026-09-13' then
    raise exception 'KST day boundary is not UTC+09:00';
  end if;

  insert into public.celebrities(
    id,slug,status,image_url,published_at,roles,primary_role)
    values(creator_id,'qa-community-stamps','published','/images/qa.webp',now(),
      '{artist}','idol');
  insert into public.celebrity_notices(
    id,celebrity_id,slug,publication_status,published_at,ever_published_at)
    values(notice_id,creator_id,'qa-stamps-notice','draft',null,null);
  insert into public.app_users(id,privy_user_id,verified_email) values
    (owner_a,'did:privy:community-stamp-a','community-stamp-a@example.test'),
    (owner_b,'did:privy:community-stamp-b','community-stamp-b@example.test'),
    (owner_c,'did:privy:community-stamp-c','community-stamp-c@example.test'),
    (owner_d,'did:privy:community-stamp-d','community-stamp-d@example.test'),
    (owner_e,'did:privy:community-stamp-e','community-stamp-e@example.test');

  -- Wallet insertion creates exactly one welcome stamp and every subsequent
  -- session sync remains idempotent.
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
    (owner_a,91342,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0011','privy','embedded'),
    (owner_b,91342,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0012','privy','embedded'),
    (owner_d,91342,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0014','privy','embedded');
  if (select count(*) from public.community_stamps
      where app_user_id=owner_a and kind='welcome')<>1 then
    raise exception 'wallet trigger did not award welcome exactly once';
  end if;
  if public.claim_welcome_community_stamp(owner_a)->>'awarded'<>'false' then
    raise exception 'welcome replay was not idempotent';
  end if;
  perform public.sync_privy_identity(
    'did:privy:community-stamp-a','community-stamp-a@example.test',91342,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0011');
  if (select count(*) from public.community_stamps
      where app_user_id=owner_a and kind='welcome')<>1 then
    raise exception 'session sync duplicated welcome';
  end if;

  -- The first comment across notice and lounge sources wins once per creator.
  insert into public.celebrity_notice_comments(
    id,notice_id,app_user_id,body,idempotency_key)
    values(notice_comment_id,notice_id,owner_a,'첫 공지 댓글',extensions.gen_random_uuid());
  insert into public.fan_lounge_messages(
    id,celebrity_id,app_user_id,body,idempotency_key)
    values(lounge_comment_id,creator_id,owner_a,'두 번째 라운지 댓글',extensions.gen_random_uuid());
  if (select count(*) from public.community_stamps where app_user_id=owner_a
      and celebrity_id=creator_id and kind='first_comment')<>1
    or (select source_key from public.community_stamps where app_user_id=owner_a
      and celebrity_id=creator_id and kind='first_comment')
      <>'first-comment:notice:'||notice_comment_id::text then
    raise exception 'cross-source first comment was not awarded from the first source';
  end if;

  -- A comment without a wallet succeeds. The later wallet insertion issues
  -- welcome and recovers the already eligible first comment in one transaction.
  insert into public.fan_lounge_messages(
    id,celebrity_id,app_user_id,body,idempotency_key)
    values(late_comment_id,creator_id,owner_c,'지갑 전 댓글',extensions.gen_random_uuid());
  if exists(select 1 from public.community_stamps where app_user_id=owner_c) then
    raise exception 'wallet-less comment unexpectedly minted a stamp';
  end if;
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type)
    values(owner_c,91342,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0013','privy','embedded');
  if (select count(*) from public.community_stamps where app_user_id=owner_c
      and kind in ('welcome','first_comment'))<>2 then
    raise exception 'wallet insertion did not recover eligible comment';
  end if;

  -- Daily check-in is one stamp per creator and KST calendar day.
  if public.check_in_community_stamp(owner_a,'qa-community-stamps')->>'awarded'<>'true'
    or public.check_in_community_stamp(owner_a,'qa-community-stamps')->>'awarded'<>'false' then
    raise exception 'daily check-in did not enforce creator KST-day uniqueness';
  end if;
  if (select count(*) from public.community_stamps where app_user_id=owner_a
      and celebrity_id=creator_id and kind='daily_checkin')<>1 then
    raise exception 'daily check-in ledger duplicated';
  end if;
  if exists(select 1 from public.community_stamps stamp
      where stamp.app_user_id=owner_a and stamp.celebrity_id=creator_id
        and stamp.kind='daily_checkin'
        and pg_catalog.right(stamp.source_key,10)
          <>public.community_stamp_kst_date(stamp.issued_at)::text) then
    raise exception 'daily check-in source date and issuedAt crossed KST days';
  end if;

  -- Provider-backed and share rewards fail closed before any row or job exists.
  perform pg_temp.expect_error(format(
    'select public.issue_community_stamp(%L,%L,%L::public.community_stamp_kind,%L)',
    owner_a,creator_id,'subscription','provider:unverified'),'COMMUNITY_STAMP_UNAVAILABLE');
  perform pg_temp.expect_error(format(
    'select public.issue_community_stamp(%L,%L,%L::public.community_stamp_kind,%L)',
    owner_a,creator_id,'support','provider:unverified'),'COMMUNITY_STAMP_UNAVAILABLE');
  perform pg_temp.expect_error(format(
    'select public.issue_community_stamp(%L,%L,%L::public.community_stamp_kind,%L)',
    owner_a,creator_id,'share','share:unverified'),'COMMUNITY_STAMP_UNAVAILABLE');
  if exists(select 1 from public.community_stamps
      where kind in ('subscription','support','share')) then
    raise exception 'unavailable reward kind was persisted';
  end if;

  -- Invite bindings are immutable, one per invitee, reciprocal-safe and award
  -- both wallets atomically. More friends may use the same inviter code while
  -- the inviter's own stamp remains global-once.
  invite_a:=public.get_community_stamp_invite_code(owner_a);
  invite_b:=public.get_community_stamp_invite_code(owner_b);
  if invite_a->>'code' !~ '^[A-F0-9]{24}$'
    or public.get_community_stamp_invite_code(owner_a)->>'code'<>invite_a->>'code' then
    raise exception 'invite code is not stable random-format data';
  end if;
  if public.redeem_community_stamp_invite(owner_b,invite_a->>'code')->>'awarded'<>'true' then
    raise exception 'invite redemption did not award';
  end if;
  if (select count(*) from public.community_stamps where kind='invite'
      and app_user_id in (owner_a,owner_b))<>2 then
    raise exception 'invite did not atomically award both users';
  end if;
  if public.get_community_stamp_invite_code(owner_a)->>'redeemed'<>'false'
    or public.get_community_stamp_invite_code(owner_b)->>'redeemed'<>'true' then
    raise exception 'invite redeemed state did not distinguish inviter and invitee';
  end if;
  perform pg_temp.expect_error(format(
    'select public.redeem_community_stamp_invite(%L,%L)',owner_b,invite_a->>'code'),
    'COMMUNITY_STAMP_ALREADY_REDEEMED');
  perform pg_temp.expect_error(format(
    'select public.redeem_community_stamp_invite(%L,%L)',owner_a,invite_b->>'code'),
    'COMMUNITY_STAMP_ALREADY_REDEEMED');
  perform pg_temp.expect_error(format(
    'select public.redeem_community_stamp_invite(%L,%L)',owner_a,invite_a->>'code'),
    'COMMUNITY_STAMP_SELF_INVITE');
  if public.redeem_community_stamp_invite(owner_c,invite_a->>'code')->>'awarded'<>'true'
    or (select count(*) from public.community_stamps
      where app_user_id=owner_a and kind='invite')<>1 then
    raise exception 'additional invite duplicated inviter reward';
  end if;
  perform pg_temp.expect_error(format(
    'select public.redeem_community_stamp_invite(%L,%L)',owner_e,invite_a->>'code'),
    'COMMUNITY_STAMP_WALLET_NOT_READY');
  if exists(select 1 from public.community_stamp_invite_redemptions
      where invitee_app_user_id=owner_e) then
    raise exception 'wallet failure left a partial invite binding';
  end if;

  -- Direct inserts cannot forge another wallet or another owner's source.
  operation_key:='byus:community-stamp:v1:'||invalid_stamp_id::text;
  insert into public.blockchain_jobs(
    id,entity_type,entity_id,operation_key,payload_version,payload)
  values(invalid_job_id,'community_stamp',invalid_stamp_id,operation_key,1,
    jsonb_build_object(
      'recipient','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0012',
      'issuanceId','0x'||encode(extensions.digest(operation_key,'sha256'),'hex'),
      'stampKind','welcome','celebritySlug',null));
  perform pg_temp.expect_error(format(
    'insert into public.community_stamps(id,app_user_id,kind,source_key,blockchain_job_id) values(%L,%L,%L,%L,%L)',
    invalid_stamp_id,owner_a,'welcome','welcome:'||owner_a::text,invalid_job_id),
    'community stamp blockchain job payload is invalid');

  operation_key:='byus:community-stamp:v1:'||invalid_source_stamp_id::text;
  insert into public.blockchain_jobs(
    id,entity_type,entity_id,operation_key,payload_version,payload)
  values(invalid_source_job_id,'community_stamp',invalid_source_stamp_id,operation_key,1,
    jsonb_build_object(
      'recipient','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0011',
      'issuanceId','0x'||encode(extensions.digest(operation_key,'sha256'),'hex'),
      'stampKind','welcome','celebritySlug',null));
  perform pg_temp.expect_error(format(
    'insert into public.community_stamps(id,app_user_id,kind,source_key,blockchain_job_id) values(%L,%L,%L,%L,%L)',
    invalid_source_stamp_id,owner_a,'welcome','welcome:'||owner_b::text,invalid_source_job_id),
    'COMMUNITY_STAMP_INVALID_REQUEST');

  -- Queue payload is deterministic and contains the exact worker contract.
  select stamp.blockchain_job_id into job_id from public.community_stamps stamp
    where stamp.app_user_id=owner_a and stamp.kind='daily_checkin';
  select job.operation_key into operation_key from public.blockchain_jobs job where job.id=job_id;
  if (select job.payload from public.blockchain_jobs job where job.id=job_id)
    is distinct from jsonb_build_object(
      'recipient','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0011',
      'issuanceId','0x'||encode(extensions.digest(operation_key,'sha256'),'hex'),
      'stampKind','daily_checkin','celebritySlug','qa-community-stamps') then
    raise exception 'community stamp queue payload projection changed';
  end if;

  update public.blockchain_jobs set next_attempt_at='infinity'::timestamptz
    where entity_type='community_stamp';
  update public.blockchain_jobs set next_attempt_at=now() where id=job_id;
  select count(*) into claim_count from public.claim_blockchain_jobs('legacy-worker',100,120)
    where entity_type='community_stamp';
  if claim_count<>0 then raise exception 'legacy worker claimed a community stamp'; end if;
  select count(*) into claim_count from public.claim_blockchain_jobs(
    'community-worker',100,120,array['community_stamp']::text[]) where id=job_id;
  if claim_count<>1 or (select mint_status from public.community_stamps
      where blockchain_job_id=job_id)<>'processing' then
    raise exception 'capability claim or processing reconciliation failed';
  end if;
  perform public.record_prepared_blockchain_job(job_id,'community-worker','0x'||repeat('1',64),'0x1234');
  perform public.complete_blockchain_job(job_id,'community-worker','0x'||repeat('1',64),55);
  if (select mint_status<>'minted' or tx_hash<>'0x'||repeat('1',64) or token_id<>55
      from public.community_stamps where blockchain_job_id=job_id) then
    raise exception 'completed queue result was not reconciled';
  end if;

  result:=public.get_owned_community_stamps(owner_a,'qa-community-stamps');
  if result->>'today'<>public.community_stamp_kst_date()::text
    or jsonb_array_length(result->'stamps')<4
    or result::text ~ '(appUserId|app_user_id|ownerId|privy|email|wallet)'
    or not exists(select 1 from jsonb_array_elements(result->'stamps') stamp
      where stamp->>'kind'='daily_checkin'
        and stamp#>>'{mint,status}'='minted'
        and jsonb_typeof(stamp#>'{mint,tokenId}')='string'
        and stamp#>>'{mint,tokenId}'='55') then
    raise exception 'owned stamp DTO, KST today or mint projection failed';
  end if;

  -- Business identity and invitation evidence remain immutable.
  perform pg_temp.expect_error(format(
    'update public.community_stamps set source_key=%L where app_user_id=%L and kind=%L',
    'forged',owner_a,'welcome'),'community stamp ledger is immutable');
  perform pg_temp.expect_error(format(
    'update public.community_stamp_invite_codes set code=%L where app_user_id=%L',
    repeat('A',24),owner_a),'community stamp invite records are immutable');
end $$;

do $$
begin
  if has_table_privilege('anon','public.community_stamps','SELECT')
    or has_table_privilege('authenticated','public.community_stamps','SELECT')
    or has_table_privilege('service_role','public.community_stamps','SELECT')
    or has_table_privilege('service_role','public.community_stamp_invite_codes','SELECT') then
    raise exception 'community stamp tables exposed direct access';
  end if;
  if has_function_privilege('anon','public.get_owned_community_stamps(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.check_in_community_stamp(uuid,text)','EXECUTE')
    or has_function_privilege('service_role','public.issue_community_stamp(uuid,uuid,public.community_stamp_kind,text)','EXECUTE')
    or not has_function_privilege('service_role','public.get_owned_community_stamps(uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.claim_welcome_community_stamp(uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.check_in_community_stamp(uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.get_community_stamp_invite_code(uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.redeem_community_stamp_invite(uuid,text)','EXECUTE') then
    raise exception 'community stamp RPC ACL failed';
  end if;
end $$;

rollback;
