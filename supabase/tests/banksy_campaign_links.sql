\set ON_ERROR_STOP on
begin;
do $$ begin
 if not exists(select 1 from public.campaign_tracking_links where id='fa4be7ed-782e-48f2-8537-628e5cd4e920' and channel='mirrorworld' and active) then raise exception 'Mirrorworld link missing'; end if;
end $$;
insert into public.app_users(id,privy_user_id,verified_email,status) values('d0000000-0000-4000-8000-000000000001','did:privy:banksy-admin','banksy-admin@example.test','active');
insert into public.admin_allowlist(id,email,role,active) values('d0000000-0000-4000-8000-000000000002','banksy-admin@example.test','admin',true);
set local role service_role;
do $$
declare
 actor uuid='d0000000-0000-4000-8000-000000000001'; allowlist uuid='d0000000-0000-4000-8000-000000000002';
 a uuid='d1000000-0000-4000-8000-000000000001'; b uuid='d1000000-0000-4000-8000-000000000002'; v uuid; internal uuid; report jsonb; n integer;
begin
 perform public.command_banksy_tracking_link(actor,allowlist,jsonb_build_object('action','create','id',a,'creator','elina','channel','instagram','contentType','story','name','A','locale','ko'));
 perform public.command_banksy_tracking_link(actor,allowlist,jsonb_build_object('action','create','id',b,'creator','byus','channel','mirrorworld','contentType','post','name','B','locale','ko'));
 -- Later request arrives first; original source must still be A.
 v:=public.record_banksy_visit(repeat('a',64),a,b,1);
 if v<>public.record_banksy_visit(repeat('a',64),a,b,1) then raise exception 'session changed'; end if;
 perform public.record_banksy_visit(repeat('a',64),a,a,0);
 if (select first_link_id<>a or last_link_id<>b from public.campaign_visits where id=v) then raise exception 'late retry changed attribution'; end if;
 internal:=public.record_banksy_visit(repeat('b',64),null,null,0);
 perform public.record_banksy_visit(repeat('b',64),null,b,1);
 if (select first_link_id is not null from public.campaign_visits where id=internal) then raise exception 'internal first touch overwritten'; end if;
 perform public.record_banksy_outbound(v,'exhibition','raffle_list','d2000000-0000-4000-8000-000000000001');
 perform public.record_banksy_outbound(v,'exhibition','raffle_list','d2000000-0000-4000-8000-000000000001');
 perform public.record_banksy_outbound(v,'goods','raffle_receipt','d2000000-0000-4000-8000-000000000002');
 perform public.record_banksy_outbound('d9999999-0000-4000-8000-000000000001','goods','raffle_list','d2000000-0000-4000-8000-000000000003');
 if (select count(*) from public.outbound_link_visits where campaign='banksy')<>3 then raise exception 'outbound retry not deduplicated'; end if;
 report:=public.read_banksy_campaign(actor,allowlist,now()-interval '1 day',now()+interval '1 second');
 if report#>>'{report,totals,visits}'<>'2' or report#>>'{report,totals,outboundSessions}'<>'1' then raise exception 'wrong cohort %',report; end if;
 perform public.command_banksy_tracking_link(actor,allowlist,jsonb_build_object('action','stop','id',a));
 if public.record_banksy_visit(repeat('c',64),a,a,0) is not null then raise exception 'inactive accepted'; end if;
 select count(*) into n from public.campaign_visits;
 if n<>2 then raise exception 'inactive created visit'; end if;
end $$;
reset role;
-- KST boundary: Sep 21 starts at Sep 20 15:00 UTC. Exclude late outgoing requests.
update public.campaign_visits set created_at=case when session_hash=repeat('a',64) then '2026-09-20T15:00:00Z'::timestamptz else '2026-09-20T14:59:59Z'::timestamptz end;
update public.outbound_link_visits set created_at='2026-09-21T15:00:01Z' where campaign='banksy';
do $$
declare r jsonb; role_name text; t text;
begin
 r:=public.read_banksy_campaign('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','2026-09-20T15:00:00Z','2026-09-21T15:00:00Z');
 if r#>>'{report,totals,visits}'<>'1' or r#>>'{report,totals,outboundSessions}'<>'0' then raise exception 'KST/end bound failed %',r; end if;
 foreach t in array array['campaign_tracking_links','campaign_visits'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS missing'; end if;
  foreach role_name in array array['anon','authenticated'] loop
   if has_table_privilege(role_name,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'client table access'; end if;
   if has_function_privilege(role_name,'public.record_banksy_visit(text,uuid,uuid,integer)','EXECUTE') then raise exception 'client RPC access'; end if;
  end loop;
 end loop;
 update public.admin_allowlist set role='viewer' where id='d0000000-0000-4000-8000-000000000002';
 begin
  perform public.command_banksy_tracking_link('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','{"action":"stop","id":"d1000000-0000-4000-8000-000000000002"}');
  raise exception 'viewer write accepted';
 exception when others then
  if sqlerrm not like '%viewer is read-only%' then raise; end if;
 end;
end $$;
-- Retention deletes expired campaign rows but preserves legacy and recent requests.
update public.campaign_visits set created_at=now()-interval '91 days';
update public.outbound_link_visits set created_at=now()-interval '91 days' where campaign='banksy';
insert into public.outbound_link_visits(campaign,created_at) values('elina-banksy-instagram',now()-interval '91 days');
select public.maintain_banksy_campaign();
do $$ begin
 if exists(select 1 from public.campaign_visits) or exists(select 1 from public.outbound_link_visits where campaign='banksy') then raise exception 'expired records remain'; end if;
 if not exists(select 1 from public.outbound_link_visits where campaign='elina-banksy-instagram') then raise exception 'legacy deleted'; end if;
end $$;
rollback;
