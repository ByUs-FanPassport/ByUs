-- Phase 1 Tier v2 cutover. Tier is an attained entitlement: policy changes and
-- negative score adjustments may advance it, but never reduce it.

create table public.fan_tier_cutover_snapshots (
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  celebrity_id uuid not null references public.celebrities(id) on delete restrict,
  attained_tier text not null check (attained_tier in ('Bronze','Silver','Gold','Platinum','Diamond')),
  attained_tier_rank smallint not null check (attained_tier_rank between 1 and 5),
  score_at_cutover integer not null,
  cutover_at timestamptz not null,
  source_policy_version integer not null references public.reward_policy_versions(version) on delete restrict,
  primary key(app_user_id,celebrity_id)
);

alter table public.fan_level_events
  add column policy_version integer references public.reward_policy_versions(version) on delete restrict;
update public.fan_level_events set policy_version=1 where policy_version is null;
set constraints all immediate;
alter table public.fan_level_events alter column policy_version set not null;

alter table public.benefits
  add column reward_policy_version integer references public.reward_policy_versions(version) on delete restrict;
-- All criteria that existed before this deployment retain the thresholds under
-- which an operator authored them. This includes drafts, avoiding accidental
-- reinterpretation if they are published during a rolling deployment.
update public.benefits set reward_policy_version=1 where reward_policy_version is null;
set constraints all immediate;

create function public.default_benefit_reward_policy_version()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.reward_policy_version is null then
    select policy_version into new.reward_policy_version
    from public.reward_policy_activation where singleton=true;
  end if;
  return new;
end;
$$;
create trigger benefits_default_reward_policy before insert on public.benefits
for each row execute function public.default_benefit_reward_policy_version();
alter table public.benefits alter column reward_policy_version set not null;

create or replace function public.fan_level_rank(p_level text)
returns integer language sql immutable parallel safe set search_path='' as $$
  select case p_level when 'Bronze' then 1 when 'Silver' then 2 when 'Gold' then 3
    when 'Platinum' then 4 when 'Diamond' then 5 else 0 end;
$$;

create function public.fan_level_for_score(p_score integer,p_policy_version integer)
returns text language sql stable parallel safe set search_path='' as $$
  select milestone.tier_name
  from public.reward_policy_tier_milestones milestone
  where milestone.policy_version=p_policy_version and milestone.minimum_score<=greatest(p_score,0)
  order by milestone.tier_rank desc limit 1;
$$;

create or replace function public.fan_level_for_score(p_score integer)
returns text language sql stable parallel safe set search_path='' as $$
  select public.fan_level_for_score(p_score,activation.policy_version)
  from public.reward_policy_activation activation where singleton=true;
$$;

-- One transaction-wide timestamp makes snapshot population deterministic.
do $$
declare v_cutover_at timestamptz:=transaction_timestamp();
begin
  insert into public.fan_tier_cutover_snapshots(
    app_user_id,celebrity_id,attained_tier,attained_tier_rank,score_at_cutover,cutover_at,source_policy_version
  )
  with relationships as (
    select app_user_id,celebrity_id from public.fan_score_ledger
    union
    select app_user_id,celebrity_id from public.fan_level_events
  ), scores as (
    select relationship.app_user_id,relationship.celebrity_id,
      coalesce(sum(ledger.points),0)::integer score
    from relationships relationship
    left join public.fan_score_ledger ledger on ledger.app_user_id=relationship.app_user_id
      and ledger.celebrity_id=relationship.celebrity_id
    group by relationship.app_user_id,relationship.celebrity_id
  ), attained as (
    select scores.*,
      greatest(
        public.fan_level_rank(public.fan_level_for_score(scores.score,1)),
        coalesce((select max(public.fan_level_rank(event.current_level)) from public.fan_level_events event
          where event.app_user_id=scores.app_user_id and event.celebrity_id=scores.celebrity_id),1)
      ) attained_rank
    from scores
  )
  select attained.app_user_id,attained.celebrity_id,milestone.tier_name,milestone.tier_rank,
    attained.score,v_cutover_at,1
  from attained join public.reward_policy_tier_milestones milestone
    on milestone.policy_version=1 and milestone.tier_rank=attained.attained_rank;
end $$;

create function public.get_fan_effective_tier_for_score(
  p_app_user_id uuid,p_celebrity_id uuid,p_score integer,p_policy_version integer
) returns text language sql stable parallel safe set search_path='' as $$
  with candidates as (
    select public.fan_level_rank(public.fan_level_for_score(p_score,p_policy_version)) tier_rank
    union all
    select snapshot.attained_tier_rank from public.fan_tier_cutover_snapshots snapshot
      where snapshot.app_user_id=p_app_user_id and snapshot.celebrity_id=p_celebrity_id
    union all
    select max(public.fan_level_rank(event.current_level)) from public.fan_level_events event
      where event.app_user_id=p_app_user_id and event.celebrity_id=p_celebrity_id
  ), attained as (select greatest(coalesce(max(tier_rank),1),1) tier_rank from candidates)
  select milestone.tier_name from attained
  join public.reward_policy_tier_milestones milestone
    on milestone.policy_version=p_policy_version and milestone.tier_rank=attained.tier_rank;
$$;

