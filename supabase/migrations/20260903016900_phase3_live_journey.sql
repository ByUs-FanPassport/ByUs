-- Phase 3 versioned LIVE Journey requirements and owner-scoped completion.
-- Product analytics are deliberately absent from every eligibility decision.

-- Phase 2 generalized Missions can coexist on one LIVE. Identity is the
-- immutable Mission row plus its business version, not the LIVE alone.
drop index if exists public.live_surveys_one_published_per_live_idx;
alter table public.live_survey_responses
  drop constraint if exists live_survey_responses_app_user_id_live_event_id_key;
alter table public.live_survey_responses
  add constraint live_survey_responses_owner_mission_unique
    unique (app_user_id, survey_id);
alter table public.live_surveys
  add constraint live_surveys_id_live_event_version_unique
    unique (id, live_event_id, version);

create table public.live_journey_requirement_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  revision integer not null check (revision > 0),
  lifecycle_status text not null check (lifecycle_status in ('draft', 'published')),
  require_passport boolean not null,
  require_reservation boolean not null,
  require_attendance boolean not null,
  bonus_ticket_amount integer not null check (bonus_ticket_amount between 0 and 5),
  reward_setting_revision_id uuid not null
    references public.live_reward_setting_revisions(id) on delete restrict,
  reward_setting_revision integer not null check (reward_setting_revision > 0),
  policy_version integer not null
    references public.reward_policy_versions(version) on delete restrict,
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  published_at timestamptz,
  unique (live_event_id, revision),
  unique (id, live_event_id),
  constraint live_journey_requirement_publication_shape check (
    (lifecycle_status = 'draft' and published_at is null)
    or (lifecycle_status = 'published' and published_at is not null)
  )
);

create table public.live_journey_mission_requirements (
  requirement_revision_id uuid not null,
  live_event_id uuid not null,
  mission_id uuid not null,
  mission_version integer not null check (mission_version > 0),
  position integer not null check (position > 0),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (requirement_revision_id, mission_id),
  unique (requirement_revision_id, position),
  foreign key (requirement_revision_id, live_event_id)
    references public.live_journey_requirement_revisions(id, live_event_id)
    on delete restrict,
  foreign key (mission_id, live_event_id)
    references public.live_surveys(id, live_event_id) on delete restrict,
  foreign key (mission_id, live_event_id, mission_version)
    references public.live_surveys(id, live_event_id, version) on delete restrict
);

create table public.live_journey_publications (
  live_event_id uuid primary key references public.live_events(id) on delete restrict,
  published_journey_requirement_revision_id uuid not null,
  actor_app_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_admin_allowlist_id uuid not null references public.admin_allowlist(id) on delete restrict,
  correlation_id uuid not null,
  published_at timestamptz not null default pg_catalog.now(),
  foreign key (published_journey_requirement_revision_id, live_event_id)
    references public.live_journey_requirement_revisions(id, live_event_id)
    on delete restrict
);

create table public.live_journey_participations (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  requirement_revision_id uuid not null,
  binding_source text not null check (
    binding_source in ('reservation', 'attendance', 'mission', 'evaluation')
  ),
  bound_at timestamptz not null default pg_catalog.now(),
  unique (app_user_id, live_event_id),
  unique (id, app_user_id, live_event_id),
  foreign key (requirement_revision_id, live_event_id)
    references public.live_journey_requirement_revisions(id, live_event_id)
    on delete restrict
);

create table public.live_journey_completions (
  id uuid primary key default extensions.gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  requirement_revision_id uuid not null,
  requirement_snapshot jsonb not null check (jsonb_typeof(requirement_snapshot) = 'object'),
  bonus_ticket_amount integer not null check (bonus_ticket_amount between 0 and 5),
  policy_version integer not null references public.reward_policy_versions(version) on delete restrict,
  reward_setting_revision integer not null check (reward_setting_revision > 0),
  reward_setting_revision_id uuid not null
    references public.live_reward_setting_revisions(id) on delete restrict,
  ticket_ledger_id uuid references public.fan_ticket_ledger(id) on delete restrict,
  completed_at timestamptz not null default pg_catalog.now(),
  unique (app_user_id, live_event_id),
  unique (id, app_user_id, live_event_id),
  foreign key (requirement_revision_id, live_event_id)
    references public.live_journey_requirement_revisions(id, live_event_id)
    on delete restrict,
  constraint live_journey_completion_ticket_shape check (
    (bonus_ticket_amount = 0 and ticket_ledger_id is null)
    or (bonus_ticket_amount > 0 and ticket_ledger_id is not null)
  )
);

-- Evaluations are immutable even when incomplete. The same transport key must
-- replay the exact earlier projection rather than re-evaluating newer facts.
create table public.live_journey_evaluations (
  idempotency_key uuid primary key,
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  live_event_id uuid not null references public.live_events(id) on delete restrict,
  requirement_revision_id uuid not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  evaluated_at timestamptz not null default pg_catalog.now(),
  foreign key (requirement_revision_id, live_event_id)
    references public.live_journey_requirement_revisions(id, live_event_id)
    on delete restrict
);

