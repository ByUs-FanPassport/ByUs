-- Phase 2: server-owned verification cooldown, immutable Reaction attribution,
-- and one Ticket for the canonical successful quiz pass.

create table public.quiz_verification_states (
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  consecutive_failures smallint not null default 0 check(consecutive_failures>=0),
  cooldown_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key(app_user_id,celebrity_id)
);

create table public.quiz_verification_attributions (
  attempt_id uuid primary key references public.quiz_attempts(id) on delete restrict,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  source_type text not null check(source_type='reaction'),
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique(attempt_id,app_user_id,celebrity_id),
  constraint quiz_verification_attribution_attempt_fk foreign key(attempt_id,app_user_id,celebrity_id)
    references public.quiz_attempts(id,app_user_id,celebrity_id) on delete restrict,
  constraint quiz_verification_attribution_reaction_fk foreign key(source_id,app_user_id,celebrity_id)
    references public.fan_reactions(id,app_user_id,celebrity_id) on delete restrict
);

create table public.quiz_pass_attributions (
  quiz_pass_id uuid primary key references public.quiz_passes(id) on delete restrict,
  attempt_id uuid not null unique references public.quiz_verification_attributions(attempt_id) on delete restrict,
  source_type text not null check(source_type='reaction'),
  source_id uuid not null references public.fan_reactions(id) on delete restrict,
  created_at timestamptz not null default now()
);

create function public.start_owned_quiz_attempt_v2(
  p_app_user_id uuid,p_celebrity_slug text,p_idempotency_key uuid,
  p_source_type text default null,p_source_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare celebrity_id uuid; state public.quiz_verification_states%rowtype; result jsonb; attempt_id uuid;
begin
  select c.id into celebrity_id from public.celebrities c where c.slug=p_celebrity_slug and c.status='published';
  if not found then raise exception 'G2_QUIZ_UNAVAILABLE' using errcode='22023'; end if;
  insert into public.quiz_verification_states(app_user_id,celebrity_id) values(p_app_user_id,celebrity_id)
    on conflict do nothing;
  select * into state from public.quiz_verification_states s
    where s.app_user_id=p_app_user_id and s.celebrity_id=celebrity_id for update;
  if state.cooldown_until is not null and state.cooldown_until>statement_timestamp() then
    raise exception 'G2_VERIFICATION_COOLDOWN:%',state.cooldown_until using errcode='55000';
  elsif state.cooldown_until is not null then
    update public.quiz_verification_states set consecutive_failures=0,cooldown_until=null,updated_at=now()
      where app_user_id=p_app_user_id and celebrity_id=celebrity_id;
  end if;
  if (p_source_type is null)<>(p_source_id is null) or p_source_type is not null and p_source_type<>'reaction'
  then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='22023'; end if;
  if p_source_id is not null and not exists(select 1 from public.fan_reactions r where r.id=p_source_id
    and r.app_user_id=p_app_user_id and r.celebrity_id=celebrity_id)
  then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='22023'; end if;
  result:=public.start_owned_quiz_attempt(p_app_user_id,p_celebrity_slug,p_idempotency_key);
  if result->>'kind'='attempt' and p_source_id is not null then
    attempt_id:=(result->'attempt'->>'id')::uuid;
    insert into public.quiz_verification_attributions(attempt_id,app_user_id,celebrity_id,source_type,source_id)
      values(attempt_id,p_app_user_id,celebrity_id,p_source_type,p_source_id) on conflict(attempt_id) do nothing;
    if not exists(select 1 from public.quiz_verification_attributions a where a.attempt_id=attempt_id
      and a.source_type=p_source_type and a.source_id=p_source_id)
    then raise exception 'G2_ATTRIBUTION_CONFLICT' using errcode='23514'; end if;
  end if;
  return result;
end $$;

create function public.update_quiz_verification_state()
returns trigger language plpgsql security definer set search_path='' as $$
declare failures smallint;
begin
  if old.status='open' and new.status='failed' then
    insert into public.quiz_verification_states(app_user_id,celebrity_id,consecutive_failures)
      values(new.app_user_id,new.celebrity_id,1)
    on conflict(app_user_id,celebrity_id) do update set
      consecutive_failures=public.quiz_verification_states.consecutive_failures+1,updated_at=now()
    returning consecutive_failures into failures;
    if failures>=3 then update public.quiz_verification_states set cooldown_until=now()+interval '1 minute',updated_at=now()
      where app_user_id=new.app_user_id and celebrity_id=new.celebrity_id; end if;
  elsif old.status='open' and new.status='passed' then
    insert into public.quiz_verification_states(app_user_id,celebrity_id,consecutive_failures,cooldown_until)
      values(new.app_user_id,new.celebrity_id,0,null)
    on conflict(app_user_id,celebrity_id) do update set consecutive_failures=0,cooldown_until=null,updated_at=now();
  end if;
  return new;
end $$;
create trigger quiz_attempts_update_verification_state after update of status on public.quiz_attempts
for each row execute function public.update_quiz_verification_state();

create function public.reward_successful_quiz_pass()
returns trigger language plpgsql security definer set search_path='' as $$
declare attribution public.quiz_verification_attributions%rowtype; policy_version integer;
begin
  select * into attribution from public.quiz_verification_attributions where attempt_id=new.winning_attempt_id;
  if found then insert into public.quiz_pass_attributions(quiz_pass_id,attempt_id,source_type,source_id)
    values(new.id,new.winning_attempt_id,attribution.source_type,attribution.source_id); end if;
  select a.policy_version into strict policy_version from public.reward_policy_activation a where a.singleton=true;
  perform public.post_fan_ticket_entry(new.app_user_id,new.celebrity_id,'credit',1,
    'passport_verification',new.id,new.id,policy_version,null,null);
  return new;
end $$;
create trigger quiz_passes_reward_and_attribute after insert on public.quiz_passes
for each row execute function public.reward_successful_quiz_pass();

alter table public.quiz_verification_states enable row level security;
alter table public.quiz_verification_states force row level security;
alter table public.quiz_verification_attributions enable row level security;
alter table public.quiz_verification_attributions force row level security;
alter table public.quiz_pass_attributions enable row level security;
alter table public.quiz_pass_attributions force row level security;
revoke all on table public.quiz_verification_states,public.quiz_verification_attributions,public.quiz_pass_attributions
  from public,anon,authenticated,service_role;
revoke all on function public.start_owned_quiz_attempt_v2(uuid,text,uuid,text,uuid),
  public.update_quiz_verification_state(),public.reward_successful_quiz_pass()
  from public,anon,authenticated,service_role;
grant execute on function public.start_owned_quiz_attempt_v2(uuid,text,uuid,text,uuid) to service_role;