create function public.get_fan_effective_tier(p_app_user_id uuid,p_celebrity_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select public.get_fan_effective_tier_for_score(
    p_app_user_id,p_celebrity_id,
    coalesce((select sum(ledger.points)::integer from public.fan_score_ledger ledger
      where ledger.app_user_id=p_app_user_id and ledger.celebrity_id=p_celebrity_id),0),
    activation.policy_version)
  from public.reward_policy_activation activation where singleton=true;
$$;

-- Return score and effective Tier from one statement snapshot. Separate client
-- reads can otherwise disagree when a score write commits between requests.
create function public.get_fan_score_and_effective_tier(
  p_app_user_id uuid,p_celebrity_id uuid
) returns jsonb language sql stable security definer set search_path='' as $$
  with active_policy as materialized (
    select policy_version from public.reward_policy_activation where singleton=true
  ), score as materialized (
    select coalesce(sum(ledger.points),0)::integer value
    from public.fan_score_ledger ledger
    where ledger.app_user_id=p_app_user_id and ledger.celebrity_id=p_celebrity_id
  )
  select jsonb_build_object(
    'score',score.value,
    'effectiveTier',public.get_fan_effective_tier_for_score(
      p_app_user_id,p_celebrity_id,score.value,active_policy.policy_version
    )
  ) from score cross join active_policy;
$$;

-- Central projector used by Score writes. Ordered milestones plus existing
-- unique(app_user_id,celebrity_id,current_level) make multi-boundary jumps once-only.
create or replace function public.project_score_unlock_events()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_previous_score integer; v_current_score integer; v_previous_level text; v_current_level text;
  v_level_event_id uuid; v_notification_id uuid; v_level record; v_policy integer;
begin
  select policy_version into v_policy from public.reward_policy_activation where singleton=true;
  select coalesce(sum(points),0)::integer into v_current_score from public.fan_score_ledger
    where app_user_id=new.app_user_id and celebrity_id=new.celebrity_id;
  v_previous_score:=v_current_score-new.points;
  v_previous_level:=public.get_fan_effective_tier_for_score(new.app_user_id,new.celebrity_id,v_previous_score,v_policy);
  v_current_level:=public.get_fan_effective_tier_for_score(new.app_user_id,new.celebrity_id,v_current_score,v_policy);
  if public.fan_level_rank(v_current_level)<=public.fan_level_rank(v_previous_level) then
    perform public.project_benefit_unlock_events(new.id); return new;
  end if;
  for v_level in select tier_name name,tier_rank from public.reward_policy_tier_milestones
    where policy_version=v_policy and tier_rank>public.fan_level_rank(v_previous_level)
      and tier_rank<=public.fan_level_rank(v_current_level) order by tier_rank
  loop
    v_level_event_id:=extensions.gen_random_uuid();
    insert into public.fan_level_events(id,source_ledger_id,app_user_id,celebrity_id,previous_score,current_score,previous_level,current_level,occurred_at,policy_version)
    values(v_level_event_id,new.id,new.app_user_id,new.celebrity_id,v_previous_score,v_current_score,v_previous_level,v_level.name,new.created_at,v_policy)
    on conflict(app_user_id,celebrity_id,current_level) do nothing returning id into v_level_event_id;
    if v_level_event_id is not null then
      v_notification_id:=extensions.gen_random_uuid();
      insert into public.fan_notifications(id,app_user_id,kind,source_key,scheduled_for,celebrity_id,source_event_id,target_type,target_id,deep_link,payload,created_at)
      values(v_notification_id,new.app_user_id,'level_up','level:'||new.celebrity_id::text||':'||lower(v_level.name),new.created_at,new.celebrity_id,v_level_event_id,'celebrity',new.celebrity_id,'/passports',
        jsonb_build_object('schemaVersion',2,'policyVersion',v_policy,'celebrityId',new.celebrity_id,'previousScore',v_previous_score,'currentScore',v_current_score,'previousLevel',v_previous_level,'currentLevel',v_level.name),new.created_at)
      on conflict(app_user_id,source_key) do nothing returning id into v_notification_id;
      if v_notification_id is not null then
        insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at)
        select v_notification_id,subscription.id,new.created_at from public.push_subscriptions subscription
        where subscription.app_user_id=new.app_user_id and subscription.disabled_at is null
        on conflict(notification_id,subscription_id) do nothing;
      end if;
    end if;
  end loop;
  perform public.project_benefit_unlock_events(new.id); return new;
end;
$$;