create index live_journey_mission_requirements_mission_idx
  on public.live_journey_mission_requirements (mission_id, requirement_revision_id);
create index live_journey_participations_owner_idx
  on public.live_journey_participations (app_user_id, bound_at desc);
create index live_journey_evaluations_owner_idx
  on public.live_journey_evaluations (app_user_id, live_event_id, evaluated_at desc);

create function public.reject_live_journey_immutable_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'published LIVE Journey facts are immutable';
end;
$$;

create trigger live_journey_requirement_revisions_immutable
before update or delete on public.live_journey_requirement_revisions
for each row execute function public.reject_live_journey_immutable_mutation();
create trigger live_journey_requirement_revisions_reject_truncate
before truncate on public.live_journey_requirement_revisions
for each statement execute function public.reject_live_journey_immutable_mutation();
create trigger live_journey_mission_requirements_immutable
before update or delete on public.live_journey_mission_requirements
for each row execute function public.reject_live_journey_immutable_mutation();
create trigger live_journey_mission_requirements_reject_truncate
before truncate on public.live_journey_mission_requirements
for each statement execute function public.reject_live_journey_immutable_mutation();
create trigger live_journey_participations_immutable
before update or delete on public.live_journey_participations
for each row execute function public.reject_live_journey_immutable_mutation();
create trigger live_journey_participations_reject_truncate
before truncate on public.live_journey_participations
for each statement execute function public.reject_live_journey_immutable_mutation();
create trigger live_journey_completions_immutable
before update or delete on public.live_journey_completions
for each row execute function public.reject_live_journey_immutable_mutation();
create trigger live_journey_completions_reject_truncate
before truncate on public.live_journey_completions
for each statement execute function public.reject_live_journey_immutable_mutation();
create trigger live_journey_evaluations_immutable
before update or delete on public.live_journey_evaluations
for each row execute function public.reject_live_journey_immutable_mutation();
create trigger live_journey_evaluations_reject_truncate
before truncate on public.live_journey_evaluations
for each statement execute function public.reject_live_journey_immutable_mutation();

create function public.require_live_journey_admin_actor(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_require_write boolean default true
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1
  from public.admin_allowlist allowlist
  join public.app_users actor
    on actor.id = p_actor_app_user_id
   and actor.status = 'active'
   and actor.verified_email = allowlist.email
  where allowlist.id = p_actor_admin_allowlist_id
    and allowlist.active
    and (not p_require_write or allowlist.role in ('admin', 'operator'))
  for share of allowlist, actor;
  if not found then
    raise exception 'paired-email Journey administrator is required';
  end if;
end;
$$;

create function public.get_admin_live_journey_requirements(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_live_event_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.require_live_journey_admin_actor(
    p_actor_app_user_id, p_actor_admin_allowlist_id, false
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'liveEventId', live.id,
    'publishedReward', case when published_reward.id is null then null else jsonb_build_object(
      'revisionId', published_reward.id,
      'revision', published_reward.revision,
      'bonusTicketAmount', published_reward.journey_bonus_ticket
    ) end,
    'latest', case when latest.id is null then null else jsonb_build_object(
      'revisionId', latest.id,
      'revision', latest.revision,
      'status', latest.lifecycle_status,
      'requirePassport', latest.require_passport,
      'requireReservation', latest.require_reservation,
      'requireAttendance', latest.require_attendance,
      'bonusTicketAmount', latest.bonus_ticket_amount,
      'rewardSettingRevisionId', latest.reward_setting_revision_id,
      'missions', coalesce((select jsonb_agg(jsonb_build_object(
        'missionId', selected.mission_id,
        'version', selected.mission_version
      ) order by selected.position)
      from public.live_journey_mission_requirements selected
      where selected.requirement_revision_id = latest.id), '[]'::jsonb)
    ) end,
    'published', case when published.id is null then null else jsonb_build_object(
      'revisionId', published.id,
      'revision', published.revision,
      'status', published.lifecycle_status,
      'requirePassport', published.require_passport,
      'requireReservation', published.require_reservation,
      'requireAttendance', published.require_attendance,
      'bonusTicketAmount', published.bonus_ticket_amount,
      'rewardSettingRevisionId', published.reward_setting_revision_id,
      'missions', coalesce((select jsonb_agg(jsonb_build_object(
        'missionId', selected.mission_id,
        'version', selected.mission_version
      ) order by selected.position)
      from public.live_journey_mission_requirements selected
      where selected.requirement_revision_id = published.id), '[]'::jsonb)
    ) end,
    'missionOptions', coalesce((select jsonb_agg(jsonb_build_object(
      'missionId', mission.id,
      'version', mission.version,
      'publicationStatus', mission.publication_status,
      'lifecycleStatus', mission.lifecycle_status,
      'missionType', mission.mission_type
    ) order by mission.version desc, mission.id)
    from public.live_surveys mission
    where mission.live_event_id = live.id
      and not mission.legacy_contract), '[]'::jsonb)
  ) order by live.created_at desc), '[]'::jsonb)
  into result
  from public.live_events live
  left join lateral (
    select requirement.*
    from public.live_journey_requirement_revisions requirement
    where requirement.live_event_id = live.id
    order by requirement.revision desc
    limit 1
  ) latest on true
  left join public.live_journey_publications publication
    on publication.live_event_id = live.id
  left join public.live_journey_requirement_revisions published
    on published.id = publication.published_journey_requirement_revision_id
  left join lateral (
    select reward.*
    from public.live_reward_setting_revisions reward
    where reward.live_event_id = live.id
      and reward.lifecycle_status = 'published'
    order by reward.revision desc
    limit 1
  ) published_reward on true
  where p_live_event_id is null or live.id = p_live_event_id;

  return result;
