-- Run after the community stamp share migration. All fixtures roll back.
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
  creator uuid:='fa130000-0000-4000-8000-000000000001';
  quiz uuid:='fa130000-0000-4000-8000-000000000002';
  owner uuid:='fa130000-0000-4000-8000-000000000011';
  no_wallet_owner uuid:='fa130000-0000-4000-8000-000000000012';
  inactive_owner uuid:='fa130000-0000-4000-8000-000000000013';
  visitor_a uuid:='fa130000-0000-4000-8000-000000000021';
  visitor_b uuid:='fa130000-0000-4000-8000-000000000022';
  owner_link jsonb;
  no_wallet_link jsonb;
  inactive_link jsonb;
  result jsonb;
  share_stamp public.community_stamps%rowtype;
  share_job public.blockchain_jobs%rowtype;
begin
  insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
    values(creator,'community-share-proof','draft','/community-share.webp',null,
      '{artist}','idol');
  insert into public.celebrity_localizations(
    celebrity_id,locale,name,summary,image_alt) values
    (creator,'ko','공유 검증','공유 검증','공유 검증'),
    (creator,'en','Share proof','Share proof','Share proof');
  update public.celebrities set status='published' where id=creator;

  insert into public.app_users(id,privy_user_id,verified_email,status) values
    (owner,'did:privy:share-owner','share-owner@byus.test','active'),
    (no_wallet_owner,'did:privy:share-no-wallet','share-no-wallet@byus.test','active'),
    (inactive_owner,'did:privy:share-inactive','share-inactive@byus.test','active'),
    (visitor_a,'did:privy:share-visitor-a','share-visitor-a@byus.test','active'),
    (visitor_b,'did:privy:share-visitor-b','share-visitor-b@byus.test','active');
  insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
    (owner,91342,'0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0011','privy','embedded'),
    (inactive_owner,91342,'0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0013','privy','embedded');

  insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at)
    values(quiz,creator,1,'draft',null);
  insert into public.quiz_attempts(
    id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
    ('fa130000-0000-4000-8000-000000000031',owner,creator,quiz,1,
      'fa130000-0000-4000-8000-000000000041','passed',3,pg_catalog.now()),
    ('fa130000-0000-4000-8000-000000000032',no_wallet_owner,creator,quiz,1,
      'fa130000-0000-4000-8000-000000000042','passed',3,pg_catalog.now()),
    ('fa130000-0000-4000-8000-000000000033',inactive_owner,creator,quiz,1,
      'fa130000-0000-4000-8000-000000000043','passed',3,pg_catalog.now());
  insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
    ('fa130000-0000-4000-8000-000000000051',owner,creator,
      'fa130000-0000-4000-8000-000000000031'),
    ('fa130000-0000-4000-8000-000000000052',no_wallet_owner,creator,
      'fa130000-0000-4000-8000-000000000032'),
    ('fa130000-0000-4000-8000-000000000053',inactive_owner,creator,
      'fa130000-0000-4000-8000-000000000033');
  insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id) values
    ('fa130000-0000-4000-8000-000000000061',owner,creator,
      'fa130000-0000-4000-8000-000000000051'),
    ('fa130000-0000-4000-8000-000000000062',no_wallet_owner,creator,
      'fa130000-0000-4000-8000-000000000052'),
    ('fa130000-0000-4000-8000-000000000063',inactive_owner,creator,
      'fa130000-0000-4000-8000-000000000053');

  perform pg_temp.expect_error(format(
    'select public.create_community_stamp_share_link(%L,%L)',visitor_a,
    'community-share-proof'),'COMMUNITY_STAMP_PASSPORT_REQUIRED');
  owner_link:=public.create_community_stamp_share_link(owner,'community-share-proof');
  no_wallet_link:=public.create_community_stamp_share_link(
    no_wallet_owner,'community-share-proof');
  inactive_link:=public.create_community_stamp_share_link(
    inactive_owner,'community-share-proof');
  if owner_link->>'token' !~ '^[a-f0-9]{32}$'
    or public.create_community_stamp_share_link(owner,'community-share-proof')
      ->>'token'<>owner_link->>'token'
    or (select count(*) from public.community_stamp_share_links
      where owner_app_user_id=owner and celebrity_id=creator)<>1 then
    raise exception 'share link token was not canonical, stable and reusable';
  end if;
  result:=public.resolve_community_stamp_share_link(owner_link->>'token');
  if result is distinct from jsonb_build_object('creator','community-share-proof')
    or result::text ~ '(owner|wallet|passport|nickname|score|email)' then
    raise exception 'share resolve exposed private sender data or changed DTO';
  end if;

  -- GET/resolve and the owner's own explicit click never persist evidence.
  result:=public.visit_community_stamp_share_link(owner,owner_link->>'token');
  if result is distinct from jsonb_build_object('creator','community-share-proof')
    or exists(select 1 from public.community_stamp_share_visits
      where share_link_id=(select id from public.community_stamp_share_links
        where token=owner_link->>'token'))
    or exists(select 1 from public.community_stamps where app_user_id=owner and kind='share') then
    raise exception 'resolve or self visit awarded a share stamp';
  end if;

  result:=public.visit_community_stamp_share_link(visitor_a,owner_link->>'token');
  if result is distinct from jsonb_build_object('creator','community-share-proof') then
    raise exception 'verified share visit changed navigation DTO';
  end if;
  perform public.visit_community_stamp_share_link(visitor_a,owner_link->>'token');
  perform public.visit_community_stamp_share_link(visitor_b,owner_link->>'token');
  if (select count(*) from public.community_stamp_share_visits visit
      join public.community_stamp_share_links link on link.id=visit.share_link_id
      where link.owner_app_user_id=owner and link.celebrity_id=creator)<>2
    or (select count(*) from public.community_stamps
      where app_user_id=owner and celebrity_id=creator and kind='share')<>1 then
    raise exception 'share visits or creator-once reward were not idempotent';
  end if;

  select * into strict share_stamp from public.community_stamps
    where app_user_id=owner and celebrity_id=creator and kind='share';
  select * into strict share_job from public.blockchain_jobs
    where id=share_stamp.blockchain_job_id;
  if share_stamp.source_key !~ '^verified-share-visit:'
    or not exists(select 1 from public.community_stamp_share_visits visit
      join public.community_stamp_share_links link on link.id=visit.share_link_id
      where visit.id=pg_catalog.split_part(share_stamp.source_key,':',2)::uuid
        and link.owner_app_user_id=owner and link.celebrity_id=creator
        and visit.visitor_app_user_id<>owner)
    or share_job.entity_type<>'community_stamp'
    or share_job.payload->>'stampKind'<>'share'
    or share_job.payload->>'celebritySlug'<>'community-share-proof'
    or share_job.payload->>'recipient'<>'0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb0011' then
    raise exception 'share source proof or mint queue projection is invalid';
  end if;

  perform pg_temp.expect_error(format(
    'select public.issue_community_stamp(%L,%L,%L::public.community_stamp_kind,%L)',
    owner,creator,'share','verified-share-visit:fa130000-0000-4000-8000-000000000099'),
    'COMMUNITY_STAMP_INVALID_REQUEST');
  perform pg_temp.expect_error(format(
    'select public.issue_community_stamp(%L,%L,%L::public.community_stamp_kind,%L)',
    owner,creator,'subscription','provider:unverified'),'COMMUNITY_STAMP_UNAVAILABLE');
  perform pg_temp.expect_error(format(
    'select public.issue_community_stamp(%L,%L,%L::public.community_stamp_kind,%L)',
    owner,creator,'support','provider:unverified'),'COMMUNITY_STAMP_UNAVAILABLE');

  -- Stale sender eligibility fails closed without recording evidence.
  perform public.visit_community_stamp_share_link(visitor_a,no_wallet_link->>'token');
  update public.app_users set status='disabled' where id=inactive_owner;
  perform public.visit_community_stamp_share_link(visitor_a,inactive_link->>'token');
  if exists(select 1 from public.community_stamp_share_visits visit
      join public.community_stamp_share_links link on link.id=visit.share_link_id
      where link.owner_app_user_id in (no_wallet_owner,inactive_owner))
    or exists(select 1 from public.community_stamps
      where app_user_id in (no_wallet_owner,inactive_owner) and kind='share') then
    raise exception 'ineligible sender persisted visit evidence or reward';
  end if;

  perform pg_temp.expect_error(format(
    'update public.community_stamp_share_links set token=%L where token=%L',
    repeat('a',32),owner_link->>'token'),'community stamp share evidence is immutable');
  perform pg_temp.expect_error(format(
    'delete from public.community_stamp_share_visits where id=%L',
    pg_catalog.split_part(share_stamp.source_key,':',2)::uuid),
    'community stamp share evidence is immutable');

  update public.celebrities set status='draft' where id=creator;
  perform pg_temp.expect_error(format(
    'select public.resolve_community_stamp_share_link(%L)',owner_link->>'token'),
    'COMMUNITY_STAMP_NOT_FOUND');
  perform pg_temp.expect_error(format(
    'select public.visit_community_stamp_share_link(%L,%L)',visitor_a,
    owner_link->>'token'),'COMMUNITY_STAMP_NOT_FOUND');
end $$;

do $$
begin
  if has_table_privilege('anon','public.community_stamp_share_links','SELECT')
    or has_table_privilege('authenticated','public.community_stamp_share_visits','INSERT')
    or has_table_privilege('service_role','public.community_stamp_share_links','SELECT')
    or has_function_privilege('anon','public.resolve_community_stamp_share_link(text)','EXECUTE')
    or has_function_privilege('authenticated','public.visit_community_stamp_share_link(uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.create_community_stamp_share_link(uuid,text)','EXECUTE')
    or not has_function_privilege('service_role','public.resolve_community_stamp_share_link(text)','EXECUTE')
    or not has_function_privilege('service_role','public.visit_community_stamp_share_link(uuid,text)','EXECUTE') then
    raise exception 'community stamp share RLS or RPC ACL failed';
  end if;
end $$;

rollback;
