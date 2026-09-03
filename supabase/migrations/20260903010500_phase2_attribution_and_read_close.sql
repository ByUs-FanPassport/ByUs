-- Phase 2 closure: four-source verification attribution with immutable snapshots.
-- First Reaction presentation consumes the existing read model and needs no new
-- Stamp type, business row, blockchain job, or transaction.

alter table public.quiz_verification_attributions
  drop constraint if exists quiz_verification_attributions_source_type_check,
  drop constraint if exists quiz_verification_attribution_reaction_fk;
alter table public.quiz_verification_attributions
  add constraint quiz_verification_attributions_source_type_check
  check (source_type in ('creator_page', 'live', 'benefit', 'reaction'));

alter table public.quiz_pass_attributions
  drop constraint if exists quiz_pass_attributions_source_type_check,
  drop constraint if exists quiz_pass_attributions_source_id_fkey;
alter table public.quiz_pass_attributions
  add constraint quiz_pass_attributions_source_type_check
  check (source_type in ('creator_page', 'live', 'benefit', 'reaction'));

create function public.validate_quiz_verification_attribution_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  case new.source_type
    when 'creator_page' then
      if new.source_id <> new.celebrity_id
        or not exists (
          select 1 from public.celebrities c where c.id = new.source_id
        )
      then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='23514'; end if;
    when 'live' then
      if not exists (
        select 1 from public.live_events l
        where l.id = new.source_id and l.celebrity_id = new.celebrity_id
      )
      then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='23514'; end if;
    when 'benefit' then
      if not exists (
        select 1 from public.benefits b
        where b.id = new.source_id and b.celebrity_id = new.celebrity_id
      )
      then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='23514'; end if;
    when 'reaction' then
      if not exists (
        select 1 from public.fan_reactions r
        where r.id = new.source_id
          and r.app_user_id = new.app_user_id
          and r.celebrity_id = new.celebrity_id
      )
      then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='23514'; end if;
    else
      raise exception 'G2_ATTRIBUTION_INVALID' using errcode='23514';
  end case;
  return new;
end $$;

create trigger quiz_verification_attributions_validate_source
before insert on public.quiz_verification_attributions
for each row execute function public.validate_quiz_verification_attribution_source();

create function public.validate_quiz_pass_attribution_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists (
    select 1
    from public.quiz_verification_attributions a
    join public.quiz_passes p
      on p.id = new.quiz_pass_id
     and p.winning_attempt_id = new.attempt_id
    where a.attempt_id = new.attempt_id
      and a.source_type = new.source_type
      and a.source_id = new.source_id
  ) then
    raise exception 'G2_ATTRIBUTION_CONFLICT' using errcode='23514';
  end if;
  return new;
end $$;

create trigger quiz_pass_attributions_validate_snapshot
before insert on public.quiz_pass_attributions
for each row execute function public.validate_quiz_pass_attribution_snapshot();

create function public.reject_quiz_attribution_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'G2_ATTRIBUTION_IMMUTABLE' using errcode='55000';
end $$;

create trigger quiz_verification_attributions_immutable
before update or delete on public.quiz_verification_attributions
for each row execute function public.reject_quiz_attribution_mutation();

create trigger quiz_pass_attributions_immutable
before update or delete on public.quiz_pass_attributions
for each row execute function public.reject_quiz_attribution_mutation();

create or replace function public.start_owned_quiz_attempt_v2(
  p_app_user_id uuid,p_celebrity_slug text,p_idempotency_key uuid,
  p_source_type text default null,p_source_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_celebrity_id uuid; state public.quiz_verification_states%rowtype; result jsonb; v_attempt_id uuid;
begin
  select c.id into v_celebrity_id from public.celebrities c where c.slug=p_celebrity_slug and c.status='published';
  if not found then raise exception 'G2_QUIZ_UNAVAILABLE' using errcode='22023'; end if;
  insert into public.quiz_verification_states(app_user_id,celebrity_id) values(p_app_user_id,v_celebrity_id)
    on conflict do nothing;
  select * into state from public.quiz_verification_states s
    where s.app_user_id=p_app_user_id and s.celebrity_id=v_celebrity_id for update;
  if state.cooldown_until is not null and state.cooldown_until>statement_timestamp() then
    raise exception 'G2_VERIFICATION_COOLDOWN:%',state.cooldown_until using errcode='55000';
  elsif state.cooldown_until is not null then
    update public.quiz_verification_states set consecutive_failures=0,cooldown_until=null,updated_at=now()
      where app_user_id=p_app_user_id and celebrity_id=v_celebrity_id;
  end if;
  if (p_source_type is null)<>(p_source_id is null)
    or p_source_type is not null and p_source_type not in ('creator_page','live','benefit','reaction')
  then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='22023'; end if;
  if p_source_id is not null then
    case p_source_type
      when 'creator_page' then
        if p_source_id<>v_celebrity_id then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='22023'; end if;
      when 'live' then
        if not exists(select 1 from public.live_events l where l.id=p_source_id and l.celebrity_id=v_celebrity_id)
        then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='22023'; end if;
      when 'benefit' then
        if not exists(select 1 from public.benefits b where b.id=p_source_id and b.celebrity_id=v_celebrity_id)
        then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='22023'; end if;
      when 'reaction' then
        if not exists(select 1 from public.fan_reactions r where r.id=p_source_id
          and r.app_user_id=p_app_user_id and r.celebrity_id=v_celebrity_id)
        then raise exception 'G2_ATTRIBUTION_INVALID' using errcode='22023'; end if;
      else
        raise exception 'G2_ATTRIBUTION_INVALID' using errcode='22023';
    end case;
  end if;
  result:=public.start_owned_quiz_attempt(p_app_user_id,p_celebrity_slug,p_idempotency_key);
  if result->>'kind'='attempt' and p_source_id is not null then
    v_attempt_id:=(result->'attempt'->>'id')::uuid;
    insert into public.quiz_verification_attributions(attempt_id,app_user_id,celebrity_id,source_type,source_id)
      values(v_attempt_id,p_app_user_id,v_celebrity_id,p_source_type,p_source_id) on conflict(attempt_id) do nothing;
    if not exists(select 1 from public.quiz_verification_attributions a where a.attempt_id=v_attempt_id
      and a.source_type=p_source_type and a.source_id=p_source_id)
    then raise exception 'G2_ATTRIBUTION_CONFLICT' using errcode='23514'; end if;
  end if;
  return result;
end $$;

revoke all on function public.validate_quiz_verification_attribution_source(),
  public.validate_quiz_pass_attribution_snapshot(),public.reject_quiz_attribution_mutation()
  from public,anon,authenticated,service_role;
revoke all on function public.start_owned_quiz_attempt_v2(uuid,text,uuid,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.start_owned_quiz_attempt_v2(uuid,text,uuid,text,uuid) to service_role;