end;
$$;

create function public.save_admin_live_journey_requirement(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_live_event_id uuid,
  p_expected_revision integer,
  p_require_passport boolean,
  p_require_reservation boolean,
  p_require_attendance boolean,
  p_bonus_ticket_amount integer,
  p_missions jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  current_revision integer;
  next_revision integer;
  next_id uuid := extensions.gen_random_uuid();
  reward_setting public.live_reward_setting_revisions%rowtype;
  mission_item jsonb;
  mission_id uuid;
  mission_version integer;
  mission_count integer := 0;
  mission_position integer := 0;
begin
  perform public.require_live_journey_admin_actor(
    p_actor_app_user_id, p_actor_admin_allowlist_id
  );
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'expected revision is required';
  end if;
  if p_require_passport is null or p_require_reservation is null
     or p_require_attendance is null then
    raise exception 'requirement flags are required';
  end if;
  if p_bonus_ticket_amount is null or p_bonus_ticket_amount not between 0 and 5 then
    raise exception 'bonus Ticket amount is invalid';
  end if;
  if p_missions is null or jsonb_typeof(p_missions) <> 'array' then
    raise exception 'Mission requirements must be an array';
  end if;

  perform 1 from public.live_events live
  where live.id = p_live_event_id
    and live.publication_status = 'published'
    and live.archived_at is null
    and public.live_effective_status_at(live.id, pg_catalog.statement_timestamp())
      not in ('ended', 'cancelled')
  for update;
  if not found then raise exception 'published LIVE is required'; end if;

  select coalesce(max(requirement.revision), 0)
  into current_revision
  from public.live_journey_requirement_revisions requirement
  where requirement.live_event_id = p_live_event_id;
  if current_revision <> p_expected_revision then
    raise exception 'stale Journey requirement revision conflict';
  end if;

  select setting.* into reward_setting
  from public.live_reward_setting_revisions setting
  where setting.live_event_id = p_live_event_id
    and setting.lifecycle_status = 'published'
  order by setting.revision desc
  limit 1
  for share;
  if not found then raise exception 'published reward settings are required'; end if;
  if reward_setting.journey_bonus_ticket <> p_bonus_ticket_amount then
    raise exception 'Journey bonus must match the highest published reward revision';
  end if;

  mission_count := jsonb_array_length(p_missions);
  if not (p_require_passport or p_require_reservation or p_require_attendance)
     and mission_count = 0 then
    raise exception 'NO_ACTIVE_REQUIREMENT: at least one Journey requirement is required';
  end if;

  next_revision := current_revision + 1;
  insert into public.live_journey_requirement_revisions (
    id, live_event_id, revision, lifecycle_status, require_passport,
    require_reservation, require_attendance, bonus_ticket_amount,
    reward_setting_revision_id, reward_setting_revision, policy_version,
    actor_app_user_id, actor_admin_allowlist_id, correlation_id
  ) values (
    next_id, p_live_event_id, next_revision, 'draft', p_require_passport,
    p_require_reservation, p_require_attendance, p_bonus_ticket_amount,
    reward_setting.id, reward_setting.revision, reward_setting.policy_version,
    p_actor_app_user_id, p_actor_admin_allowlist_id, p_correlation_id
  );

  for mission_item in select value from jsonb_array_elements(p_missions) loop
    begin
      if jsonb_typeof(mission_item) <> 'object'
         or not (mission_item ? 'missionId')
         or not (mission_item ? 'version')
         or (select count(*) from jsonb_object_keys(mission_item)) <> 2 then
        raise exception 'invalid Mission requirement';
      end if;
      mission_id := (mission_item->>'missionId')::uuid;
      mission_version := (mission_item->>'version')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid Mission requirement';
    end;
    if mission_version < 1 or not exists (
      select 1 from public.live_surveys mission
      where mission.id = mission_id
        and mission.live_event_id = p_live_event_id
        and mission.version = mission_version
        and mission.publication_status = 'published'
        and mission.lifecycle_status = 'published'
        and not mission.legacy_contract
    ) then
      raise exception 'published Mission revision is required';
    end if;
    mission_position := mission_position + 1;
    insert into public.live_journey_mission_requirements (
      requirement_revision_id, live_event_id, mission_id, mission_version, position
    ) values (
      next_id, p_live_event_id, mission_id, mission_version, mission_position
    );
  end loop;

  insert into public.audit_logs (
    actor_app_user_id, actor_admin_allowlist_id, action, entity_type,
    entity_id, before_after_summary, correlation_id
  ) values (
    p_actor_app_user_id, p_actor_admin_allowlist_id,
    'live.journey_requirement.draft_saved', 'live_event', p_live_event_id::text,
    jsonb_build_object(
      'requirementRevisionId', next_id, 'revision', next_revision,
      'requirePassport', p_require_passport,
      'requireReservation', p_require_reservation,
      'requireAttendance', p_require_attendance,
      'missionCount', mission_count,
      'bonusTicketAmount', p_bonus_ticket_amount,
      'rewardSettingRevisionId', reward_setting.id
    ), p_correlation_id
  );
  return jsonb_build_object('revisionId', next_id, 'revision', next_revision);
exception when unique_violation then
  raise exception 'Journey requirement revision conflict';
end;
$$;

create function public.publish_admin_live_journey_requirement(
  p_actor_app_user_id uuid,
  p_actor_admin_allowlist_id uuid,
  p_correlation_id uuid,
  p_live_event_id uuid,
  p_expected_revision integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  draft_requirement public.live_journey_requirement_revisions%rowtype;
  reward_setting public.live_reward_setting_revisions%rowtype;
  published_journey_requirement_revision_id uuid := extensions.gen_random_uuid();
  next_revision integer;
begin
  perform public.require_live_journey_admin_actor(
    p_actor_app_user_id, p_actor_admin_allowlist_id
  );
  if p_correlation_id is null then raise exception 'correlation id is required'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'journey:publication:' || p_live_event_id::text, 0
    )
  );

  perform 1 from public.live_events live
  where live.id = p_live_event_id
    and live.publication_status = 'published'
    and live.archived_at is null
    and public.live_effective_status_at(live.id, pg_catalog.statement_timestamp())
      not in ('ended', 'cancelled')
  for update;
  if not found then raise exception 'published LIVE is required'; end if;

  select requirement.* into draft_requirement
  from public.live_journey_requirement_revisions requirement
  where requirement.live_event_id = p_live_event_id
  order by requirement.revision desc
  limit 1
  for update;
  if not found or draft_requirement.revision <> p_expected_revision then
    raise exception 'stale Journey requirement revision conflict';
  end if;
  if draft_requirement.lifecycle_status <> 'draft' then
    raise exception 'latest Journey requirement must be a draft';
  end if;
  if not (
    draft_requirement.require_passport
    or draft_requirement.require_reservation
    or draft_requirement.require_attendance
    or exists (
      select 1 from public.live_journey_mission_requirements selected
      where selected.requirement_revision_id = draft_requirement.id
    )
  ) then
    raise exception 'NO_ACTIVE_REQUIREMENT: at least one Journey requirement is required';
  end if;
  if exists (
    select 1
    from public.live_journey_mission_requirements selected
    left join public.live_surveys mission
      on mission.id = selected.mission_id
     and mission.live_event_id = p_live_event_id
     and mission.version = selected.mission_version
     and mission.publication_status = 'published'
     and mission.lifecycle_status = 'published'
     and not mission.legacy_contract
    where selected.requirement_revision_id = draft_requirement.id
      and mission.id is null
  ) then
    raise exception 'published Mission revision is required';
  end if;

  select setting.* into reward_setting
  from public.live_reward_setting_revisions setting
  where setting.live_event_id = p_live_event_id
    and setting.lifecycle_status = 'published'
  order by setting.revision desc
  limit 1
  for share;
  if not found then raise exception 'published reward settings are required'; end if;
  if reward_setting.journey_bonus_ticket <> draft_requirement.bonus_ticket_amount then
    raise exception 'Journey bonus changed; save a new draft against current reward settings';
  end if;

  next_revision := draft_requirement.revision + 1;
  insert into public.live_journey_requirement_revisions (
    id, live_event_id, revision, lifecycle_status, require_passport,
    require_reservation, require_attendance, bonus_ticket_amount,
    reward_setting_revision_id, reward_setting_revision, policy_version,
    actor_app_user_id, actor_admin_allowlist_id, correlation_id, published_at
  ) values (
    published_journey_requirement_revision_id, p_live_event_id, next_revision,
    'published', draft_requirement.require_passport,
    draft_requirement.require_reservation, draft_requirement.require_attendance,
    draft_requirement.bonus_ticket_amount, reward_setting.id,
    reward_setting.revision, reward_setting.policy_version,
    p_actor_app_user_id, p_actor_admin_allowlist_id, p_correlation_id,
    pg_catalog.now()
  );
  insert into public.live_journey_mission_requirements (
    requirement_revision_id, live_event_id, mission_id, mission_version, position
  ) select
    published_journey_requirement_revision_id, p_live_event_id,
    selected.mission_id, selected.mission_version, selected.position
  from public.live_journey_mission_requirements selected
  where selected.requirement_revision_id = draft_requirement.id;

  insert into public.live_journey_publications (
    live_event_id, published_journey_requirement_revision_id,
    actor_app_user_id, actor_admin_allowlist_id, correlation_id, published_at
  ) values (
    p_live_event_id, published_journey_requirement_revision_id,
    p_actor_app_user_id, p_actor_admin_allowlist_id, p_correlation_id,
    pg_catalog.now()
  ) on conflict (live_event_id) do update set
    published_journey_requirement_revision_id = excluded.published_journey_requirement_revision_id,
    actor_app_user_id = excluded.actor_app_user_id,
    actor_admin_allowlist_id = excluded.actor_admin_allowlist_id,
    correlation_id = excluded.correlation_id,
    published_at = excluded.published_at;

  insert into public.audit_logs (
    actor_app_user_id, actor_admin_allowlist_id, action, entity_type,
    entity_id, before_after_summary, correlation_id
  ) values (
    p_actor_app_user_id, p_actor_admin_allowlist_id,
    'live.journey_requirement.published', 'live_event', p_live_event_id::text,
    jsonb_build_object(
      'sourceRevisionId', draft_requirement.id,
      'requirementRevisionId', published_journey_requirement_revision_id,
      'revision', next_revision,
      'rewardSettingRevisionId', reward_setting.id
    ), p_correlation_id
  );
  return jsonb_build_object(
    'revisionId', published_journey_requirement_revision_id,
    'revision', next_revision
  );