alter table public.fan_tier_cutover_snapshots enable row level security;
alter table public.fan_tier_cutover_snapshots force row level security;
revoke all on table public.fan_tier_cutover_snapshots from public,anon,authenticated,service_role;
grant select on table public.fan_tier_cutover_snapshots to service_role;
revoke all on function public.fan_level_for_score(integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_fan_effective_tier_for_score(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_fan_effective_tier(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_fan_effective_tier(uuid,uuid) to service_role;
revoke all on function public.get_fan_score_and_effective_tier(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_fan_score_and_effective_tier(uuid,uuid) to service_role;

-- Callable Tier consumers inventoried at cutover. Definitions after this migration
-- must delegate to fan_level_for_score/get_fan_effective_tier rather than own thresholds:
-- get_owned_passport_collection, get_owned_passport_detail, build_fan_activity_completion,
-- build_owned_live_reservation_result, build_owned_live_attendance_result,
-- build_owned_live_survey_submission_result, get_admin_fans, read_admin_creator_analytics,
-- claim_benefit, assert_benefit_application_eligibility, project_score_unlock_events,
-- project_benefit_unlock_events.


create or replace function public.claim_benefit(
  p_benefit_id uuid, p_app_user_id uuid, p_idempotency_key uuid,
  p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_benefit public.benefits%rowtype;
  v_passport public.fan_passports%rowtype;
  v_existing public.benefit_claims%rowtype;
  v_claim_id uuid := extensions.gen_random_uuid();
  v_code public.benefit_unique_codes%rowtype;
  v_delivery_value text;
  v_score integer;
  v_level text;
  v_level_rank integer;
  v_required_rank integer;
  v_owner_count integer;
  v_total_count integer;
begin
  if p_benefit_id is null or p_app_user_id is null or p_idempotency_key is null then
    raise exception 'benefit, owner, and idempotency key are required';
  end if;

  select * into v_existing from public.benefit_claims
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.benefit_id <> p_benefit_id or v_existing.app_user_id <> p_app_user_id then
      raise exception 'idempotency key belongs to a different claim';
    end if;
    if v_existing.delivery_type = 'unique_code' then
      select code_value into v_delivery_value from public.benefit_unique_codes
      where id = v_existing.unique_code_id and claimed_by_claim_id = v_existing.id;
    else
      select secret_value into v_delivery_value from public.benefit_delivery_vault
      where benefit_id = v_existing.benefit_id and delivery_type = v_existing.delivery_type;
    end if;
    return jsonb_build_object('claimId', v_existing.id, 'benefitId', v_existing.benefit_id,
      'deliveryType', v_existing.delivery_type, 'deliveryValue', v_delivery_value,
      'claimedAt', v_existing.claimed_at, 'replayed', true);
  end if;

  select * into v_benefit from public.benefits where id = p_benefit_id for update;
  if not found or v_benefit.publication_status <> 'published' then
    raise exception 'benefit is not available';
  end if;
  if p_now < v_benefit.claim_opens_at or p_now >= v_benefit.claim_closes_at then
    raise exception 'benefit claim window is closed';
  end if;

  select * into v_passport from public.fan_passports
  where app_user_id = p_app_user_id and celebrity_id = v_benefit.celebrity_id;
  if not found then raise exception 'eligible fan passport is required'; end if;

  select coalesce(sum(points), 0)::integer into v_score from public.fan_score_ledger
  where app_user_id = p_app_user_id and celebrity_id = v_benefit.celebrity_id;
  v_level := public.get_fan_effective_tier_for_score(p_app_user_id,v_benefit.celebrity_id,v_score,v_benefit.reward_policy_version);
  v_level_rank := public.fan_level_rank(v_level);
  v_required_rank := public.fan_level_rank(v_benefit.minimum_level);
  if v_score < v_benefit.minimum_score or v_level_rank < v_required_rank then
    raise exception 'benefit score or level requirement is not met';
  end if;
  if v_benefit.required_stamp_type is not null and not exists (
    select 1 from public.stamps where passport_id = v_passport.id
      and app_user_id = p_app_user_id and celebrity_id = v_benefit.celebrity_id
      and stamp_type = v_benefit.required_stamp_type
  ) then raise exception 'required stamp is missing'; end if;
  if v_benefit.required_activity_type is not null and not exists (
    select 1 from public.fan_activities where app_user_id = p_app_user_id
      and celebrity_id = v_benefit.celebrity_id
      and activity_type = v_benefit.required_activity_type
  ) then raise exception 'required activity is missing'; end if;

  select count(*)::integer into v_owner_count from public.benefit_claims
  where benefit_id = p_benefit_id and app_user_id = p_app_user_id;
  if v_owner_count >= v_benefit.per_user_limit then raise exception 'per-user claim limit reached'; end if;
  select count(*)::integer into v_total_count from public.benefit_claims where benefit_id = p_benefit_id;
  if v_benefit.stock_limit is not null and v_total_count >= v_benefit.stock_limit then
    raise exception 'benefit stock is exhausted';
  end if;

  if v_benefit.delivery_type = 'unique_code' then
    select * into v_code from public.benefit_unique_codes
    where benefit_id = p_benefit_id and claimed_by_claim_id is null
    order by created_at, id for update skip locked limit 1;
    if not found then raise exception 'benefit code inventory is exhausted'; end if;
    v_delivery_value := v_code.code_value;
  else
    select secret_value into v_delivery_value from public.benefit_delivery_vault
    where benefit_id = p_benefit_id and delivery_type = v_benefit.delivery_type;
    if not found then raise exception 'benefit delivery is not configured'; end if;
  end if;

  insert into public.benefit_claims (
    id, benefit_id, app_user_id, celebrity_id, passport_id,
    idempotency_key, delivery_type, unique_code_id, claimed_at
  ) values (
    v_claim_id, p_benefit_id, p_app_user_id, v_benefit.celebrity_id, v_passport.id,
    p_idempotency_key, v_benefit.delivery_type,
    case when v_benefit.delivery_type = 'unique_code' then v_code.id end, p_now
  );
  if v_benefit.delivery_type = 'unique_code' then
    update public.benefit_unique_codes set claimed_by_claim_id = v_claim_id
    where id = v_code.id and claimed_by_claim_id is null;
    if not found then raise exception 'unique code allocation conflict'; end if;
  end if;
  insert into public.benefit_claim_audits (
    benefit_claim_id, benefit_id, app_user_id, event_type, eligibility_snapshot
  ) values (v_claim_id, p_benefit_id, p_app_user_id, 'claimed', jsonb_build_object(
    'passportId', v_passport.id, 'score', v_score, 'level', v_level,
    'requiredStampType', v_benefit.required_stamp_type,
    'requiredActivityType', v_benefit.required_activity_type
  ));
  return jsonb_build_object('claimId', v_claim_id, 'benefitId', p_benefit_id,
    'deliveryType', v_benefit.delivery_type, 'deliveryValue', v_delivery_value,
    'claimedAt', p_now, 'replayed', false);
end;
$$;


create or replace function public.assert_benefit_application_eligibility(p_benefit_id uuid,p_app_user_id uuid)
returns public.fan_passports language plpgsql security definer set search_path='' as $$
declare b public.benefits%rowtype; p public.fan_passports%rowtype; v_score integer; v_rank integer; v_required integer;
begin
 select * into b from public.benefits where id=p_benefit_id;
 select * into p from public.fan_passports where app_user_id=p_app_user_id and celebrity_id=b.celebrity_id and business_status='issued';
 if not found then raise exception 'eligible fan passport required'; end if;
 select coalesce(sum(points),0)::integer into v_score from public.fan_score_ledger where app_user_id=p_app_user_id and celebrity_id=b.celebrity_id;
 v_rank:=public.fan_level_rank(public.get_fan_effective_tier_for_score(p_app_user_id,b.celebrity_id,v_score,b.reward_policy_version));
 v_required:=public.fan_level_rank(b.minimum_level);
 if v_score<b.minimum_score or v_rank<v_required then raise exception 'benefit score or level requirement is not met'; end if;
 if b.required_stamp_type is not null and not exists(select 1 from public.stamps where passport_id=p.id and app_user_id=p_app_user_id and celebrity_id=b.celebrity_id and stamp_type=b.required_stamp_type) then raise exception 'required stamp is missing'; end if;
 if b.required_activity_type is not null and not exists(select 1 from public.fan_activities where app_user_id=p_app_user_id and celebrity_id=b.celebrity_id and activity_type=b.required_activity_type) then raise exception 'required activity is missing'; end if;
 return p;
end $$;


create or replace function public.project_benefit_unlock_events(p_source_ledger_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  source_ledger public.fan_score_ledger%rowtype;
  previous_score integer;
  current_score integer;
  previous_level text;
  current_level text;
  benefit_record record;
  change_id uuid;
  created_notification_id uuid;
begin
  select * into source_ledger from public.fan_score_ledger where id=p_source_ledger_id;
  if not found then raise exception 'score ledger source is required'; end if;
  select coalesce(sum(points),0)::integer into current_score from public.fan_score_ledger
    where app_user_id=source_ledger.app_user_id and celebrity_id=source_ledger.celebrity_id;
  previous_score:=current_score-source_ledger.points;
  previous_level:=public.get_fan_effective_tier_for_score(source_ledger.app_user_id,source_ledger.celebrity_id,previous_score,1);
  current_level:=public.get_fan_effective_tier_for_score(source_ledger.app_user_id,source_ledger.celebrity_id,current_score,1);

  for benefit_record in
    select benefit.id,benefit.slug,benefit.revision,benefit.reward_policy_version from public.benefits benefit
    where benefit.celebrity_id=source_ledger.celebrity_id and benefit.publication_status='published' and benefit.archived_at is null
      and source_ledger.created_at>=benefit.claim_opens_at and source_ledger.created_at<benefit.claim_closes_at
      and (benefit.stock_limit is null or (select count(*) from public.benefit_claims claim where claim.benefit_id=benefit.id)<benefit.stock_limit)
      and (benefit.delivery_type<>'unique_code' or exists(select 1 from public.benefit_unique_codes code where code.benefit_id=benefit.id and code.claimed_by_claim_id is null))
      and not exists(select 1 from public.benefit_claims claim where claim.benefit_id=benefit.id and claim.app_user_id=source_ledger.app_user_id)
      and current_score>=benefit.minimum_score and public.fan_level_rank(public.get_fan_effective_tier_for_score(source_ledger.app_user_id,source_ledger.celebrity_id,current_score,benefit.reward_policy_version))>=public.fan_level_rank(benefit.minimum_level)
      and (benefit.required_stamp_type is null or exists(select 1 from public.stamps stamp where stamp.app_user_id=source_ledger.app_user_id and stamp.celebrity_id=source_ledger.celebrity_id and stamp.stamp_type=benefit.required_stamp_type))
      and (benefit.required_activity_type is null or exists(select 1 from public.fan_activities activity where activity.app_user_id=source_ledger.app_user_id and activity.celebrity_id=source_ledger.celebrity_id and activity.activity_type=benefit.required_activity_type))
      and not (
        previous_score>=benefit.minimum_score and public.fan_level_rank(public.get_fan_effective_tier_for_score(source_ledger.app_user_id,source_ledger.celebrity_id,previous_score,benefit.reward_policy_version))>=public.fan_level_rank(benefit.minimum_level)
        and (benefit.required_stamp_type is null or exists(select 1 from public.stamps prior_stamp where prior_stamp.app_user_id=source_ledger.app_user_id and prior_stamp.celebrity_id=source_ledger.celebrity_id and prior_stamp.stamp_type=benefit.required_stamp_type and prior_stamp.activity_id is distinct from source_ledger.activity_id))
        and (benefit.required_activity_type is null or exists(select 1 from public.fan_activities prior_activity where prior_activity.app_user_id=source_ledger.app_user_id and prior_activity.celebrity_id=source_ledger.celebrity_id and prior_activity.activity_type=benefit.required_activity_type and prior_activity.id is distinct from source_ledger.activity_id))
      ) order by benefit.id
  loop
    change_id:=extensions.gen_random_uuid();
    insert into public.benefit_eligibility_changes(id,source_ledger_id,app_user_id,celebrity_id,benefit_id,benefit_policy_version,previous_state,current_state,previous_score,current_score,occurred_at)
    values(change_id,source_ledger.id,source_ledger.app_user_id,source_ledger.celebrity_id,benefit_record.id,benefit_record.revision,'locked','eligible',previous_score,current_score,source_ledger.created_at)
    on conflict(app_user_id,benefit_id,benefit_policy_version) do nothing returning id into change_id;
    if change_id is null then continue; end if;
    created_notification_id:=extensions.gen_random_uuid();
    insert into public.fan_notifications(id,app_user_id,kind,source_key,benefit_id,scheduled_for,celebrity_id,source_event_id,target_type,target_id,deep_link,payload,created_at)
    values(created_notification_id,source_ledger.app_user_id,'benefit_unlocked','benefit:'||benefit_record.id::text||':policy:'||benefit_record.revision::text,benefit_record.id,source_ledger.created_at,source_ledger.celebrity_id,change_id,'benefit',benefit_record.id,'/benefits/'||benefit_record.id::text,
      jsonb_build_object('schemaVersion',2,'policyVersion',benefit_record.reward_policy_version,'celebrityId',source_ledger.celebrity_id,'benefitId',benefit_record.id,'benefitSlug',benefit_record.slug,'benefitPolicyVersion',benefit_record.revision,'previousScore',previous_score,'currentScore',current_score),source_ledger.created_at)
    on conflict(app_user_id,source_key) do nothing returning id into created_notification_id;
    if created_notification_id is not null then
      insert into public.notification_delivery_outbox(notification_id,subscription_id,available_at)
      select created_notification_id,subscription.id,source_ledger.created_at from public.push_subscriptions subscription
      where subscription.app_user_id=source_ledger.app_user_id and subscription.disabled_at is null
        and coalesce((select preference.benefit_notifications from public.notification_preferences preference where preference.app_user_id=source_ledger.app_user_id),true)
      on conflict(notification_id,subscription_id) do nothing;
    end if;
  end loop;
end;
$$;


create or replace function public.get_owned_passport_collection(
  p_app_user_id uuid,
  p_locale public.content_locale
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', passport.id,
    'owner', jsonb_build_object('nickname', null),
    'celebrity', jsonb_build_object(
      'slug', celebrity.slug,
      'name', localization.name,
      'image', jsonb_build_object(
        'url', celebrity.image_url,
        'alt', localization.image_alt,
        'position', celebrity.image_position
      )
    ),
    'businessStatus', passport.business_status,
    'mint', jsonb_build_object(
      'status', passport.mint_status,
      'txHash', passport.tx_hash,
      'tokenId', passport.token_id::text
    ),
    'issuedAt', passport.issued_at,
    'score', jsonb_build_object(
      'points', score.total_points,
      'level', public.get_fan_effective_tier_for_score(passport.app_user_id,passport.celebrity_id,score.total_points,(select policy_version from public.reward_policy_activation where singleton=true))
    ),
    'stampSummary', jsonb_build_object(
      'knowledge', stamp_counts.knowledge_count,
      'reservation', stamp_counts.reservation_count,
      'attendance', stamp_counts.attendance_count,
      'survey', stamp_counts.survey_count,
      'total', stamp_counts.total_count
    )
  )
  from public.fan_passports passport
  join public.celebrities celebrity on celebrity.id = passport.celebrity_id
  join public.celebrity_localizations localization
    on localization.celebrity_id = celebrity.id
   and localization.locale = p_locale
  cross join lateral (
    select coalesce(sum(ledger.points), 0)::integer as total_points
    from public.fan_score_ledger ledger
    where ledger.app_user_id = passport.app_user_id
      and ledger.celebrity_id = passport.celebrity_id
  ) score
  cross join lateral (
    select
      count(*) filter (where stamp.stamp_type = 'knowledge')::integer as knowledge_count,
      count(*) filter (where stamp.stamp_type = 'reservation')::integer as reservation_count,
      count(*) filter (where stamp.stamp_type = 'attendance')::integer as attendance_count,
      count(*) filter (where stamp.stamp_type = 'survey')::integer as survey_count,
      count(*)::integer as total_count
    from public.stamps stamp
    where stamp.passport_id = passport.id
      and stamp.app_user_id = passport.app_user_id
      and stamp.celebrity_id = passport.celebrity_id
  ) stamp_counts
  where passport.app_user_id = p_app_user_id
  order by passport.issued_at desc, passport.id desc;
$$;


create or replace function public.get_owned_passport_detail(
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
  with activity_context as materialized (
    select
      activity.id as activity_id,
      jsonb_build_object(
        'sourceType', activity.source_type,
        'sourceId', activity.source_id,
        'live', case
          when activity.source_type = 'quiz_pass' then null
          when live.id is null or live_l10n.live_event_id is null then null
          else jsonb_build_object(
            'slug', live.slug,
            'title', live_l10n.title,
            'linkable', live.publication_status = 'published' and live.archived_at is null
          )
        end
      ) as value
    from public.fan_activities activity
    left join public.live_reservations reservation
      on activity.source_type = 'live_reservation'
     and reservation.id = activity.source_id
     and reservation.app_user_id = activity.app_user_id
    left join public.live_attendances attendance
      on activity.source_type = 'live_attendance'
     and attendance.id = activity.source_id
     and attendance.app_user_id = activity.app_user_id
    left join public.live_survey_responses response
      on activity.source_type = 'live_survey_response'
     and response.id = activity.source_id
     and response.app_user_id = activity.app_user_id
    left join public.live_events live
      on live.id = coalesce(
        reservation.live_event_id,
        attendance.live_event_id,
        response.live_event_id
      )
    left join public.live_event_localizations live_l10n
      on live_l10n.live_event_id = live.id
     and live_l10n.locale = p_locale
    where activity.app_user_id = p_app_user_id
  )
  select jsonb_build_object(
    'id', passport.id,
    'owner', jsonb_build_object('nickname', profile.nickname),
    'celebrity', jsonb_build_object(
      'slug', celebrity.slug,
      'name', localization.name,
      'image', jsonb_build_object(
        'url', celebrity.image_url,
        'alt', localization.image_alt,
        'position', celebrity.image_position
      )
    ),
    'businessStatus', passport.business_status,
    'mint', jsonb_build_object(
      'status', passport.mint_status,
      'txHash', passport.tx_hash,
      'tokenId', passport.token_id::text
    ),
    'issuedAt', passport.issued_at,
    'score', jsonb_build_object(
      'points', score.total_points,
      'level', public.get_fan_effective_tier_for_score(passport.app_user_id,passport.celebrity_id,score.total_points,(select policy_version from public.reward_policy_activation where singleton=true))
    ),
    'stampSummary', jsonb_build_object(
      'knowledge', stamp_counts.knowledge_count,
      'reservation', stamp_counts.reservation_count,
      'attendance', stamp_counts.attendance_count,
      'survey', stamp_counts.survey_count,
      'total', stamp_counts.total_count
    ),
    'stamps', stamps.items,
    'activities', activities.items,
    'nextBenefit', next_benefit.value
  )
  from public.fan_passports passport
  left join public.user_profiles profile
    on profile.app_user_id = passport.app_user_id
  join public.celebrities celebrity on celebrity.id = passport.celebrity_id
  join public.celebrity_localizations localization
    on localization.celebrity_id = celebrity.id
   and localization.locale = p_locale
  cross join lateral (
    select coalesce(sum(ledger.points), 0)::integer as total_points
    from public.fan_score_ledger ledger
    where ledger.app_user_id = passport.app_user_id
      and ledger.celebrity_id = passport.celebrity_id
  ) score
  cross join lateral (
    select
      count(*) filter (where stamp.stamp_type = 'knowledge')::integer as knowledge_count,
      count(*) filter (where stamp.stamp_type = 'reservation')::integer as reservation_count,
      count(*) filter (where stamp.stamp_type = 'attendance')::integer as attendance_count,
      count(*) filter (where stamp.stamp_type = 'survey')::integer as survey_count,
      count(*)::integer as total_count
    from public.stamps stamp
    where stamp.passport_id = passport.id
      and stamp.app_user_id = passport.app_user_id
      and stamp.celebrity_id = passport.celebrity_id
  ) stamp_counts
  cross join lateral (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', stamp.id,
        'type', stamp.stamp_type,
        'businessStatus', stamp.business_status,
        'mint', jsonb_build_object(
          'status', stamp.mint_status,
          'txHash', stamp.tx_hash,
          'tokenId', stamp.token_id::text
        ),
        'issuedAt', stamp.issued_at,
        'activityId', stamp.activity_id,
        'context', projected_context.value
      ) order by stamp.issued_at desc, stamp.id desc
    ), '[]'::jsonb) as items
    from public.stamps stamp
    join public.fan_activities activity
      on activity.id = stamp.activity_id
     and activity.app_user_id = stamp.app_user_id
     and activity.celebrity_id = stamp.celebrity_id
    join activity_context projected_context
      on projected_context.activity_id = activity.id
    where stamp.passport_id = passport.id
      and stamp.app_user_id = passport.app_user_id
      and stamp.celebrity_id = passport.celebrity_id
  ) stamps
  cross join lateral (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', activity.id,
        'type', activity.activity_type,
        'occurredAt', activity.occurred_at,
        'points', coalesce(ledger.points, 0),
        'stampId', stamp.id,
        'context', projected_context.value
      ) order by activity.occurred_at desc, activity.id desc
    ), '[]'::jsonb) as items
    from public.fan_activities activity
    left join public.fan_score_ledger ledger
      on ledger.activity_id = activity.id
     and ledger.app_user_id = activity.app_user_id
     and ledger.celebrity_id = activity.celebrity_id
    left join public.stamps stamp
      on stamp.activity_id = activity.id
     and stamp.passport_id = passport.id
     and stamp.app_user_id = activity.app_user_id
     and stamp.celebrity_id = activity.celebrity_id
    join activity_context projected_context
      on projected_context.activity_id = activity.id
    where activity.app_user_id = passport.app_user_id
      and activity.celebrity_id = passport.celebrity_id
  ) activities
  left join lateral (
    select jsonb_build_object(
      'id', candidate.id,
      'slug', candidate.slug,
      'title', candidate.title,
      'state', case when candidate.eligible then 'eligible' else 'locked' end,
      'allocationMode', candidate.allocation_mode,
      'applicationStatus', candidate.application_status,
      'eligibilityLabel', candidate.eligibility_label,
      'minimumScore', candidate.minimum_score,
      'minimumLevel', candidate.minimum_level,
      'requiredStampType', candidate.required_stamp_type,
      'requiredActivityType', candidate.required_activity_type,
      'missingConditions', candidate.missing_conditions
    ) as value
    from (
      select
        benefit.id,
        benefit.slug,
        benefit.allocation_mode,
        benefit.claim_opens_at,
        benefit.minimum_score,
        benefit.minimum_level,
        benefit.required_stamp_type,
        benefit.required_activity_type,
        benefit_l10n.title,
        benefit_l10n.eligibility_label,
        application.status as application_status,
        (
          statement_timestamp() >= benefit.claim_opens_at
          and score.total_points >= benefit.minimum_score
          and public.fan_level_rank(public.get_fan_effective_tier_for_score(passport.app_user_id,passport.celebrity_id,score.total_points,benefit.reward_policy_version)) >= public.fan_level_rank(benefit.minimum_level)
          and (
            benefit.required_stamp_type is null
            or exists (
              select 1 from public.stamps owned_stamp
              where owned_stamp.app_user_id = passport.app_user_id
                and owned_stamp.celebrity_id = passport.celebrity_id
                and owned_stamp.stamp_type = benefit.required_stamp_type
            )
          )
          and (
            benefit.required_activity_type is null
            or exists (
              select 1 from public.fan_activities owned_activity
              where owned_activity.app_user_id = passport.app_user_id
                and owned_activity.celebrity_id = passport.celebrity_id
                and owned_activity.activity_type = benefit.required_activity_type
            )
          )
        ) as eligible,
        (
          case when score.total_points < benefit.minimum_score
            then jsonb_build_array(jsonb_build_object(
              'type', 'score',
              'current', score.total_points,
              'required', benefit.minimum_score
            ))
            else '[]'::jsonb
          end
          ||
          case when public.fan_level_rank(public.get_fan_effective_tier_for_score(passport.app_user_id,passport.celebrity_id,score.total_points,benefit.reward_policy_version)) < public.fan_level_rank(benefit.minimum_level)
            then jsonb_build_array(jsonb_build_object(
              'type', 'level',
              'current', public.get_fan_effective_tier_for_score(passport.app_user_id,passport.celebrity_id,score.total_points,benefit.reward_policy_version),
              'required', benefit.minimum_level
            ))
            else '[]'::jsonb
          end
          ||
          case when benefit.required_stamp_type is not null and not exists (
              select 1 from public.stamps owned_stamp
              where owned_stamp.app_user_id = passport.app_user_id
                and owned_stamp.celebrity_id = passport.celebrity_id
                and owned_stamp.stamp_type = benefit.required_stamp_type
            )
            then jsonb_build_array(jsonb_build_object(
              'type', 'stamp',
              'required', benefit.required_stamp_type
            ))
            else '[]'::jsonb
          end
          ||
          case when benefit.required_activity_type is not null and not exists (
              select 1 from public.fan_activities owned_activity
              where owned_activity.app_user_id = passport.app_user_id
                and owned_activity.celebrity_id = passport.celebrity_id
                and owned_activity.activity_type = benefit.required_activity_type
            )
            then jsonb_build_array(jsonb_build_object(
              'type', 'activity',
              'required', benefit.required_activity_type
            ))
            else '[]'::jsonb
          end
          ||
          case when statement_timestamp() < benefit.claim_opens_at
            then jsonb_build_array(jsonb_build_object(
              'type', 'opens_at',
              'at', benefit.claim_opens_at
            ))
            else '[]'::jsonb
          end
        ) as missing_conditions
      from public.benefits benefit
      join public.benefit_localizations benefit_l10n
        on benefit_l10n.benefit_id = benefit.id
       and benefit_l10n.locale = p_locale
      left join public.benefit_applications application
        on application.benefit_id = benefit.id
       and application.app_user_id = passport.app_user_id
       and application.status <> 'cancelled'
      where benefit.celebrity_id = passport.celebrity_id
        and benefit.publication_status = 'published'
        and benefit.archived_at is null
        and statement_timestamp() < benefit.claim_closes_at
        and not exists (
          select 1 from public.benefit_claims owned_claim
          where owned_claim.benefit_id = benefit.id
            and owned_claim.app_user_id = passport.app_user_id
        )
        and (
          benefit.stock_limit is null
          or (
            select count(*) from public.benefit_claims claim_count
            where claim_count.benefit_id = benefit.id
          ) < benefit.stock_limit
        )
        and (
          benefit.delivery_type <> 'unique_code'
          or exists (
            select 1 from public.benefit_unique_codes code
            where code.benefit_id = benefit.id
              and code.claimed_by_claim_id is null
          )
        )
    ) candidate
    order by
      candidate.eligible desc,
      jsonb_array_length(candidate.missing_conditions),
      candidate.minimum_score,
      candidate.claim_opens_at,
      candidate.id
    limit 1
  ) next_benefit on true
  where passport.id = p_passport_id
    and passport.app_user_id = p_app_user_id;
$$;


create or replace function public.build_fan_activity_completion(
  p_app_user_id uuid,
  p_activity_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with completion as (
    select
      activity.app_user_id, activity.celebrity_id,
      stamp.passport_id,
      stamp.id as stamp_id,
      stamp.stamp_type,
      stamp.issued_at,
      stamp.business_status,
      stamp.mint_status,
      score.points as score_delta,
      (
        select coalesce(sum(history.points), 0)::integer
        from public.fan_score_ledger history
        where history.app_user_id = score.app_user_id
          and history.celebrity_id = score.celebrity_id
          and (
            history.created_at < score.created_at
            or (
              history.created_at = score.created_at
              and history.id <= score.id
            )
          )
      ) as updated_score
    from public.fan_activities activity
    join public.fan_score_ledger score
      on score.activity_id = activity.id
     and score.app_user_id = activity.app_user_id
     and score.celebrity_id = activity.celebrity_id
    join public.stamps stamp
      on stamp.activity_id = activity.id
     and stamp.app_user_id = activity.app_user_id
     and stamp.celebrity_id = activity.celebrity_id
    where activity.id = p_activity_id
      and activity.app_user_id = p_app_user_id
  )
  select jsonb_build_object(
    'passportId', completion.passport_id,
    'earnedStamp', jsonb_build_object(
      'id', completion.stamp_id,
      'type', completion.stamp_type,
      'issuedAt', completion.issued_at,
      'businessStatus', completion.business_status,
      'mintStatus', completion.mint_status
    ),
    'scoreDelta', completion.score_delta,
    'updatedScore', completion.updated_score,
    'updatedLevel', public.get_fan_effective_tier_for_score(completion.app_user_id,completion.celebrity_id,completion.updated_score,(select policy_version from public.reward_policy_activation where singleton=true)),
    'leveledUp', (
      public.get_fan_effective_tier_for_score(completion.app_user_id,completion.celebrity_id,completion.updated_score,(select policy_version from public.reward_policy_activation where singleton=true))
      <>
      public.get_fan_effective_tier_for_score(completion.app_user_id,completion.celebrity_id,completion.updated_score-completion.score_delta,(select policy_version from public.reward_policy_activation where singleton=true))
    )
  )
  from completion;
$$;


create or replace function public.get_admin_fans(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_locale public.content_locale,
  p_query text default null,
  p_celebrity_id uuid default null,
  p_account_status public.app_user_status default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns setof jsonb
language plpgsql security definer set search_path = '' as $$
declare
  verified_role public.admin_role;
  normalized_query text;
begin
  select allowlist.role into verified_role
  from public.admin_allowlist allowlist
  join public.app_users actor on actor.id = p_actor_app_user_id
   and actor.status = 'active' and actor.verified_email = allowlist.email
  where allowlist.id = p_actor_admin_allowlist_id and allowlist.active for share;
  if verified_role is null then raise exception 'active administrator is required'; end if;
  if p_correlation_id is null or p_limit is null or p_limit not between 1 and 100
     or ((p_cursor_created_at is null) <> (p_cursor_id is null)) then
    raise exception 'invalid fan operations request';
  end if;
  if p_query is not null then
    normalized_query := lower(normalize(btrim(p_query), NFKC));
    if length(normalized_query) not between 2 and 100 then
      raise exception 'fan search query must be between 2 and 100 characters';
    end if;
  end if;

  insert into public.audit_logs(
    actor_app_user_id, actor_admin_allowlist_id, action, entity_type,
    correlation_id, before_after_summary
  ) values (
    p_actor_app_user_id, p_actor_admin_allowlist_id, 'admin.fans.read',
    'fan_operations', p_correlation_id,
    jsonb_build_object(
      'result', 'authorized', 'queryKind', case when normalized_query is null then 'none' when strpos(normalized_query, '@') > 0 then 'email_exact' else 'nickname_contains' end,
      'celebrityFiltered', p_celebrity_id is not null, 'accountStatusFiltered', p_account_status is not null
    )
  );

  return query
  select jsonb_build_object(
    'fanId', user_record.id,
    'nickname', profile.nickname,
    'accountStatus', user_record.status,
    'maskedWallet', wallet.masked_address,
    'createdAt', user_record.created_at,
    'celebritySummaries', coalesce(journeys.items, '[]'::jsonb),
    'cursor', jsonb_build_object('createdAt', user_record.created_at, 'id', user_record.id)
  )
  from public.app_users user_record
  left join public.user_profiles profile on profile.app_user_id = user_record.id
  left join lateral (
    select public.mask_admin_wallet_address(w.address) as masked_address
    from public.user_wallets w where w.app_user_id = user_record.id
    order by (w.chain_id = 91342) desc, w.created_at limit 1
  ) wallet on true
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'passportId', passport.id,
      'celebrity', jsonb_build_object('id', celebrity.id, 'slug', celebrity.slug, 'name', localization.name, 'archived', celebrity.archived_at is not null),
      'score', jsonb_build_object('points', scores.points, 'level', public.get_fan_effective_tier_for_score(user_record.id,celebrity.id,scores.points,(select policy_version from public.reward_policy_activation where singleton=true))),
      'activityCounts', activity_counts.value,
      'passportMintStatus', passport.mint_status,
      'stampSummary', stamp_counts.value,
      'benefitSummary', benefit_counts.value,
      'latestActivityAt', activity_counts.latest_at,
      'correctionAllowed', user_record.status = 'active' and celebrity.archived_at is null and verified_role in ('admin', 'operator')
    ) order by localization.name, passport.id) as items
    from public.fan_passports passport
    join public.celebrities celebrity on celebrity.id = passport.celebrity_id
    join public.celebrity_localizations localization on localization.celebrity_id = celebrity.id and localization.locale = p_locale
    cross join lateral (
      select coalesce(sum(ledger.points), 0)::integer as points
      from public.fan_score_ledger ledger where ledger.app_user_id = user_record.id and ledger.celebrity_id = celebrity.id
    ) scores
    cross join lateral (
      select jsonb_build_object(
        'knowledge', count(*) filter(where activity_type='knowledge'), 'reservation', count(*) filter(where activity_type='reservation'),
        'attendance', count(*) filter(where activity_type='attendance'), 'survey', count(*) filter(where activity_type='survey')
      ) as value, max(occurred_at) as latest_at
      from public.fan_activities activity where activity.app_user_id=user_record.id and activity.celebrity_id=celebrity.id
    ) activity_counts
    cross join lateral (
      select jsonb_build_object('total',count(*),'queued',count(*) filter(where mint_status<>'minted'),'minted',count(*) filter(where mint_status='minted')) as value
      from public.stamps stamp where stamp.app_user_id=user_record.id and stamp.celebrity_id=celebrity.id
    ) stamp_counts
    cross join lateral (
      select jsonb_build_object(
        'claims', (select count(*) from public.benefit_claims claim where claim.app_user_id=user_record.id and claim.celebrity_id=celebrity.id),
        'applications', (select count(*) from public.benefit_applications application where application.app_user_id=user_record.id and application.celebrity_id=celebrity.id)
      ) as value
    ) benefit_counts
    where passport.app_user_id = user_record.id
      and (p_celebrity_id is null or passport.celebrity_id = p_celebrity_id)
  ) journeys
  where journeys.items is not null
    and (p_account_status is null or user_record.status = p_account_status)
    and (p_cursor_created_at is null or (user_record.created_at, user_record.id) < (p_cursor_created_at, p_cursor_id))
    and (
      normalized_query is null
      or (strpos(normalized_query, '@') > 0 and user_record.verified_email = normalized_query)
      or (strpos(normalized_query, '@') = 0 and profile.nickname_normalized is not null and strpos(profile.nickname_normalized, normalized_query) > 0)
    )
  order by user_record.created_at desc, user_record.id desc
  limit p_limit;
