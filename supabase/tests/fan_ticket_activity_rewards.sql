begin;

create function pg_temp.assert(p_condition boolean,p_message text) returns void
language plpgsql as $$ begin if not coalesce(p_condition,false) then raise exception 'ASSERT: %',p_message; end if; end $$;

-- The migration only enables the three current raffle creators and performs no implicit backfill.
select pg_temp.assert((select array_agg(c.slug order by c.slug) from public.fan_ticket_activity_policy p join public.celebrities c on c.id=p.celebrity_id)=array['changha','elina','yuna'],'policy targets');
select pg_temp.assert((select count(*) from public.fan_ticket_activity_awards)=0,'migration must not auto-backfill');
select pg_temp.assert((select count(*) from public.fan_ticket_ledger where source_type='fan_activity_reward')=0,'migration must not auto-credit');

-- Preview is read-only and distinguishes adopted canonical credits from new tickets.
do $$ declare preview jsonb; begin
  preview:=public.backfill_fan_ticket_activity('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000091',false,500);
  perform pg_temp.assert(preview->>'applied'='false','preview applied flag');
  perform pg_temp.assert((preview->>'processed')::integer=0,'preview processed');
  perform pg_temp.assert((preview->>'ticketsPaid')::integer=0,'preview paid');
  perform pg_temp.assert((preview->>'remainingGroups')::integer=5,'preview groups');
end $$;

-- Historical batch adopts a spent quiz credit and an existing membership credit while paying other evidence.
do $$ declare applied jsonb; begin
  applied:=public.backfill_fan_ticket_activity('00000000-0000-0000-0000-000000000090','00000000-0000-0000-0000-000000000091',true,500);
  perform pg_temp.assert((applied->>'processed')::integer=5,'historical processed');
  perform pg_temp.assert((applied->>'ticketsPaid')::integer=3,'historical paid excluding adopted credits');
  perform pg_temp.assert((applied->>'remainingGroups')::integer=0,'historical drained');
end $$;
select pg_temp.assert((select count(*) from public.fan_ticket_ledger where app_user_id='00000000-0000-0000-0000-000000000002' and celebrity_id='10000000-0000-0000-0000-000000000002' and source_type='passport_verification')=1,'spent quiz credit adopted');
select pg_temp.assert((select count(*) from public.fan_ticket_ledger where app_user_id='00000000-0000-0000-0000-000000000002' and celebrity_id='10000000-0000-0000-0000-000000000002')=3,'spent quiz did not receive duplicate');
select pg_temp.assert((select a.ledger_id=l.id and not a.backfill from public.fan_ticket_activity_awards a join public.fan_ticket_ledger l on l.id=a.ledger_id where a.action_key='verification' and a.app_user_id='00000000-0000-0000-0000-000000000002'),'quiz award adopts original ledger');
select pg_temp.assert((select a.ledger_id=l.id and not a.backfill from public.fan_ticket_activity_awards a join public.fan_ticket_ledger l on l.id=a.ledger_id where a.action_key='membership_youtube'),'membership award adopts zero-snapshot canonical credit');
select pg_temp.assert((select scope_key='2026-09-10' and occurred_at='2026-09-09 15:01+00' and backfill from public.fan_ticket_activity_awards where action_key='checkin'),'historical KST scope, occurrence and backfill flag');