exception when unique_violation then
  raise exception 'Journey requirement revision conflict';
end;
$$;

create function public.bind_owned_live_journey(
  p_app_user_id uuid,
  p_live_event_id uuid,
  p_binding_source text,
  p_mission_id uuid default null,
  p_mission_version integer default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  published_journey_requirement_revision_id uuid;
  participation_revision_id uuid;
begin
  -- Existing reserve_owned_live_event, attend_owned_live_event, and
  -- submit_owned_live_mission writes feed the three binding triggers below.
  if p_app_user_id is null or p_live_event_id is null
     or p_binding_source not in ('reservation', 'attendance', 'mission', 'evaluation') then
    raise exception 'invalid Journey binding';
  end if;
  perform 1 from public.app_users owner
  where owner.id = p_app_user_id and owner.status = 'active'
  for share;
  if not found then raise exception 'Journey owner is unavailable'; end if;

  select participation.requirement_revision_id
  into participation_revision_id
  from public.live_journey_participations participation
  where participation.app_user_id = p_app_user_id
    and participation.live_event_id = p_live_event_id;
  if participation_revision_id is not null then return participation_revision_id; end if;

  -- Concurrent fan binds share this lock; publication takes it exclusively.
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended(
      'journey:publication:' || p_live_event_id::text, 0
    )
  );
  perform 1 from public.live_events live
  where live.id = p_live_event_id
    and live.publication_status = 'published'
    and live.archived_at is null
  for share;
  if not found then return null; end if;

  -- Recheck after acquiring the publication barrier.
  select participation.requirement_revision_id
  into participation_revision_id
  from public.live_journey_participations participation
  where participation.app_user_id = p_app_user_id
    and participation.live_event_id = p_live_event_id;
  if participation_revision_id is not null then return participation_revision_id; end if;

  select publication.published_journey_requirement_revision_id
  into published_journey_requirement_revision_id
  from public.live_journey_publications publication
  where publication.live_event_id = p_live_event_id;
  if published_journey_requirement_revision_id is null then return null; end if;

  if p_binding_source = 'reservation' and not exists (
    select 1
    from public.live_journey_requirement_revisions requirement
    where requirement.id = published_journey_requirement_revision_id
      and requirement.require_reservation
  ) then
    return null;
  end if;

  if p_binding_source = 'attendance' and not exists (
    select 1
    from public.live_journey_requirement_revisions requirement
    where requirement.id = published_journey_requirement_revision_id
      and requirement.require_attendance
  ) then
    return null;
  end if;

  if p_binding_source = 'mission' and not exists (
    select 1 from public.live_journey_mission_requirements selected_mission
    where selected_mission.requirement_revision_id = published_journey_requirement_revision_id
      and selected_mission.mission_id = p_mission_id
      and selected_mission.mission_version = p_mission_version
  ) then
    return null;
  end if;

  insert into public.live_journey_participations (
    app_user_id, live_event_id, requirement_revision_id, binding_source
  ) values (
    p_app_user_id, p_live_event_id,
    published_journey_requirement_revision_id, p_binding_source
  ) on conflict (app_user_id, live_event_id) do nothing;

  select participation.requirement_revision_id
  into strict participation_revision_id
  from public.live_journey_participations participation
  where participation.app_user_id = p_app_user_id
    and participation.live_event_id = p_live_event_id;
  return participation_revision_id;
