-- Committed fixtures for independent psql sessions in a disposable clean replay.
insert into public.celebrities(id,slug,status,image_url,published_at,roles,primary_role)
values('fc130000-0000-4000-8000-000000000001','community-share-race','draft',
  '/share-race.webp',null,'{artist}','idol');
insert into public.celebrity_localizations(celebrity_id,locale,name,summary,image_alt) values
  ('fc130000-0000-4000-8000-000000000001','ko','공유 경합','공유 경합','공유 경합'),
  ('fc130000-0000-4000-8000-000000000001','en','Share race','Share race','Share race');
update public.celebrities set status='published'
  where id='fc130000-0000-4000-8000-000000000001';
insert into public.app_users(id,privy_user_id,verified_email,status) values
  ('fc130000-0000-4000-8000-000000000011','did:privy:share-race-owner-a','share-race-owner-a@byus.test','active'),
  ('fc130000-0000-4000-8000-000000000012','did:privy:share-race-owner-b','share-race-owner-b@byus.test','active'),
  ('fc130000-0000-4000-8000-000000000021','did:privy:share-race-visitor-a','share-race-visitor-a@byus.test','active'),
  ('fc130000-0000-4000-8000-000000000022','did:privy:share-race-visitor-b','share-race-visitor-b@byus.test','active');
insert into public.user_wallets(app_user_id,chain_id,address,provider,wallet_type) values
  ('fc130000-0000-4000-8000-000000000011',91342,'0xcccccccccccccccccccccccccccccccccccc0011','privy','embedded'),
  ('fc130000-0000-4000-8000-000000000012',91342,'0xcccccccccccccccccccccccccccccccccccc0012','privy','embedded');
insert into public.celebrity_quizzes(id,celebrity_id,version,status,published_at)
values('fc130000-0000-4000-8000-000000000002',
  'fc130000-0000-4000-8000-000000000001',1,'draft',null);
insert into public.quiz_attempts(
  id,app_user_id,celebrity_id,quiz_id,quiz_version,idempotency_key,status,score,submitted_at) values
  ('fc130000-0000-4000-8000-000000000031','fc130000-0000-4000-8000-000000000011','fc130000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000002',1,'fc130000-0000-4000-8000-000000000041','passed',3,pg_catalog.now()),
  ('fc130000-0000-4000-8000-000000000032','fc130000-0000-4000-8000-000000000012','fc130000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000002',1,'fc130000-0000-4000-8000-000000000042','passed',3,pg_catalog.now());
insert into public.quiz_passes(id,app_user_id,celebrity_id,winning_attempt_id) values
  ('fc130000-0000-4000-8000-000000000051','fc130000-0000-4000-8000-000000000011','fc130000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000031'),
  ('fc130000-0000-4000-8000-000000000052','fc130000-0000-4000-8000-000000000012','fc130000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000032');
insert into public.fan_passports(id,app_user_id,celebrity_id,quiz_pass_id) values
  ('fc130000-0000-4000-8000-000000000061','fc130000-0000-4000-8000-000000000011','fc130000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000051'),
  ('fc130000-0000-4000-8000-000000000062','fc130000-0000-4000-8000-000000000012','fc130000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000052');
create table public.community_share_race_tokens(owner_id uuid primary key,token text not null);
insert into public.community_share_race_tokens values
  ('fc130000-0000-4000-8000-000000000011',public.create_community_stamp_share_link(
    'fc130000-0000-4000-8000-000000000011','community-share-race')->>'token'),
  ('fc130000-0000-4000-8000-000000000012',public.create_community_stamp_share_link(
    'fc130000-0000-4000-8000-000000000012','community-share-race')->>'token');

create function public.assert_community_share_race_fixture()
returns jsonb language plpgsql set search_path='' as $$
begin
  if (select count(*) from public.community_stamp_share_visits visit
      join public.community_stamp_share_links link on link.id=visit.share_link_id
      where link.owner_app_user_id='fc130000-0000-4000-8000-000000000011')<>1
    or (select count(*) from public.community_stamps
      where app_user_id='fc130000-0000-4000-8000-000000000011' and kind='share')<>1
    or (select count(*) from public.blockchain_jobs job
      join public.community_stamps stamp on stamp.blockchain_job_id=job.id
      where stamp.app_user_id='fc130000-0000-4000-8000-000000000011'
        and stamp.kind='share')<>1 then
    raise exception 'same visitor race cardinality failed';
  end if;
  if (select count(*) from public.community_stamp_share_visits visit
      join public.community_stamp_share_links link on link.id=visit.share_link_id
      where link.owner_app_user_id='fc130000-0000-4000-8000-000000000012')<>2
    or (select count(*) from public.community_stamps
      where app_user_id='fc130000-0000-4000-8000-000000000012' and kind='share')<>1
    or (select count(*) from public.blockchain_jobs job
      join public.community_stamps stamp on stamp.blockchain_job_id=job.id
      where stamp.app_user_id='fc130000-0000-4000-8000-000000000012'
        and stamp.kind='share')<>1 then
    raise exception 'distinct visitor creator-once race cardinality failed';
  end if;
  return jsonb_build_object('sameVisitorVisits',1,'distinctVisitorVisits',2,
    'shareStamps',2,'shareJobs',2,'status','PASS');
end $$;
