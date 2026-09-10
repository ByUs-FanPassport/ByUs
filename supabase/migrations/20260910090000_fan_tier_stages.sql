-- Additive 11-stage display progression for the active reward policy. Major
-- tier entitlement, rewards, Tickets, and public activity remain unchanged.

create table public.reward_policy_tier_stages (
  policy_version integer not null,
  stage_key text not null,
  tier_name text not null,
  subdivision smallint not null check (subdivision between 1 and 4),
  stage_rank smallint not null check (stage_rank between 1 and 11),
  minimum_score integer not null check (minimum_score >= 0),
  primary key (policy_version, stage_key),
  unique (policy_version, stage_rank),
  unique (policy_version, minimum_score),
  unique (policy_version, tier_name, subdivision),
  constraint reward_policy_tier_stages_major_tier_fk
    foreign key (policy_version, tier_name)
    references public.reward_policy_tier_milestones(policy_version, tier_name)
    on delete restrict,
  constraint reward_policy_tier_stages_key_canonical
    check (stage_key = lower(tier_name) || '-' || subdivision::text)
);

insert into public.reward_policy_tier_stages(
  policy_version, stage_key, tier_name, subdivision, stage_rank, minimum_score
) values
  (2, 'bronze-1',   'Bronze',   1,  1,   0),
  (2, 'silver-1',   'Silver',   1,  2,  15),
  (2, 'silver-2',   'Silver',   2,  3,  30),
  (2, 'gold-1',     'Gold',     1,  4,  50),
  (2, 'gold-2',     'Gold',     2,  5,  70),
  (2, 'gold-3',     'Gold',     3,  6,  95),
  (2, 'platinum-1', 'Platinum', 1,  7, 120),
  (2, 'platinum-2', 'Platinum', 2,  8, 150),
  (2, 'platinum-3', 'Platinum', 3,  9, 180),
  (2, 'platinum-4', 'Platinum', 4, 10, 215),
  (2, 'diamond-1',  'Diamond',  1, 11, 250);

do $$
begin
  if (select count(*) from public.reward_policy_tier_stages where policy_version = 2) <> 11
    or exists (
      select 1
      from public.reward_policy_tier_stages stage
      join public.reward_policy_tier_milestones milestone
        on milestone.policy_version = stage.policy_version
       and milestone.tier_name = stage.tier_name
      where stage.policy_version = 2
        and stage.subdivision = 1
        and stage.minimum_score <> milestone.minimum_score
    )
    or exists (
      select 1
      from public.reward_policy_tier_milestones milestone
      left join public.reward_policy_tier_stages stage
        on stage.policy_version = milestone.policy_version
       and stage.tier_name = milestone.tier_name
       and stage.subdivision = 1
      where milestone.policy_version = 2
        and stage.stage_key is null
    )
    or exists (
      select 1
      from (
        select
          stage_rank,
          minimum_score,
          lag(minimum_score) over (order by stage_rank) as previous_minimum_score
        from public.reward_policy_tier_stages
        where policy_version = 2
      ) ordered
      where (stage_rank = 1 and minimum_score <> 0)
         or (stage_rank > 1 and minimum_score <= previous_minimum_score)
    ) then
    raise exception 'reward policy 2 Fan stages are invalid';
  end if;
end;
$$;

create function public.reject_reward_policy_tier_stage_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'reward policy Tier stages are immutable';
end;
$$;

create trigger reward_policy_tier_stages_immutable
before insert or update or delete on public.reward_policy_tier_stages
for each row execute function public.reject_reward_policy_tier_stage_mutation();

create trigger reward_policy_tier_stages_reject_truncate
before truncate on public.reward_policy_tier_stages
for each statement execute function public.reject_reward_policy_tier_stage_mutation();

alter table public.reward_policy_tier_stages enable row level security;
alter table public.reward_policy_tier_stages force row level security;

revoke all on table public.reward_policy_tier_stages
  from public, anon, authenticated, service_role;
revoke all on function public.reject_reward_policy_tier_stage_mutation()
  from public, anon, authenticated, service_role;