end;
$$;

create function public.bind_live_journey_after_reservation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.bind_owned_live_journey(
    new.app_user_id, new.live_event_id, 'reservation', null, null
  );
  return new;
end;
$$;
create trigger live_reservations_bind_owned_live_journey
after insert on public.live_reservations
for each row execute function public.bind_live_journey_after_reservation();

create function public.bind_live_journey_after_attendance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.bind_owned_live_journey(
    new.app_user_id, new.live_event_id, 'attendance', null, null
  );
  return new;
end;
$$;
create trigger live_attendances_bind_owned_live_journey
after insert on public.live_attendances
for each row execute function public.bind_live_journey_after_attendance();

create function public.bind_live_journey_after_mission_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare mission_version integer;
begin
  if old.status = 'draft' and new.status = 'submitted' then
    select mission.version into strict mission_version
    from public.live_surveys mission
    where mission.id = new.survey_id and mission.live_event_id = new.live_event_id;
    perform public.bind_owned_live_journey(
      new.app_user_id, new.live_event_id, 'mission', new.survey_id, mission_version
    );
  end if;
  return new;
end;
$$;
create trigger live_survey_responses_bind_owned_live_journey
after update of status on public.live_survey_responses
for each row execute function public.bind_live_journey_after_mission_submission();

create function public.project_owned_live_journey(
  p_app_user_id uuid,
  p_live_event_id uuid,
  p_requirement_revision_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  requirement public.live_journey_requirement_revisions%rowtype;
  completion public.live_journey_completions%rowtype;
  passport_complete boolean;
  reservation_complete boolean;
  attendance_complete boolean;
  missions jsonb;
  missions_complete boolean;
  eligible boolean;
  requirements jsonb;
begin
  select revision.* into strict requirement
  from public.live_journey_requirement_revisions revision
  where revision.id = p_requirement_revision_id
    and revision.live_event_id = p_live_event_id;
  select completed.* into completion
  from public.live_journey_completions completed
  where completed.app_user_id = p_app_user_id
    and completed.live_event_id = p_live_event_id;
  if found then
    return jsonb_build_object(
      'liveEventId', completion.live_event_id,
      'requirementRevisionId', completion.requirement_revision_id,
      'eligible', true,
      'complete', true,
      'requirements', completion.requirement_snapshot,
      'bonusTicketAmount', completion.bonus_ticket_amount,
      'completedAt', completion.completed_at,
      'ticketLedgerId', completion.ticket_ledger_id
    );
  end if;

  select exists (
    select 1 from public.fan_passports passport
    join public.live_events live on live.celebrity_id = passport.celebrity_id
    where live.id = p_live_event_id
      and passport.app_user_id = p_app_user_id
      and passport.business_status = 'issued'
  ) into passport_complete;
  select exists (
    select 1 from public.live_reservations reservation
    where reservation.app_user_id = p_app_user_id
      and reservation.live_event_id = p_live_event_id
  ) into reservation_complete;
  select exists (
    select 1 from public.live_attendances attendance
    where attendance.app_user_id = p_app_user_id
      and attendance.live_event_id = p_live_event_id
  ) into attendance_complete;
  with mission_states as materialized (
    select selected.mission_id, selected.mission_version, selected.position,
      exists (
        select 1 from public.live_survey_responses response
        where response.app_user_id = p_app_user_id
          and response.live_event_id = p_live_event_id
          and response.survey_id = selected.mission_id
          and response.status = 'submitted'
      ) as is_complete
    from public.live_journey_mission_requirements selected
    where selected.requirement_revision_id = requirement.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'missionId', mission.mission_id,
    'version', mission.mission_version,
    'state', case when mission.is_complete then 'complete' else 'incomplete' end
  ) order by mission.position), '[]'::jsonb),
  coalesce(bool_and(mission.is_complete), true)
  into missions, missions_complete
  from mission_states mission;

  eligible := (not requirement.require_passport or passport_complete)
    and (not requirement.require_reservation or reservation_complete)
    and (not requirement.require_attendance or attendance_complete);
  requirements := jsonb_build_object(
    'passport', jsonb_build_object(
      'required', requirement.require_passport,
      'state', case when passport_complete then 'complete' else 'incomplete' end
    ),
    'reservation', jsonb_build_object(
      'required', requirement.require_reservation,
      'state', case when reservation_complete then 'complete' else 'incomplete' end
    ),
    'attendance', jsonb_build_object(
      'required', requirement.require_attendance,
      'state', case when attendance_complete then 'complete' else 'incomplete' end
    ),
    'missions', missions
  );
  return jsonb_build_object(
    'liveEventId', p_live_event_id,
    'requirementRevisionId', requirement.id,
    'eligible', eligible,
    'complete', eligible and missions_complete,
    'requirements', requirements,
    'bonusTicketAmount', requirement.bonus_ticket_amount,
    'completedAt', null,
    'ticketLedgerId', null
  );
