begin;

lock table public.fan_reactions in share mode;

drop trigger if exists celebrity_quizzes_reject_brand on public.celebrity_quizzes;
drop trigger if exists fan_passports_reject_brand on public.fan_passports;
drop function if exists public.reject_brand_quiz_or_passport();

create or replace function public.issue_first_reaction_stamp()
returns trigger language plpgsql security definer set search_path='' as $$
declare activity_id uuid:=extensions.gen_random_uuid(); passport_id uuid;
begin
  insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id,occurred_at)
  values(activity_id,new.app_user_id,new.celebrity_id,'first_reaction','fan_reaction',new.id,new.completed_at)
  on conflict(activity_type,source_type,source_id) do nothing;
  select id into strict activity_id from public.fan_activities where activity_type='first_reaction' and source_type='fan_reaction' and source_id=new.id;
  select id into passport_id from public.fan_passports where app_user_id=new.app_user_id and celebrity_id=new.celebrity_id and business_status='issued';
  insert into public.first_reaction_stamps(reaction_id,app_user_id,celebrity_id,passport_id,activity_id,blockchain_source_id,mint_status,tx_hash,token_id)
  values(new.id,new.app_user_id,new.celebrity_id,passport_id,activity_id,new.id,new.mint_status,new.tx_hash,new.token_id)
  on conflict(reaction_id) do nothing;
  return new;
end $$;

insert into public.fan_activities(id,app_user_id,celebrity_id,activity_type,source_type,source_id,occurred_at)
select extensions.gen_random_uuid(),reaction.app_user_id,reaction.celebrity_id,
  'first_reaction','fan_reaction',reaction.id,reaction.completed_at
from public.fan_reactions reaction
join public.celebrities celebrity on celebrity.id=reaction.celebrity_id
where celebrity.primary_role='brand'
  and not exists (
    select 1 from public.fan_activities activity
    where activity.activity_type='first_reaction'
      and activity.source_type='fan_reaction'
      and activity.source_id=reaction.id
  )
on conflict(activity_type,source_type,source_id) do nothing;

insert into public.first_reaction_stamps(
  reaction_id,app_user_id,celebrity_id,passport_id,activity_id,
  blockchain_source_id,mint_status,tx_hash,token_id,issued_at
)
select reaction.id,reaction.app_user_id,reaction.celebrity_id,passport.id,activity.id,
  reaction.id,reaction.mint_status,reaction.tx_hash,reaction.token_id,reaction.completed_at
from public.fan_reactions reaction
join public.celebrities celebrity on celebrity.id=reaction.celebrity_id and celebrity.primary_role='brand'
join public.fan_activities activity on activity.activity_type='first_reaction'
  and activity.source_type='fan_reaction' and activity.source_id=reaction.id
left join public.fan_passports passport on passport.app_user_id=reaction.app_user_id
  and passport.celebrity_id=reaction.celebrity_id and passport.business_status='issued'
where not exists (
  select 1 from public.first_reaction_stamps stamp where stamp.reaction_id=reaction.id
)
on conflict(reaction_id) do nothing;

commit;
