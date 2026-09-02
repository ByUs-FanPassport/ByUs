-- Phase 01 reward foundation. Published policy rows are immutable; activation is
-- a separate audited pointer so rollback never rewrites policy history.

create table public.reward_policy_versions (
  version integer primary key check (version > 0),
  mission_score_min integer not null check (mission_score_min >= 0),
  mission_score_max integer not null check (mission_score_max >= mission_score_min),
  mission_score_default integer not null,
  mission_ticket_min integer not null check (mission_ticket_min >= 0),
  mission_ticket_max integer not null check (mission_ticket_max >= mission_ticket_min),
  mission_ticket_default integer not null,
  journey_ticket_min integer not null check (journey_ticket_min >= 0),
  journey_ticket_max integer not null check (journey_ticket_max >= journey_ticket_min),
  journey_ticket_default integer not null,
  published_at timestamptz not null,
  constraint reward_policy_mission_score_default_in_range check (
    mission_score_default between mission_score_min and mission_score_max
  ),
  constraint reward_policy_mission_ticket_default_in_range check (
    mission_ticket_default between mission_ticket_min and mission_ticket_max
  ),
  constraint reward_policy_journey_ticket_default_in_range check (
    journey_ticket_default between journey_ticket_min and journey_ticket_max
  )
);

create table public.reward_policy_tier_milestones (
  policy_version integer not null references public.reward_policy_versions(version) on delete restrict,
  tier_name text not null check (tier_name in ('Bronze','Silver','Gold','Platinum','Diamond')),
  minimum_score integer not null check (minimum_score >= 0),
  tier_rank smallint not null check (tier_rank between 1 and 5),
  primary key (policy_version, tier_name),
  unique (policy_version, minimum_score),
  unique (policy_version, tier_rank)
);

insert into public.reward_policy_versions values
  (1, 0, 2, 2, 0, 0, 0, 0, 0, 0, '2026-09-02 00:00:00+00'),
  (2, 0, 3, 1, 0, 2, 1, 0, 5, 3, '2026-09-02 00:00:00+00');

insert into public.reward_policy_tier_milestones(policy_version,tier_name,minimum_score,tier_rank) values
  (1, 'Bronze', 0, 1), (1, 'Silver', 5, 2), (1, 'Gold', 10, 3),
  (1, 'Platinum', 20, 4), (1, 'Diamond', 35, 5),
  (2, 'Bronze', 0, 1), (2, 'Silver', 15, 2), (2, 'Gold', 50, 3),
  (2, 'Platinum', 120, 4), (2, 'Diamond', 250, 5);

create table public.reward_policy_activation (
  singleton boolean primary key default true check (singleton),
  policy_version integer not null references public.reward_policy_versions(version) on delete restrict,
  effective_at timestamptz not null,
  activated_at timestamptz not null default now(),
  actor_app_user_id uuid references public.app_users(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 500)
);

create table public.reward_policy_activation_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  previous_policy_version integer not null references public.reward_policy_versions(version) on delete restrict,
  activated_policy_version integer not null references public.reward_policy_versions(version) on delete restrict,
  previous_effective_at timestamptz not null,
  effective_at timestamptz not null,
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now()
);

-- Migration bootstrap has no human actor. Every later activation requires a
-- real app user and is written to the immutable audit ledger.
insert into public.reward_policy_activation(
  singleton,policy_version,effective_at,actor_app_user_id,reason
) values (true, 1, '2026-09-02 00:00:00+00', null, 'Phase 1 bootstrap');

create function public.reject_reward_policy_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'reward policy versions are immutable';
end;
$$;

create trigger reward_policy_versions_immutable before update or delete on public.reward_policy_versions
for each row execute function public.reject_reward_policy_mutation();
create trigger reward_policy_versions_reject_truncate before truncate on public.reward_policy_versions
for each statement execute function public.reject_reward_policy_mutation();
create trigger reward_policy_tiers_immutable before update or delete on public.reward_policy_tier_milestones
for each row execute function public.reject_reward_policy_mutation();
create trigger reward_policy_tiers_reject_truncate before truncate on public.reward_policy_tier_milestones
for each statement execute function public.reject_reward_policy_mutation();
create trigger reward_policy_activation_audit_immutable before update or delete on public.reward_policy_activation_audit
for each row execute function public.reject_reward_policy_mutation();
create trigger reward_policy_activation_audit_reject_truncate before truncate on public.reward_policy_activation_audit
for each statement execute function public.reject_reward_policy_mutation();