end;
$$;

create function public.get_owned_live_journey(
  p_app_user_id uuid,
  p_live_slug text
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  selected_live_event_id uuid;
  journey_requirement_revision_id uuid;
begin
  if p_app_user_id is null or p_live_slug is null
     or p_live_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'P3_JOURNEY_NOT_FOUND';
  end if;
  perform 1 from public.app_users owner
  where owner.id = p_app_user_id and owner.status = 'active';
  if not found then raise exception 'P3_JOURNEY_NOT_FOUND'; end if;
  select live.id into selected_live_event_id
  from public.live_events live
  where live.slug = p_live_slug
    and live.publication_status = 'published'
    and live.archived_at is null;
  if selected_live_event_id is null then raise exception 'P3_JOURNEY_NOT_FOUND'; end if;

  select participation.requirement_revision_id
  into journey_requirement_revision_id
  from public.live_journey_participations participation
  where participation.app_user_id = p_app_user_id
    and participation.live_event_id = selected_live_event_id;
  if journey_requirement_revision_id is null then
    select publication.published_journey_requirement_revision_id
    into journey_requirement_revision_id
    from public.live_journey_publications publication
    where publication.live_event_id = selected_live_event_id;
  end if;
  if journey_requirement_revision_id is null then raise exception 'P3_JOURNEY_NOT_FOUND'; end if;
  return public.project_owned_live_journey(
    p_app_user_id, selected_live_event_id, journey_requirement_revision_id
  );
end;
$$;

create function public.evaluate_owned_live_journey(
  p_app_user_id uuid,
  p_live_slug text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  live_record public.live_events%rowtype;
  participation public.live_journey_participations%rowtype;
  requirement public.live_journey_requirement_revisions%rowtype;
  existing_evaluation public.live_journey_evaluations%rowtype;
  existing_completion public.live_journey_completions%rowtype;
  projection jsonb;
  requirements jsonb;
  completion_id uuid;
  completed_at timestamptz := pg_catalog.statement_timestamp();
  ticket_result jsonb;
  ticket_ledger_id uuid;
  result jsonb;
begin
  if p_app_user_id is null or p_idempotency_key is null or p_live_slug is null
     or p_live_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'P3_JOURNEY_NOT_FOUND';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('journey:idempotency:' || p_idempotency_key::text, 0)
  );
  select evaluation.* into existing_evaluation
  from public.live_journey_evaluations evaluation
  where evaluation.idempotency_key = p_idempotency_key;
  if found then
    if existing_evaluation.app_user_id <> p_app_user_id
       or not exists (
         select 1 from public.live_events keyed_live
         where keyed_live.id = existing_evaluation.live_event_id
           and keyed_live.slug = p_live_slug
       ) then
      raise exception 'P3_JOURNEY_IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return existing_evaluation.result;
  end if;

  perform 1 from public.app_users owner
  where owner.id = p_app_user_id and owner.status = 'active'
  for share;
  if not found then raise exception 'P3_JOURNEY_NOT_FOUND'; end if;
  select live.* into live_record
  from public.live_events live
  where live.slug = p_live_slug
    and live.publication_status = 'published'
    and live.archived_at is null;
  if not found then raise exception 'P3_JOURNEY_NOT_FOUND'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'journey:target:' || p_app_user_id::text || ':' || live_record.id::text, 0
    )
  );
  perform public.bind_owned_live_journey(
    p_app_user_id, live_record.id, 'evaluation', null, null
  );
  select bound.* into participation
  from public.live_journey_participations bound
  where bound.app_user_id = p_app_user_id
    and bound.live_event_id = live_record.id
  for update;
  if not found then raise exception 'P3_JOURNEY_NOT_FOUND'; end if;
  select revision.* into strict requirement
  from public.live_journey_requirement_revisions revision
  where revision.id = participation.requirement_revision_id;

  select completed.* into existing_completion
  from public.live_journey_completions completed
  where completed.app_user_id = p_app_user_id
    and completed.live_event_id = live_record.id;
  if found then
    result := public.project_owned_live_journey(
      p_app_user_id, live_record.id, participation.requirement_revision_id
    );
    insert into public.live_journey_evaluations (
      idempotency_key, app_user_id, live_event_id, requirement_revision_id, result
    ) values (
      p_idempotency_key, p_app_user_id, live_record.id,
      participation.requirement_revision_id, result
    );
    return result;
  end if;

  -- The canonical projector reads only authoritative operational facts.
  projection := public.project_owned_live_journey(
    p_app_user_id, live_record.id, participation.requirement_revision_id
  );
  requirements := projection->'requirements';

  if (projection->>'complete')::boolean then
    completion_id := extensions.gen_random_uuid();
    if requirement.bonus_ticket_amount > 0 then
      -- post_fan_ticket_entry positional source_id is the new completion_id.
      ticket_result := public.post_fan_ticket_entry(
        p_app_user_id, live_record.celebrity_id, 'credit',
        requirement.bonus_ticket_amount, 'journey_completion', completion_id,
        completion_id, requirement.policy_version,
        requirement.reward_setting_revision,
        requirement.reward_setting_revision_id
      );
      ticket_ledger_id := (ticket_result->>'entryId')::uuid;
    end if;
    insert into public.live_journey_completions (
      id, app_user_id, live_event_id, requirement_revision_id,
      requirement_snapshot, bonus_ticket_amount, policy_version,
      reward_setting_revision, reward_setting_revision_id,
      ticket_ledger_id, completed_at
    ) values (
      completion_id, p_app_user_id, live_record.id, requirement.id,
      requirements, requirement.bonus_ticket_amount, requirement.policy_version,
      requirement.reward_setting_revision, requirement.reward_setting_revision_id,
      ticket_ledger_id, completed_at
    );
    if requirement.bonus_ticket_amount > 0 then
      perform public.freeze_live_reward_settings_on_issuance(
        requirement.reward_setting_revision_id, completed_at,
        'journey_completion', completion_id
      );
    end if;
    result := jsonb_build_object(
      'liveEventId', live_record.id,
      'requirementRevisionId', requirement.id,
      'eligible', true,
      'complete', true,
      'requirements', requirements,
      'bonusTicketAmount', requirement.bonus_ticket_amount,
      'completedAt', completed_at,
      'ticketLedgerId', ticket_ledger_id
    );
  else
    result := projection;
  end if;

  insert into public.live_journey_evaluations (
    idempotency_key, app_user_id, live_event_id, requirement_revision_id, result
  ) values (
    p_idempotency_key, p_app_user_id, live_record.id, requirement.id, result
  );
  return result;