create function public.get_fan_stage_progress(
  p_score integer,
  p_effective_tier text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with active_policy as materialized (
    select activation.policy_version
    from public.reward_policy_activation activation
    where activation.singleton = true
  ),
  floor_stage as materialized (
    select stage.stage_rank
    from public.reward_policy_tier_stages stage
    join active_policy policy on policy.policy_version = stage.policy_version
    where stage.tier_name = p_effective_tier
      and stage.subdivision = 1
  ),
  score_stage as materialized (
    select stage.stage_rank
    from public.reward_policy_tier_stages stage
    join active_policy policy on policy.policy_version = stage.policy_version
    where stage.minimum_score <= p_score
    order by stage.stage_rank desc
    limit 1
  ),
  selected_rank as materialized (
    select greatest(floor_stage.stage_rank, coalesce(score_stage.stage_rank, 0)) as stage_rank
    from floor_stage
    left join score_stage on true
  ),
  selected as materialized (
    select current_stage.*, next_stage.stage_key as next_key,
      next_stage.tier_name as next_tier,
      next_stage.subdivision as next_subdivision,
      next_stage.stage_rank as next_rank,
      next_stage.minimum_score as next_minimum_score
    from selected_rank selected_rank
    join active_policy policy on true
    join public.reward_policy_tier_stages current_stage
      on current_stage.policy_version = policy.policy_version
     and current_stage.stage_rank = selected_rank.stage_rank
    left join public.reward_policy_tier_stages next_stage
      on next_stage.policy_version = current_stage.policy_version
     and next_stage.stage_rank = current_stage.stage_rank + 1
  )
  select jsonb_build_object(
    'policyVersion', selected.policy_version,
    'current', jsonb_build_object(
      'key', selected.stage_key,
      'tier', selected.tier_name,
      'subdivision', selected.subdivision,
      'rank', selected.stage_rank,
      'minimumScore', selected.minimum_score
    ),
    'next', case when selected.next_key is null then null else jsonb_build_object(
      'key', selected.next_key,
      'tier', selected.next_tier,
      'subdivision', selected.next_subdivision,
      'rank', selected.next_rank,
      'minimumScore', selected.next_minimum_score
    ) end,
    'remaining', case when selected.next_key is null then 0
      else greatest(selected.next_minimum_score - p_score, 0) end,
    'progressPercent', case when selected.next_key is null then 100 else
      greatest(0, least(100, floor(
        ((p_score - selected.minimum_score)::numeric * 100)
        / (selected.next_minimum_score - selected.minimum_score)
      )::integer)) end
  )
  from selected;
$$;

create function public.get_owned_my_fan_activity_with_stages(
  p_app_user_id uuid,
  p_locale public.content_locale,
  p_as_of timestamptz default pg_catalog.now()
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as materialized (
    select public.get_owned_my_fan_activity(p_app_user_id, p_locale, p_as_of) as value
  ),
  creators as materialized (
    select coalesce(jsonb_agg(
      case
        when creator.value -> 'passport' is null
          or jsonb_typeof(creator.value -> 'passport') = 'null'
        then creator.value
        else jsonb_set(
          creator.value,
          '{passport}',
          (creator.value -> 'passport') || jsonb_build_object(
            'stageProgress', public.get_fan_stage_progress(
              (creator.value -> 'passport' ->> 'score')::integer,
              creator.value -> 'passport' ->> 'tier'
            )
          )
        )
      end
      order by creator.ordinality
    ), '[]'::jsonb) as value
    from base
    cross join lateral jsonb_array_elements(base.value -> 'creators')
      with ordinality as creator(value, ordinality)
  )
  select jsonb_set(base.value, '{creators}', creators.value)
  from base cross join creators;
$$;

create function public.get_owned_passport_collection_with_stages(
  p_app_user_id uuid,
  p_locale public.content_locale
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as materialized (
    select passport.value, passport.ordinality
    from public.get_owned_passport_collection(p_app_user_id, p_locale)
      with ordinality as passport(value, ordinality)
  )
  select jsonb_set(
    base.value,
    '{score}',
    (base.value -> 'score') || jsonb_build_object(
      'stageProgress', public.get_fan_stage_progress(
        (base.value -> 'score' ->> 'points')::integer,
        base.value -> 'score' ->> 'level'
      )
    )
  )
  from base
  order by base.ordinality;
$$;

create function public.get_owned_passport_detail_with_stages(
  p_passport_id uuid,
  p_app_user_id uuid,
  p_locale public.content_locale
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as materialized (
    select passport.value, passport.ordinality
    from public.get_owned_passport_detail(p_passport_id, p_app_user_id, p_locale)
      with ordinality as passport(value, ordinality)
  )
  select jsonb_set(
    base.value,
    '{score}',
    (base.value -> 'score') || jsonb_build_object(
      'stageProgress', public.get_fan_stage_progress(
        (base.value -> 'score' ->> 'points')::integer,
        base.value -> 'score' ->> 'level'
      )
    )
  )
  from base
  order by base.ordinality;
$$;

revoke all on function public.get_fan_stage_progress(integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_owned_my_fan_activity_with_stages(
  uuid, public.content_locale, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.get_owned_passport_collection_with_stages(
  uuid, public.content_locale
) from public, anon, authenticated, service_role;
revoke all on function public.get_owned_passport_detail_with_stages(
  uuid, uuid, public.content_locale
) from public, anon, authenticated, service_role;

grant execute on function public.get_fan_stage_progress(integer, text)
  to service_role;
grant execute on function public.get_owned_my_fan_activity_with_stages(
  uuid, public.content_locale, timestamptz
) to service_role;
grant execute on function public.get_owned_passport_collection_with_stages(
  uuid, public.content_locale
) to service_role;
grant execute on function public.get_owned_passport_detail_with_stages(
  uuid, uuid, public.content_locale
) to service_role;

comment on table public.reward_policy_tier_stages is
  'Immutable display-only Fan stages within a published major-tier reward policy.';
comment on function public.get_fan_stage_progress(integer, text) is
  'Returns display-stage progress while flooring at the permanently attained major Tier.';
comment on function public.get_owned_my_fan_activity_with_stages(
  uuid, public.content_locale, timestamptz
) is 'Adds display-stage progress to owned MY Passport summaries.';
comment on function public.get_owned_passport_collection_with_stages(
  uuid, public.content_locale
) is 'Adds display-stage progress to the owner-scoped Passport collection.';
comment on function public.get_owned_passport_detail_with_stages(
  uuid, uuid, public.content_locale
) is 'Adds display-stage progress to the current owner-scoped Passport detail projection.';