create function public.activate_reward_policy(
  p_policy_version integer,
  p_effective_at timestamptz,
  p_actor_app_user_id uuid,
  p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_activation public.reward_policy_activation%rowtype;
begin
  if p_effective_at is null then raise exception 'effective time is required'; end if;
  -- The activation table is a current singleton pointer, not a scheduler. A
  -- future effective time would expose the new policy before it is effective.
  if p_effective_at > transaction_timestamp() then
    raise exception 'future reward policy activation is not supported';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception 'activation reason is required';
  end if;
  if not exists (
    select 1 from public.reward_policy_versions policy
    where policy.version = p_policy_version
      and policy.mission_score_min >= 0
      and policy.mission_score_max >= policy.mission_score_min
      and policy.mission_score_default between policy.mission_score_min and policy.mission_score_max
      and policy.mission_ticket_min >= 0
      and policy.mission_ticket_max >= policy.mission_ticket_min
      and policy.mission_ticket_default between policy.mission_ticket_min and policy.mission_ticket_max
      and policy.journey_ticket_min >= 0
      and policy.journey_ticket_max >= policy.journey_ticket_min
      and policy.journey_ticket_default between policy.journey_ticket_min and policy.journey_ticket_max
  ) then
    raise exception 'published reward policy % does not exist', p_policy_version;
  end if;
  if (select count(*) from public.reward_policy_tier_milestones
      where policy_version = p_policy_version) <> 5
    or exists (
      with expected(tier_name, tier_rank) as (values
        ('Bronze', 1), ('Silver', 2), ('Gold', 3), ('Platinum', 4), ('Diamond', 5)
      )
      select 1 from expected
      left join public.reward_policy_tier_milestones milestone
        on milestone.policy_version = p_policy_version
       and milestone.tier_name = expected.tier_name
       and milestone.tier_rank = expected.tier_rank
      where milestone.tier_name is null
    )
    or exists (
      select 1
      from (
        select tier_rank, minimum_score,
          lag(minimum_score) over (order by tier_rank) as previous_minimum_score
        from public.reward_policy_tier_milestones
        where policy_version = p_policy_version
      ) ordered_tiers
      where (tier_rank = 1 and minimum_score <> 0)
         or (tier_rank > 1 and minimum_score <= previous_minimum_score)
    ) then
    raise exception 'reward policy % Tier milestones are invalid', p_policy_version;
  end if;
  if not exists (select 1 from public.app_users where id=p_actor_app_user_id) then
    raise exception 'activation actor does not exist';
  end if;

  select * into strict current_activation
  from public.reward_policy_activation where singleton=true for update;

  insert into public.reward_policy_activation_audit(
    previous_policy_version,activated_policy_version,previous_effective_at,effective_at,
    actor_app_user_id,reason
  ) values (
    current_activation.policy_version,p_policy_version,current_activation.effective_at,p_effective_at,
    p_actor_app_user_id,btrim(p_reason)
  );

  update public.reward_policy_activation set
    policy_version=p_policy_version,effective_at=p_effective_at,activated_at=now(),
    actor_app_user_id=p_actor_app_user_id,reason=btrim(p_reason)
  where singleton=true;
end;
$$;

alter table public.reward_policy_versions enable row level security;
alter table public.reward_policy_versions force row level security;
alter table public.reward_policy_tier_milestones enable row level security;
alter table public.reward_policy_tier_milestones force row level security;
alter table public.reward_policy_activation enable row level security;
alter table public.reward_policy_activation force row level security;
alter table public.reward_policy_activation_audit enable row level security;
alter table public.reward_policy_activation_audit force row level security;

revoke all on table public.reward_policy_versions from public,anon,authenticated,service_role;
revoke all on table public.reward_policy_tier_milestones from public,anon,authenticated,service_role;
revoke all on table public.reward_policy_activation from public,anon,authenticated,service_role;
revoke all on table public.reward_policy_activation_audit from public,anon,authenticated,service_role;
grant select on table public.reward_policy_versions,public.reward_policy_tier_milestones,
  public.reward_policy_activation to authenticated,service_role;

revoke all on function public.activate_reward_policy(integer,timestamptz,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.activate_reward_policy(integer,timestamptz,uuid,text)
  to service_role;