end;
$$;

alter table public.live_journey_requirement_revisions enable row level security;
alter table public.live_journey_requirement_revisions force row level security;
alter table public.live_journey_mission_requirements enable row level security;
alter table public.live_journey_mission_requirements force row level security;
alter table public.live_journey_publications enable row level security;
alter table public.live_journey_publications force row level security;
alter table public.live_journey_participations enable row level security;
alter table public.live_journey_participations force row level security;
alter table public.live_journey_completions enable row level security;
alter table public.live_journey_completions force row level security;
alter table public.live_journey_evaluations enable row level security;
alter table public.live_journey_evaluations force row level security;

revoke all on table public.live_journey_requirement_revisions,
  public.live_journey_mission_requirements, public.live_journey_publications,
  public.live_journey_participations, public.live_journey_completions,
  public.live_journey_evaluations
  from public, anon, authenticated, service_role;

revoke all on function public.reject_live_journey_immutable_mutation(),
  public.require_live_journey_admin_actor(uuid,uuid,boolean),
  public.bind_owned_live_journey(uuid,uuid,text,uuid,integer),
  public.bind_live_journey_after_reservation(),
  public.bind_live_journey_after_attendance(),
  public.bind_live_journey_after_mission_submission(),
  public.project_owned_live_journey(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.get_admin_live_journey_requirements(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.save_admin_live_journey_requirement(uuid,uuid,uuid,uuid,integer,boolean,boolean,boolean,integer,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.publish_admin_live_journey_requirement(uuid,uuid,uuid,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_owned_live_journey(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.evaluate_owned_live_journey(uuid,text,uuid)
  from public,anon,authenticated,service_role;

grant execute on function public.get_admin_live_journey_requirements(uuid,uuid,uuid)
  to service_role;
grant execute on function public.save_admin_live_journey_requirement(uuid,uuid,uuid,uuid,integer,boolean,boolean,boolean,integer,jsonb)
  to service_role;
grant execute on function public.publish_admin_live_journey_requirement(uuid,uuid,uuid,uuid,integer)
  to service_role;
grant execute on function public.get_owned_live_journey(uuid,text)
  to service_role;
grant execute on function public.evaluate_owned_live_journey(uuid,text,uuid)
  to service_role;

comment on table public.live_journey_evaluations is
  'Immutable owner-scoped evaluation replay, including incomplete outcomes.';
comment on function public.evaluate_owned_live_journey(uuid,text,uuid) is
  'Evaluates only bound operational facts, creates at most one Journey completion, and issues zero or one Ticket without Score.';
