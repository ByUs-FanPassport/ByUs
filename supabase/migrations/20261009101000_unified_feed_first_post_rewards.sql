-- New fan posts participate in the existing first-comment rewards. Existing
-- rows remain ineligible so deploying this migration never backfills rewards.
alter table public.fan_posts
  add column first_comment_eligible boolean not null default false;
alter table public.fan_posts
  alter column first_comment_eligible set default true;

create or replace function public.assert_community_stamp_source(
  p_app_user_id uuid,
  p_celebrity_id uuid,
  p_kind public.community_stamp_kind,
  p_source_key text
) returns void language plpgsql stable set search_path='' as $$
declare
  v_source_kind text;
  v_source_id uuid;
  v_role text;
  v_expected text;
begin
  if p_kind='welcome' then
    if p_celebrity_id is not null or p_source_key<>'welcome:'||p_app_user_id::text then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
  elsif p_kind='daily_checkin' then
    v_expected:='daily-checkin:'||p_celebrity_id::text||':'||public.community_stamp_kst_date()::text;
    if p_celebrity_id is null or p_source_key<>v_expected then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
  elsif p_kind='first_comment' then
    v_source_kind:=pg_catalog.split_part(p_source_key,':',2);
    if p_source_key !~ '^first-comment:(lounge|notice|post):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
    v_source_id:=pg_catalog.split_part(p_source_key,':',3)::uuid;
    select source_key into v_expected from (
      select 'first-comment:lounge:'||message.id::text source_key,message.created_at,message.id
      from public.fan_lounge_messages message
      where message.app_user_id=p_app_user_id and message.celebrity_id=p_celebrity_id
      union all
      select 'first-comment:notice:'||comment.id::text,comment.created_at,comment.id
      from public.celebrity_notice_comments comment
      join public.celebrity_notices notice on notice.id=comment.notice_id
      where comment.app_user_id=p_app_user_id and notice.celebrity_id=p_celebrity_id
      union all
      select 'first-comment:post:'||post.id::text,post.created_at,post.id
      from public.fan_posts post
      where post.app_user_id=p_app_user_id and post.celebrity_id=p_celebrity_id
        and post.first_comment_eligible
    ) comments order by created_at,id,source_key limit 1;
    if p_celebrity_id is null or v_expected is distinct from p_source_key
      or (v_source_kind='lounge' and not exists(
        select 1 from public.fan_lounge_messages message
        where message.id=v_source_id and message.app_user_id=p_app_user_id
          and message.celebrity_id=p_celebrity_id))
      or (v_source_kind='notice' and not exists(
        select 1 from public.celebrity_notice_comments comment
        join public.celebrity_notices notice on notice.id=comment.notice_id
        where comment.id=v_source_id and comment.app_user_id=p_app_user_id
          and notice.celebrity_id=p_celebrity_id))
      or (v_source_kind='post' and not exists(
        select 1 from public.fan_posts post
        where post.id=v_source_id and post.app_user_id=p_app_user_id
          and post.celebrity_id=p_celebrity_id and post.first_comment_eligible)) then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
  elsif p_kind='invite' then
    if p_source_key !~ '^invite:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(inviter|invitee)$' then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
    v_source_id:=pg_catalog.split_part(p_source_key,':',2)::uuid;
    v_role:=pg_catalog.split_part(p_source_key,':',3);
    if p_celebrity_id is not null or not exists(
      select 1 from public.community_stamp_invite_redemptions redemption
      where redemption.id=v_source_id
        and ((v_role='inviter' and redemption.inviter_app_user_id=p_app_user_id)
          or (v_role='invitee' and redemption.invitee_app_user_id=p_app_user_id))
    ) then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
  elsif p_kind='share' then
    if p_source_key !~ '^verified-share-visit:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
    v_source_id:=pg_catalog.split_part(p_source_key,':',2)::uuid;
    if p_celebrity_id is null or not exists(
      select 1 from public.community_stamp_share_visits visit
      join public.community_stamp_share_links link on link.id=visit.share_link_id
      join public.app_users owner on owner.id=link.owner_app_user_id
      join public.fan_passports passport on passport.id=link.fan_passport_id
      where visit.id=v_source_id and link.owner_app_user_id=p_app_user_id
        and link.celebrity_id=p_celebrity_id
        and visit.visitor_app_user_id<>link.owner_app_user_id
        and owner.status='active'
        and passport.app_user_id=link.owner_app_user_id
        and passport.celebrity_id=link.celebrity_id
        and passport.business_status='issued'
    ) then
      raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end if;
  else
    raise exception 'COMMUNITY_STAMP_UNAVAILABLE' using errcode='P0001';
  end if;
end $$;

