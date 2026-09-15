-- Additive creator activity rewards. No historical credit is issued by migration.
-- Admins run preview/backfill separately; existing quiz and LIVE writers stay intact.
create table public.fan_ticket_activity_policy (
  celebrity_id uuid primary key references public.celebrities(id),
  enabled boolean not null default true,
  activated_at timestamptz not null default statement_timestamp()
);
insert into public.fan_ticket_activity_policy(celebrity_id)
select id from public.celebrities where slug in ('elina','changha','yuna') and archived_at is null;

create table public.fan_ticket_activity_awards (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id),
  celebrity_id uuid not null references public.celebrities(id),
  action_key text not null,
  scope_key text not null,
  source_id uuid not null,
  occurred_at timestamptz not null,
  ledger_id uuid not null unique references public.fan_ticket_ledger(id),
  backfill boolean not null,
  unique(app_user_id,celebrity_id,action_key,scope_key)
);
alter table public.fan_ticket_activity_policy enable row level security;
alter table public.fan_ticket_activity_policy force row level security;
alter table public.fan_ticket_activity_awards enable row level security;
alter table public.fan_ticket_activity_awards force row level security;
revoke all on public.fan_ticket_activity_policy,public.fan_ticket_activity_awards from public,anon,authenticated,service_role;
create trigger fan_ticket_activity_awards_immutable before update or delete on public.fan_ticket_activity_awards
for each row execute function public.reject_fan_ticket_ledger_mutation();
create trigger fan_ticket_activity_awards_no_truncate before truncate on public.fan_ticket_activity_awards
for each statement execute function public.reject_fan_ticket_ledger_mutation();

-- Posting through the generic service ledger RPC cannot forge an activity bonus.
create function public.validate_fan_ticket_activity_credit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.source_type='fan_activity_reward' and not exists(
  select 1 from public.fan_ticket_activity_awards a where a.id=new.source_id and a.ledger_id=new.id
  and a.app_user_id=new.app_user_id and a.celebrity_id=new.celebrity_id
  and new.entry_kind='credit' and new.amount=1 and new.idempotency_key=a.id
 ) then raise exception 'TICKET_ACTIVITY_SOURCE_INVALID'; end if;
 return new;
end $$;
create constraint trigger fan_ticket_activity_credit_source after insert on public.fan_ticket_ledger
deferrable initially deferred for each row execute function public.validate_fan_ticket_activity_credit();

-- Canonical evidence shared by preview, live issuance and backfill. No client facts.
create function public.fan_ticket_activity_sources(p_owner uuid default null,p_creator uuid default null)
returns table(app_user_id uuid,celebrity_id uuid,action_key text,scope_key text,source_id uuid,occurred_at timestamptz)
language sql stable security definer set search_path='' as $$
with eligible as (
 select c.id from public.celebrities c join public.fan_ticket_activity_policy p on p.celebrity_id=c.id
 where p.enabled and c.status='published' and c.archived_at is null and (p_creator is null or c.id=p_creator)
), evidence as (
 select q.app_user_id,q.celebrity_id,'verification'::text action_key,'once'::text scope_key,q.id source_id,q.passed_at occurred_at
 from public.quiz_passes q join eligible c on c.id=q.celebrity_id where p_owner is null or q.app_user_id=p_owner
 union all
 select r.app_user_id,r.celebrity_id,'reaction','once',r.id,r.completed_at
 from public.fan_reactions r join eligible c on c.id=r.celebrity_id where p_owner is null or r.app_user_id=p_owner
 union all
 select m.app_user_id,m.celebrity_id,'comment','once',m.id,m.created_at
 from public.fan_lounge_messages m join eligible c on c.id=m.celebrity_id where p_owner is null or m.app_user_id=p_owner
 union all
 select m.app_user_id,n.celebrity_id,'comment','once',m.id,m.created_at
 from public.celebrity_notice_comments m join public.celebrity_notices n on n.id=m.notice_id join eligible c on c.id=n.celebrity_id
 where p_owner is null or m.app_user_id=p_owner
 union all
 select s.app_user_id,s.celebrity_id,'checkin',split_part(s.source_key,':',3),s.id,s.issued_at
 from public.community_stamps s join eligible c on c.id=s.celebrity_id
 where s.kind='daily_checkin' and (p_owner is null or s.app_user_id=p_owner)
 union all
 select s.app_user_id,s.celebrity_id,'membership_'||s.membership_platform::text,'once',s.id,s.reviewed_at
 from public.certification_submissions s join eligible c on c.id=s.celebrity_id
 where s.status='approved' and s.membership_platform is not null and (p_owner is null or s.app_user_id=p_owner)
 union all
 select l.owner_app_user_id,l.celebrity_id,'share','once',v.id,v.visited_at
 from public.community_stamp_share_visits v join public.community_stamp_share_links l on l.id=v.share_link_id
 join eligible c on c.id=l.celebrity_id
 where v.visitor_app_user_id<>l.owner_app_user_id and (p_owner is null or l.owner_app_user_id=p_owner)
)
select distinct on(e.app_user_id,e.celebrity_id,e.action_key,e.scope_key) e.*
from evidence e join public.app_users u on u.id=e.app_user_id and u.status='active'
order by e.app_user_id,e.celebrity_id,e.action_key,e.scope_key,e.occurred_at,e.source_id;
$$;