end;
$$;


create or replace function public.read_admin_creator_analytics(
  p_actor_admin_allowlist_id uuid,
  p_celebrity_id uuid,
  p_live_event_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_as_of timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  verified_role public.admin_role;
  result jsonb;
begin
  select allowlist.role into verified_role
  from public.admin_allowlist allowlist
  where allowlist.id = p_actor_admin_allowlist_id and allowlist.active = true
  for share;

  if verified_role is null then raise exception 'active administrator is required'; end if;
  if p_celebrity_id is null then raise exception 'celebrity scope is required'; end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'analytics time range must be a non-empty [from,to) interval';
  end if;
  if p_as_of is null then raise exception 'analytics snapshot time is required'; end if;
  if not exists (select 1 from public.celebrities where id = p_celebrity_id) then
    raise exception 'analytics celebrity scope does not exist';
  end if;
  if p_live_event_id is not null and not exists (
    select 1 from public.live_events
    where id = p_live_event_id and celebrity_id = p_celebrity_id
  ) then
    raise exception 'analytics live scope does not belong to celebrity';
  end if;

  with target_fans as (
    select passport.app_user_id
    from public.fan_passports passport
    where passport.celebrity_id = p_celebrity_id
      and passport.issued_at <= p_as_of
      and (
        p_live_event_id is null or exists (
          select 1 from public.live_reservations reservation
          where reservation.app_user_id = passport.app_user_id
            and reservation.celebrity_id = p_celebrity_id
            and reservation.live_event_id = p_live_event_id
            and reservation.reserved_at <= p_as_of
        )
      )
  ), scores as (
    select target.app_user_id, coalesce(sum(ledger.points), 0)::integer as points
    from target_fans target
    left join public.fan_score_ledger ledger
      on ledger.app_user_id = target.app_user_id
     and ledger.celebrity_id = p_celebrity_id
     and ledger.created_at <= p_as_of
    group by target.app_user_id
  ), fan_levels as (
    select scores.*, public.get_fan_effective_tier_for_score(scores.app_user_id,p_celebrity_id,scores.points,(select policy_version from public.reward_policy_activation where singleton=true)) as level
    from scores
  ), values_ as (
    select
      (select count(distinct reservation.app_user_id)::integer
       from public.live_reservations reservation
       where reservation.celebrity_id = p_celebrity_id
         and (p_live_event_id is null or reservation.live_event_id = p_live_event_id)
         and reservation.reserved_at >= p_from and reservation.reserved_at < p_to) as reservations,
      (select count(*)::integer from public.fan_passports passport
       where passport.celebrity_id = p_celebrity_id
         and passport.issued_at >= p_from and passport.issued_at < p_to) as passports,
      (select jsonb_build_object(
        'bronze', count(*) filter (where level='Bronze')::integer,
        'silver', count(*) filter (where level='Silver')::integer,
        'gold', count(*) filter (where level='Gold')::integer,
        'platinum', count(*) filter (where level='Platinum')::integer,
        'diamond', count(*) filter (where level='Diamond')::integer,
        'total', count(*)::integer
       ) from fan_levels) as levels,
      (select jsonb_build_object(
        'knowledge', count(*) filter (where stamp.stamp_type = 'knowledge')::integer,
        'reservation', count(*) filter (where stamp.stamp_type = 'reservation')::integer,
        'attendance', count(*) filter (where stamp.stamp_type = 'attendance')::integer,
        'survey', count(*) filter (where stamp.stamp_type = 'survey')::integer,
        'total', count(*)::integer
       )
       from public.stamps stamp
       where stamp.celebrity_id = p_celebrity_id
         and stamp.issued_at >= p_from and stamp.issued_at < p_to
         and (p_live_event_id is null or stamp.app_user_id in (select app_user_id from target_fans))) as stamp_counts
  )
  select jsonb_build_object(
    'scope', jsonb_build_object('celebrityId', p_celebrity_id, 'liveEventId', p_live_event_id),
    'window', jsonb_build_object('from', p_from, 'to', p_to, 'semantics', '[from,to)', 'asOf', p_as_of),
    'metrics', jsonb_build_object(
      'reservationUsers', jsonb_build_object('state', 'available', 'value', reservations, 'reason', null, 'source', 'live_reservations'),
      'passportsIssued', jsonb_build_object('state', 'available', 'value', passports, 'reason', null, 'source', 'fan_passports'),
      'levelDistribution', jsonb_build_object('state', 'available', 'value', levels, 'reason', null, 'source', 'fan_score_ledger', 'snapshotAt', p_as_of,
        'cohort', case when p_live_event_id is null then 'celebrity_passport_holders' else 'live_reservation_passport_holders' end),
      'stampTypeCounts', jsonb_build_object('state', 'available', 'value', stamp_counts, 'reason', null, 'source', 'stamps',
        'cohort', case when p_live_event_id is null then 'celebrity_passport_holders' else 'live_reservation_passport_holders' end),
      'attendanceUsers', jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'ATTENDANCE_SOURCE_NOT_IMPLEMENTED', 'source', null),
      'surveyResponses', jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'SURVEY_SOURCE_NOT_IMPLEMENTED', 'source', null)
    )
  ) into result from values_;
  return result;
end;
$$;