-- Patch the deployed function body instead of copying its older definition;
-- this preserves the owner/creator canary gate added by later migrations.
do $$
declare
  v_signature regprocedure:='public.issue_community_stamp(uuid,uuid,public.community_stamp_kind,text)'::regprocedure;
  v_definition text;
  v_old text:=$patch$if pg_catalog.split_part(p_source_key,':',2)='lounge' then
      select created_at into strict v_occurred_at from public.fan_lounge_messages where id=v_source_id;
    else select created_at into strict v_occurred_at from public.celebrity_notice_comments where id=v_source_id; end if;$patch$;
  v_new text:=$patch$case pg_catalog.split_part(p_source_key,':',2)
    when 'lounge' then select created_at into strict v_occurred_at from public.fan_lounge_messages where id=v_source_id;
    when 'notice' then select created_at into strict v_occurred_at from public.celebrity_notice_comments where id=v_source_id;
    when 'post' then select created_at into strict v_occurred_at from public.fan_posts where id=v_source_id and first_comment_eligible;
    else raise exception 'COMMUNITY_STAMP_INVALID_REQUEST' using errcode='22023';
    end case;$patch$;
begin
  v_definition:=pg_catalog.pg_get_functiondef(v_signature);
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then
    raise exception 'COMMUNITY_STAMP_ISSUER_SHAPE_CHANGED';
  end if;
  execute replace(v_definition,v_old,v_new);
end $$;

create or replace function public.recover_first_comment_community_stamp(
  p_app_user_id uuid,p_celebrity_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_source_key text;
begin
  if exists(select 1 from public.community_stamps stamp
    where stamp.app_user_id=p_app_user_id and stamp.celebrity_id=p_celebrity_id
      and stamp.kind='first_comment') then return false; end if;
  if not exists(select 1 from public.celebrities celebrity
    where celebrity.id=p_celebrity_id and celebrity.status='published'
      and celebrity.archived_at is null) then return false; end if;
  select source_key into v_source_key from (
    select 'first-comment:lounge:'||message.id::text source_key,message.created_at,message.id
      from public.fan_lounge_messages message
      where message.app_user_id=p_app_user_id and message.celebrity_id=p_celebrity_id
    union all
    select 'first-comment:notice:'||comment.id::text,comment.created_at,comment.id
      from public.celebrity_notice_comments comment
      join public.celebrity_notices notice on notice.id=comment.notice_id
      where comment.app_user_id=p_app_user_id and notice.celebrity_id=p_celebrity_id
    union all
    select 'first-comment:post:'||post.id::text,post.created_at,post.id
      from public.fan_posts post
      where post.app_user_id=p_app_user_id and post.celebrity_id=p_celebrity_id
        and post.first_comment_eligible
  ) comments order by created_at,id,source_key limit 1;
  if v_source_key is null then return false; end if;
  return public.issue_community_stamp(
    p_app_user_id,p_celebrity_id,'first_comment',v_source_key);
end $$;

create or replace function public.award_first_comment_community_stamp()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_celebrity_id uuid;
begin
  if tg_table_name='fan_posts' then
    if not new.first_comment_eligible then return new; end if;
    v_celebrity_id:=new.celebrity_id;
  elsif tg_table_name='fan_lounge_messages' then
    v_celebrity_id:=new.celebrity_id;
  else
    select notice.celebrity_id into v_celebrity_id
      from public.celebrity_notices notice where notice.id=new.notice_id;
  end if;
  if exists(select 1 from public.app_users app_user
      where app_user.id=new.app_user_id and app_user.status='active')
    and exists(select 1 from public.user_wallets wallet
      where wallet.app_user_id=new.app_user_id and wallet.chain_id=91342
        and wallet.provider='privy' and wallet.wallet_type='embedded') then
    perform public.recover_first_comment_community_stamp(new.app_user_id,v_celebrity_id);
  end if;
  return new;
end $$;

create trigger fan_posts_award_first_comment
after insert on public.fan_posts for each row
execute function public.award_first_comment_community_stamp();

create or replace function public.claim_welcome_community_stamp(p_app_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_awarded boolean;v_creator record;
begin
  v_awarded:=public.issue_community_stamp(
    p_app_user_id,null,'welcome','welcome:'||p_app_user_id::text);
  for v_creator in
    select distinct owned_comments.creator_id from (
      select message.celebrity_id creator_id from public.fan_lounge_messages message
        where message.app_user_id=p_app_user_id
      union
      select notice.celebrity_id from public.celebrity_notice_comments comment
        join public.celebrity_notices notice on notice.id=comment.notice_id
        where comment.app_user_id=p_app_user_id
      union
      select post.celebrity_id from public.fan_posts post
        where post.app_user_id=p_app_user_id and post.first_comment_eligible
    ) owned_comments
    join public.celebrities celebrity on celebrity.id=owned_comments.creator_id
      and celebrity.status='published' and celebrity.archived_at is null
  loop
    perform public.recover_first_comment_community_stamp(
      p_app_user_id,v_creator.creator_id);
  end loop;
  return jsonb_build_object('awarded',v_awarded);
end $$;

create or replace function public.fan_ticket_activity_sources(p_owner uuid default null,p_creator uuid default null)
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
 select p.app_user_id,p.celebrity_id,'comment','once',p.id,p.created_at
 from public.fan_posts p join eligible c on c.id=p.celebrity_id
 where p.first_comment_eligible and (p_owner is null or p.app_user_id=p_owner)
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

create or replace function public.reward_fan_ticket_activity_event() returns trigger
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
   when 'fan_posts' then
     if not new.first_comment_eligible then return new; end if;
     action:='comment';
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

create trigger zz_ticket_activity after insert on public.fan_posts
for each row execute function public.reward_fan_ticket_activity_event();