-- Internal only. Serialize on the existing owner balance before business scopes:
-- the legacy quiz writer already holds this lock when its AFTER trigger runs.
-- Newly posted keys are private receipt UUIDs, never shared with legacy callers.
create function public.award_fan_ticket_activity(p_owner uuid,p_creator uuid,p_action text,p_scope text,p_backfill boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare s record; old_credit public.fan_ticket_ledger%rowtype; receipt_id uuid:=extensions.gen_random_uuid();
 ledger_id uuid; policy integer; result jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phase1:ticket:balance:'||p_owner::text||':'||p_creator::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('activity-ticket:'||p_owner::text||':'||p_creator::text||':'||p_action||':'||p_scope,0));
 if exists(select 1 from public.fan_ticket_activity_awards a where a.app_user_id=p_owner and a.celebrity_id=p_creator and a.action_key=p_action and a.scope_key=p_scope) then return false; end if;
 select * into s from public.fan_ticket_activity_sources(p_owner,p_creator) x where x.action_key=p_action and x.scope_key=p_scope;
 if not found then return false; end if;
 -- Adopt prior canonical credits even if spent. Never use current balance to infer payment.
 select l.* into old_credit from public.fan_ticket_ledger l
 where l.app_user_id=p_owner and l.celebrity_id=p_creator and l.entry_kind='credit' and l.source_id=s.source_id
 and ((p_action='verification' and l.source_type='passport_verification')
   or (p_action like 'membership_%' and l.source_type='manual_certification'))
 order by l.owner_sequence limit 1;
 if found then ledger_id:=old_credit.id;
 else
   select policy_version into strict policy from public.reward_policy_activation where singleton;
   result:=public.post_fan_ticket_entry(p_owner,p_creator,'credit',1,'fan_activity_reward',receipt_id,receipt_id,policy,null,null);
   ledger_id:=(result->>'entryId')::uuid;
 end if;
 insert into public.fan_ticket_activity_awards(id,app_user_id,celebrity_id,action_key,scope_key,source_id,occurred_at,ledger_id,backfill)
 values(receipt_id,p_owner,p_creator,p_action,p_scope,s.source_id,s.occurred_at,ledger_id,
  (p_backfill or s.occurred_at<(select activated_at from public.fan_ticket_activity_policy where celebrity_id=p_creator)) and old_credit.id is null);
 return old_credit.id is null;
end $$;

-- Trigger naming deliberately follows quiz_passes_reward_and_attribute so its
-- existing 1-ticket transaction is adopted, never independently paid twice.
create function public.reward_fan_ticket_activity_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; creator_id uuid; action text; scope text:='once';
begin
 if tg_table_name='community_stamp_share_visits' then
   select l.owner_app_user_id,l.celebrity_id into owner_id,creator_id from public.community_stamp_share_links l where l.id=new.share_link_id;
   action:='share';
 else
   owner_id:=new.app_user_id;
   if tg_table_name='celebrity_notice_comments' then
     select n.celebrity_id into creator_id from public.celebrity_notices n where n.id=new.notice_id;
   else creator_id:=new.celebrity_id; end if;
   case tg_table_name
   when 'quiz_passes' then action:='verification';
   when 'fan_reactions' then action:='reaction';
   when 'fan_lounge_messages','celebrity_notice_comments' then action:='comment';
   when 'community_stamps' then
     if new.kind<>'daily_checkin' then return new; end if;
     action:='checkin';scope:=split_part(new.source_key,':',3);
   when 'certification_submissions' then
     if new.status<>'approved' or new.membership_platform is null then return new; end if;
     action:='membership_'||new.membership_platform::text;
   else return new;
   end case;
 end if;
 perform public.award_fan_ticket_activity(owner_id,creator_id,action,scope,false);
 return new;
end $$;
create trigger zz_ticket_activity after insert on public.quiz_passes for each row execute function public.reward_fan_ticket_activity_event();
create trigger zz_ticket_activity after insert on public.fan_reactions for each row execute function public.reward_fan_ticket_activity_event();
create trigger zz_ticket_activity after insert on public.fan_lounge_messages for each row execute function public.reward_fan_ticket_activity_event();
create trigger zz_ticket_activity after insert on public.celebrity_notice_comments for each row execute function public.reward_fan_ticket_activity_event();
create trigger zz_ticket_activity after insert on public.community_stamps for each row execute function public.reward_fan_ticket_activity_event();
create trigger zz_ticket_activity after insert on public.community_stamp_share_visits for each row execute function public.reward_fan_ticket_activity_event();
create trigger zz_ticket_activity after insert or update of status on public.certification_submissions for each row execute function public.reward_fan_ticket_activity_event();

create function public.backfill_fan_ticket_activity(p_actor uuid,p_allowlist uuid,p_apply boolean default false,p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s record; paid integer:=0; processed integer:=0; total bigint; groups jsonb;
begin
 perform public.assert_certification_admin(p_actor,p_allowlist);
 if p_limit is null or p_limit<1 or p_limit>1000 or p_apply is null then raise exception 'TICKET_INVALID_REQUEST'; end if;
 if p_apply then
   for s in select x.* from public.fan_ticket_activity_sources() x
    where not exists(select 1 from public.fan_ticket_activity_awards a where a.app_user_id=x.app_user_id and a.celebrity_id=x.celebrity_id and a.action_key=x.action_key and a.scope_key=x.scope_key)
    order by x.app_user_id,x.celebrity_id,x.action_key,x.scope_key limit p_limit
   loop
     if public.award_fan_ticket_activity(s.app_user_id,s.celebrity_id,s.action_key,s.scope_key,true) then paid:=paid+1; end if;
     processed:=processed+1;
   end loop;
 end if;
 select count(*),coalesce(jsonb_agg(g),'[]'::jsonb) into total,groups from (
   select c.slug,x.action_key,count(*) as records,
    count(*) filter(where not exists(select 1 from public.fan_ticket_ledger l where l.app_user_id=x.app_user_id and l.celebrity_id=x.celebrity_id and l.source_id=x.source_id and l.entry_kind='credit'
     and ((x.action_key='verification' and l.source_type='passport_verification') or (x.action_key like 'membership_%' and l.source_type='manual_certification')))) as tickets
   from public.fan_ticket_activity_sources() x join public.celebrities c on c.id=x.celebrity_id
   where not exists(select 1 from public.fan_ticket_activity_awards a where a.app_user_id=x.app_user_id and a.celebrity_id=x.celebrity_id and a.action_key=x.action_key and a.scope_key=x.scope_key)
   group by c.slug,x.action_key order by c.slug,x.action_key
 ) g;
 if p_apply then
   insert into public.audit_logs(actor_app_user_id,actor_admin_allowlist_id,action,entity_type,entity_id,correlation_id,before_after_summary)
   values(p_actor,p_allowlist,'ticket.activity.backfill','ticket_activity_policy','elina,changha,yuna',extensions.gen_random_uuid(),
    jsonb_build_object('processed',processed,'ticketsPaid',paid,'remainingGroups',total));
 end if;
 return jsonb_build_object('applied',p_apply,'processed',processed,'ticketsPaid',paid,'remainingGroups',total,'remaining',groups);
end $$;

create function public.get_owned_fan_ticket_activity(p_app_user_id uuid,p_slug text,p_before_sequence bigint default null,p_limit integer default 20,p_locale text default 'ko')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.celebrities%rowtype; actions jsonb; history jsonb; next_before text; enabled boolean; today text:=public.community_stamp_kst_date()::text;
begin
 if p_app_user_id is null or not exists(select 1 from public.app_users u where u.id=p_app_user_id and u.status='active') then raise exception 'TICKET_NOT_FOUND'; end if;
 if p_limit is null or p_limit<1 or p_limit>50 or p_before_sequence<1 or p_locale is null or p_locale not in ('ko','en') then raise exception 'TICKET_INVALID_REQUEST'; end if;
 select * into c from public.celebrities where slug=p_slug and status='published' and archived_at is null;
 if not found then raise exception 'TICKET_NOT_FOUND'; end if;
 enabled:=coalesce((select p.enabled from public.fan_ticket_activity_policy p where p.celebrity_id=c.id),false);
 select coalesce(jsonb_agg(jsonb_build_object('key',k.key,'amount',1,
  'status',case when exists(select 1 from public.fan_ticket_activity_awards a where a.app_user_id=p_app_user_id and a.celebrity_id=c.id and a.action_key=k.key and a.scope_key=case when k.key='checkin' then today else 'once' end)
   or (k.key='verification' and exists(select 1 from public.fan_ticket_ledger l where l.app_user_id=p_app_user_id and l.celebrity_id=c.id and l.source_type='passport_verification' and l.entry_kind='credit')) then 'awarded'
  when exists(select 1 from public.fan_ticket_activity_sources(p_app_user_id,c.id) x where x.action_key=k.key and x.scope_key=case when k.key='checkin' then today else 'once' end) then 'processing'
  when k.key like 'membership_%' and exists(select 1 from public.certification_submissions s where s.app_user_id=p_app_user_id and s.celebrity_id=c.id and 'membership_'||s.membership_platform::text=k.key and s.status='pending') then 'pending'
  when k.key='share' and exists(select 1 from public.community_stamp_share_links l where l.owner_app_user_id=p_app_user_id and l.celebrity_id=c.id) then 'pending'
  else 'available' end,
  'href',case when k.key='verification' then '/c/'||c.slug||'/verify'
    when k.key='reaction' then '/'||c.slug
    when k.key='comment' then '/'||c.slug||'#cheers'
    when k.key='checkin' then '/'||c.slug||'#daily-checkin'
    when k.key like 'membership_%' then '/'||c.slug||'?tab=certifications#celebrity-content'
    else coalesce((select '/passports/'||p.id::text||'#community-stamps' from public.fan_passports p where p.app_user_id=p_app_user_id and p.celebrity_id=c.id),'/c/'||c.slug||'/verify') end
 ) order by k.pos),'[]'::jsonb) into actions
 from unnest(array['verification','reaction','checkin','comment','membership_instagram','membership_tiktok','membership_youtube','share']) with ordinality k(key,pos) where enabled;
 with page as (
  select l.*,a.action_key,a.occurred_at,a.backfill from public.fan_ticket_ledger l
  left join public.fan_ticket_activity_awards a on a.ledger_id=l.id
  where l.app_user_id=p_app_user_id and l.celebrity_id=c.id and (p_before_sequence is null or l.owner_sequence<p_before_sequence)
  order by l.owner_sequence desc limit p_limit+1
 ), visible as(select * from page order by owner_sequence desc limit p_limit)
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'sequence',v.owner_sequence,'sourceType',coalesce(v.action_key,v.source_type),
  'label',coalesce((select bl.title from public.benefit_ticket_entries e join public.benefit_localizations bl on bl.benefit_id=e.benefit_id and bl.locale::text=p_locale where e.ticket_ledger_id=v.id or (v.source_type='benefit_entry_refund' and v.source_id=e.id) limit 1),v.action_key,v.source_type),
  'amount',v.amount,'createdAt',v.created_at,'occurredAt',coalesce(v.occurred_at,v.created_at),'backfill',coalesce(v.backfill,false),'balance',v.resulting_balance)
  order by v.owner_sequence desc),'[]'::jsonb),
  case when (select count(*) from page)>p_limit then min(v.owner_sequence)::text else null end
 into history,next_before from visible v;
 return jsonb_build_object('enabled',enabled,'creator',jsonb_build_object('slug',c.slug,'name',coalesce((select name from public.celebrity_localizations where celebrity_id=c.id and locale::text=p_locale),c.slug)),
 'balance',public.get_fan_ticket_balance(p_app_user_id,c.id),'today',today,'actions',actions,'history',history,'nextBefore',next_before);
end $$;

revoke all on function public.validate_fan_ticket_activity_credit(),public.fan_ticket_activity_sources(uuid,uuid),public.award_fan_ticket_activity(uuid,uuid,text,text,boolean),public.reward_fan_ticket_activity_event(),
 public.backfill_fan_ticket_activity(uuid,uuid,boolean,integer),public.get_owned_fan_ticket_activity(uuid,text,bigint,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.backfill_fan_ticket_activity(uuid,uuid,boolean,integer),public.get_owned_fan_ticket_activity(uuid,text,bigint,integer,text) to service_role;