-- New quiz pass runs the existing one-ticket writer first and the activity trigger adopts exactly that credit.
insert into public.quiz_passes values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','2026-09-15 01:00+00');
select pg_temp.assert((select count(*) from public.fan_ticket_ledger where app_user_id='00000000-0000-0000-0000-000000000001' and celebrity_id='10000000-0000-0000-0000-000000000001' and source_type='passport_verification')=1,'new quiz exactly one canonical credit');
select pg_temp.assert((select count(*) from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000001' and action_key='verification')=1,'new quiz award receipt');

-- Pending/rejected membership states pay zero; approval pays one per platform, with no manual ticket snapshot.
insert into public.certification_submissions values
 ('30000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','pending','instagram',null),
 ('30000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','pending','tiktok',null);
update public.certification_submissions set status='rejected',reviewed_at='2026-09-15 02:00+00' where id='30000000-0000-0000-0000-000000000011';
select pg_temp.assert((select count(*) from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000001' and action_key in ('membership_instagram','membership_tiktok'))=0,'pending/rejected no membership award');
update public.certification_submissions set status='approved',reviewed_at='2026-09-15 03:00+00' where id='30000000-0000-0000-0000-000000000012';
insert into public.certification_submissions values
 ('30000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','approved','instagram','2026-09-15 03:01+00');
select pg_temp.assert((select count(*) from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000001' and action_key like 'membership_%')=3,'all three membership platforms');
select pg_temp.assert((select count(*) from public.fan_ticket_ledger where app_user_id='00000000-0000-0000-0000-000000000001' and source_type='manual_certification')=1,'new memberships have zero legacy ticket snapshot');

-- The remaining live action families pay once; comment rewrites and same-day check-in replays cannot duplicate.
insert into public.fan_reactions values ('40000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-09-15 03:10+00');
insert into public.fan_lounge_messages values ('42000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-09-15 03:11+00');
delete from public.fan_lounge_messages where id='42000000-0000-0000-0000-000000000011';
insert into public.celebrity_notices values ('43000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001');
insert into public.celebrity_notice_comments values ('44000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000011','2026-09-15 03:12+00');
insert into public.community_stamps values
 ('41000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','daily_checkin','daily:checkin:2026-09-15','2026-09-14 15:00+00'),
 ('41000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','daily_checkin','daily:checkin:2026-09-15','2026-09-14 16:00+00');
insert into public.community_stamp_share_links values ('45000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
insert into public.community_stamp_share_visits values
 ('46000000-0000-0000-0000-000000000011','45000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','2026-09-15 03:20+00'),
 ('46000000-0000-0000-0000-000000000012','45000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002','2026-09-15 03:21+00'),
 ('46000000-0000-0000-0000-000000000013','45000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000003','2026-09-15 03:22+00');
select pg_temp.assert((select count(distinct action_key) from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000001' and celebrity_id='10000000-0000-0000-0000-000000000001')=8,'all 8 action keys awarded');
select pg_temp.assert((select count(*) from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000001' and celebrity_id='10000000-0000-0000-0000-000000000001')=9,'daily check-in creates a second dated award');
select pg_temp.assert((select count(*) from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000001' and action_key='comment')=1,'comment delete/rewrite once');
select pg_temp.assert((select backfill from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000001' and action_key='comment'),'past-dated live evidence is marked backfill');
select pg_temp.assert((select count(*) from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000001' and action_key='checkin' and scope_key='2026-09-15')=1,'same KST day once');
select pg_temp.assert((select count(*) from public.fan_ticket_activity_awards where app_user_id='00000000-0000-0000-0000-000000000001' and action_key='share')=1,'self visit zero and verified visitors once');

-- Non-target, archived, disabled-user and irrelevant stamp evidence never pays.
insert into public.fan_reactions values
 ('40000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','2026-09-15 04:00+00'),
 ('40000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','2026-09-15 04:00+00');
insert into public.community_stamps values ('41000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','share','share:any','2026-09-15 04:00+00');
select pg_temp.assert((select count(*) from public.fan_ticket_activity_awards where source_id in ('40000000-0000-0000-0000-000000000021','40000000-0000-0000-0000-000000000022','41000000-0000-0000-0000-000000000021'))=0,'non-target evidence excluded');

-- Public roles cannot inspect private tables or call any activity RPC. Service can call only the two public server RPCs.
do $$ declare role_name text; signature regprocedure; begin
  foreach role_name in array array['anon','authenticated'] loop
    perform pg_temp.assert(not has_table_privilege(role_name,'public.fan_ticket_activity_policy','select'),'policy ACL '||role_name);
    perform pg_temp.assert(not has_table_privilege(role_name,'public.fan_ticket_activity_awards','select'),'award ACL '||role_name);
    foreach signature in array array[
      'public.fan_ticket_activity_sources(uuid,uuid)'::regprocedure,
      'public.award_fan_ticket_activity(uuid,uuid,text,text,boolean)'::regprocedure,
      'public.reward_fan_ticket_activity_event()'::regprocedure,
      'public.backfill_fan_ticket_activity(uuid,uuid,boolean,integer)'::regprocedure,
      'public.get_owned_fan_ticket_activity(uuid,text,bigint,integer,text)'::regprocedure
    ] loop perform pg_temp.assert(not has_function_privilege(role_name,signature,'execute'),'RPC ACL '||role_name||' '||signature::text); end loop;
  end loop;
  perform pg_temp.assert(has_function_privilege('service_role','public.backfill_fan_ticket_activity(uuid,uuid,boolean,integer)','execute'),'service backfill');
  perform pg_temp.assert(has_function_privilege('service_role','public.get_owned_fan_ticket_activity(uuid,text,bigint,integer,text)','execute'),'service read');
  perform pg_temp.assert(not has_function_privilege('service_role','public.award_fan_ticket_activity(uuid,uuid,text,text,boolean)','execute'),'service cannot direct award');
end $$;

-- History paginates existing credits/debits/refunds and reconciles every running balance.
select public.post_fan_ticket_entry('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','debit',-2,'benefit_entry','47000000-0000-0000-0000-000000000011','47000000-0000-0000-0000-000000000011',1,null,null);
insert into public.benefit_ticket_entries(id,benefit_id,ticket_ledger_id)
select '48000000-0000-0000-0000-000000000011','49000000-0000-0000-0000-000000000011',id from public.fan_ticket_ledger where source_id='47000000-0000-0000-0000-000000000011';
insert into public.benefit_localizations values
 ('49000000-0000-0000-0000-000000000011','ko','전시 티켓'),
 ('49000000-0000-0000-0000-000000000011','en','Exhibition ticket');
select public.post_fan_ticket_entry('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','credit',2,'benefit_entry_refund','48000000-0000-0000-0000-000000000011','47000000-0000-0000-0000-000000000012',1,null,null);
do $$ declare first_page jsonb; second_page jsonb; cursor bigint; begin
  first_page:=public.get_owned_fan_ticket_activity('00000000-0000-0000-0000-000000000001','elina',null,2,'en');
  perform pg_temp.assert(jsonb_array_length(first_page->'actions')=8,'guide action count');
  perform pg_temp.assert(jsonb_array_length(first_page->'history')=2,'first history page size');
  perform pg_temp.assert(first_page->>'nextBefore' is not null,'first history cursor');
  perform pg_temp.assert(first_page->'history'->0->>'label'='Exhibition ticket','localized refund label');
  perform pg_temp.assert(first_page->'history'->1->>'label'='Exhibition ticket','localized debit label');
  perform pg_temp.assert((first_page->>'balance')::bigint=(select resulting_balance from public.fan_ticket_ledger where app_user_id='00000000-0000-0000-0000-000000000001' and celebrity_id='10000000-0000-0000-0000-000000000001' order by owner_sequence desc limit 1),'reported balance');
  cursor:=(first_page->>'nextBefore')::bigint;
  second_page:=public.get_owned_fan_ticket_activity('00000000-0000-0000-0000-000000000001','elina',cursor,2,'en');
  perform pg_temp.assert(jsonb_array_length(second_page->'history')=2,'second history page size');
  perform pg_temp.assert((second_page->'history'->0->>'sequence')::bigint<cursor,'cursor excludes prior page');
end $$;
select pg_temp.assert(not exists(
  select 1 from (
    select owner_sequence,resulting_balance,sum(amount) over(order by owner_sequence) expected
    from public.fan_ticket_ledger where app_user_id='00000000-0000-0000-0000-000000000001' and celebrity_id='10000000-0000-0000-0000-000000000001'
  ) x where resulting_balance<>expected
),'ledger running balances reconcile');

commit;
