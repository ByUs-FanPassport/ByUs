begin;

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

create or replace function public.fan_ticket_activity_sources(p_owner uuid default null,p_creator uuid default null)
returns table(app_user_id uuid,celebrity_id uuid,action_key text,scope_key text,source_id uuid,occurred_at timestamptz)
language sql stable security definer set search_path='' as $$
with eligible as (
 select c.id from public.celebrities c join public.fan_ticket_activity_policy p on p.celebrity_id=c.id
 where p.enabled and c.status='published' and c.archived_at is null
   and (p_creator is null or c.id=p_creator)
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

revoke all on function public.recover_first_comment_community_stamp(uuid,uuid),
  public.fan_ticket_activity_sources(uuid,uuid),
  public.reward_fan_ticket_activity_event()
  from public,anon,authenticated,service_role;

commit;
