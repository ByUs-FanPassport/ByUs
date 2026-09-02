-- Final Phase 1 integrity gate and one-way reward-policy v2 activation.
-- Every prerequisite is checked in the same transaction before the audited
-- singleton pointer moves. Recovery is forward-only through a later policy.

-- Operator activations still require an actor. A migration activation has no
-- human principal, so its provenance is explicit instead of inventing a user.
alter table public.reward_policy_activation_audit
  add column activation_source text not null default 'operator'
  check (activation_source in ('operator', 'migration'));
alter table public.reward_policy_activation_audit
  alter column actor_app_user_id drop not null;
alter table public.reward_policy_activation_audit
  add constraint reward_policy_activation_audit_actor_required check (
    (activation_source = 'operator' and actor_app_user_id is not null)
    or (activation_source = 'migration' and actor_app_user_id is null)
  );

do $$
declare
  current_activation public.reward_policy_activation%rowtype;
  activation_time timestamptz := transaction_timestamp();
begin
  select * into strict current_activation
  from public.reward_policy_activation
  where singleton = true
  for update;

  if current_activation.policy_version <> 1 then
    raise exception 'reward policy activation expected v1, found v%', current_activation.policy_version;
  end if;

  if not exists (
    select 1 from public.reward_policy_versions where version = 2
  ) or (
    select count(*) from public.reward_policy_tier_milestones where policy_version = 2
  ) <> 5 then
    raise exception 'reward policy v2 document is incomplete';
  end if;

  if exists (
    with expected(tier_name, minimum_score, tier_rank) as (values
      ('Bronze', 0, 1), ('Silver', 15, 2), ('Gold', 50, 3),
      ('Platinum', 120, 4), ('Diamond', 250, 5)
    )
    select 1 from expected
    left join public.reward_policy_tier_milestones milestone
      on milestone.policy_version = 2
     and milestone.tier_name = expected.tier_name
     and milestone.minimum_score = expected.minimum_score
     and milestone.tier_rank = expected.tier_rank
    where milestone.tier_name is null
  ) then
    raise exception 'reward policy v2 Tier milestones are invalid';
  end if;

  if exists (
    with relationships as (
      select app_user_id, celebrity_id from public.fan_score_ledger
      union
      select app_user_id, celebrity_id from public.fan_level_events
    )
    select 1 from relationships relationship
    left join public.fan_tier_cutover_snapshots snapshot
      on snapshot.app_user_id = relationship.app_user_id
     and snapshot.celebrity_id = relationship.celebrity_id
    where snapshot.app_user_id is null
  ) then
    raise exception 'tier cutover snapshot backfill is incomplete';
  end if;

  if exists (
    with scores as (
      select snapshot.app_user_id, snapshot.celebrity_id,
        snapshot.attained_tier_rank,
        coalesce(sum(ledger.points), 0)::integer as current_score
      from public.fan_tier_cutover_snapshots snapshot
      left join public.fan_score_ledger ledger
        on ledger.app_user_id = snapshot.app_user_id
       and ledger.celebrity_id = snapshot.celebrity_id
      group by snapshot.app_user_id, snapshot.celebrity_id, snapshot.attained_tier_rank
    )
    select 1 from scores
    where public.fan_level_rank(public.get_fan_effective_tier_for_score(
      scores.app_user_id, scores.celebrity_id, scores.current_score, 2
    )) < scores.attained_tier_rank
  ) then
    raise exception 'tier downgrade detected';
  end if;

  if exists (
    select 1 from public.fan_ticket_ledger
    group by app_user_id, celebrity_id
    having sum(amount::numeric) < 0
  ) then
    raise exception 'negative Ticket balance detected';
  end if;

  if exists (
    select 1 from public.fan_ticket_ledger
    group by idempotency_key having count(*) > 1
  ) then
    raise exception 'duplicate Ticket idempotency key detected';
  end if;

  if exists (
    select 1 from public.fan_ticket_ledger
    group by app_user_id, celebrity_id, source_type, source_id having count(*) > 1
  ) then
    raise exception 'duplicate Ticket semantic source detected';
  end if;

  if exists (
    select 1 from public.live_surveys s
    where (s.publication_status = 'published' or exists (
      select 1 from public.live_survey_responses response where response.survey_id = s.id
    )) and not exists (
      select 1 from public.live_survey_reward_setting_bindings binding
      where binding.survey_id = s.id
    )
  ) then
    raise exception 'Survey reward binding backfill is incomplete';
  end if;

  if exists (
    select 1
    from public.live_survey_reward_setting_bindings binding
    join public.live_surveys s on s.id = binding.survey_id
    join public.live_reward_setting_revisions r on r.id = binding.reward_setting_revision_id
    where r.lifecycle_status <> 'published' or r.live_event_id <> s.live_event_id
  ) then
    raise exception 'Survey reward binding is invalid';
  end if;

  insert into public.reward_policy_activation_audit(
    previous_policy_version, activated_policy_version, previous_effective_at,
    effective_at, actor_app_user_id, reason, activation_source
  ) values (
    1, 2, current_activation.effective_at, activation_time, null,
    'Phase 1 integrity gate passed; activate reward policy v2', 'migration'
  );

  update public.reward_policy_activation
  set policy_version = 2,
      effective_at = activation_time,
      activated_at = activation_time,
      actor_app_user_id = null,
      reason = 'Phase 1 integrity gate passed; activate reward policy v2'
  where singleton = true and policy_version = 1;

  if not found then
    raise exception 'reward policy v2 activation lost singleton lock';
  end if;
end;
$$;

comment on column public.reward_policy_activation_audit.activation_source is
  'Distinguishes actor-backed operator activation from audited migration cutover.';
